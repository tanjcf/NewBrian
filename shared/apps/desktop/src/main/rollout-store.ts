import { createReadStream } from "node:fs";
import { mkdir, open, rename, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";

export interface RolloutRecord<TPayload = unknown> {
  schema_version: 1;
  record_type: string;
  timestamp: string;
  thread_id: string;
  turn_id?: string;
  payload: TPayload;
}

export interface StateSnapshotRecord<TState> extends RolloutRecord<TState> {
  record_type: "state_snapshot";
  state: TState;
}

/** Rewrite append-only rollouts once they exceed this size so activate/read stays bounded. */
export const ROLLOUT_COMPACT_AFTER_BYTES = 16 * 1024 * 1024;
const SNAPSHOT_SCAN_CHUNK_BYTES = 1024 * 1024;
const MAX_SNAPSHOT_LINE_BYTES = 48 * 1024 * 1024;

const pendingAppends = new Map<string, Promise<void>>();

/**
 * Serializes appends per rollout and fsyncs each batch. A failed write does not
 * poison later appends for the same thread.
 */
export function appendRolloutRecords(path: string, records: readonly unknown[]): Promise<void> {
  if (!records.length) return Promise.resolve();
  const previous = pendingAppends.get(path) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(async () => {
    await mkdir(dirname(path), { recursive: true });
    const handle = await open(path, "a");
    try {
      const body = records.map((record) => JSON.stringify(record)).join("\n") + "\n";
      await handle.writeFile(body, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
  });
  pendingAppends.set(path, next);
  return next.finally(() => {
    if (pendingAppends.get(path) === next) pendingAppends.delete(path);
  });
}

function enqueueRolloutOp(path: string, operation: () => Promise<void>): Promise<void> {
  const previous = pendingAppends.get(path) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(operation);
  pendingAppends.set(path, next);
  return next.finally(() => {
    if (pendingAppends.get(path) === next) pendingAppends.delete(path);
  });
}

/** Replace a rollout file with the given records (used to drop historical snapshot bloat). */
export function rewriteRolloutRecords(path: string, records: readonly unknown[]): Promise<void> {
  return enqueueRolloutOp(path, async () => {
    await mkdir(dirname(path), { recursive: true });
    const tempPath = join(dirname(path), `.${Date.now()}-${Math.random().toString(16).slice(2)}.rollout.tmp`);
    const handle = await open(tempPath, "w");
    try {
      const body = records.length
        ? records.map((record) => JSON.stringify(record)).join("\n") + "\n"
        : "";
      await handle.writeFile(body, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tempPath, path);
  });
}

/**
 * Append a state snapshot and compact the rollout when historical snapshots have
 * grown past the safe full-file read / disk bloat threshold.
 */
export async function appendStateSnapshotCompacting(
  path: string,
  record: unknown,
  options?: { compactAfterBytes?: number }
): Promise<void> {
  await appendRolloutRecords(path, [record]);
  const limit = options?.compactAfterBytes ?? ROLLOUT_COMPACT_AFTER_BYTES;
  try {
    const fileStat = await stat(path);
    if (fileStat.size >= limit) {
      await rewriteRolloutRecords(path, [record]);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    // Compaction is best-effort; the durable append already succeeded.
  }
}

/** Stream every record without materializing the file as one giant string. */
export async function readRolloutRecords(path: string): Promise<unknown[]> {
  const records: unknown[] = [];
  const stream = createReadStream(path, { encoding: "utf8" });
  try {
    const lines = createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of lines) {
      if (!line.trim()) continue;
      try {
        records.push(JSON.parse(line));
      } catch {
        // A crash may leave one partial tail record. Earlier durable records remain replayable.
      }
    }
  } finally {
    stream.destroy();
  }
  return records;
}

function parseStateSnapshotLine<TState>(line: Buffer): TState | null {
  if (!line.length) return null;
  try {
    const record = JSON.parse(line.toString("utf8")) as {
      record_type?: string;
      state?: TState;
      payload?: TState;
    };
    if (record?.record_type !== "state_snapshot") return null;
    return (record.state ?? record.payload) ?? null;
  } catch {
    return null;
  }
}

/**
 * Find the latest state_snapshot by scanning backward from EOF.
 * Avoids `readFile(path, "utf8")` which throws RangeError on multi-hundred-MB rollouts.
 */
export async function readLatestStateSnapshot<TState>(path: string): Promise<TState | null> {
  const handle = await open(path, "r");
  try {
    const { size } = await handle.stat();
    if (size <= 0) return null;

    let offset = size;
    // Incomplete line head from a later chunk; prepended after the next earlier read.
    let suffix = Buffer.alloc(0);

    while (offset > 0) {
      const readSize = Math.min(SNAPSHOT_SCAN_CHUNK_BYTES, offset);
      offset -= readSize;
      const buf = Buffer.alloc(readSize);
      const { bytesRead } = await handle.read(buf, 0, readSize, offset);
      const chunk = Buffer.concat([buf.subarray(0, bytesRead), suffix]);

      const lines: Buffer[] = [];
      let start = 0;
      for (let index = 0; index < chunk.length; index += 1) {
        if (chunk[index] !== 0x0a) continue;
        let end = index;
        if (end > start && chunk[end - 1] === 0x0d) end -= 1;
        lines.push(chunk.subarray(start, end));
        start = index + 1;
      }
      lines.push(chunk.subarray(start));

      if (offset > 0) {
        suffix = lines.shift() ?? Buffer.alloc(0);
        if (suffix.length > MAX_SNAPSHOT_LINE_BYTES) {
          throw Object.assign(
            new Error(`Rollout state snapshot line exceeds ${MAX_SNAPSHOT_LINE_BYTES} bytes: ${path}`),
            { code: "NEWBRAIN_ROLLOUT_LINE_TOO_LARGE" }
          );
        }
      } else {
        suffix = Buffer.alloc(0);
      }

      for (let index = lines.length - 1; index >= 0; index -= 1) {
        const state = parseStateSnapshotLine<TState>(lines[index]!);
        if (state) return state;
      }
    }

    return null;
  } finally {
    await handle.close();
  }
}

export function createRolloutEvent<TPayload>(input: {
  recordType: string;
  threadId: string;
  payload: TPayload;
  timestamp?: string;
  turnId?: string;
}): RolloutRecord<TPayload> {
  return {
    schema_version: 1,
    record_type: input.recordType,
    timestamp: input.timestamp ?? new Date().toISOString(),
    thread_id: input.threadId,
    ...(input.turnId ? { turn_id: input.turnId } : {}),
    payload: input.payload
  };
}

export function createStateSnapshot<TState>(input: {
  threadId: string;
  state: TState;
  timestamp?: string;
}): StateSnapshotRecord<TState> {
  return {
    ...createRolloutEvent({
      recordType: "state_snapshot",
      threadId: input.threadId,
      timestamp: input.timestamp,
      payload: input.state
    }),
    record_type: "state_snapshot",
    state: input.state
  };
}
