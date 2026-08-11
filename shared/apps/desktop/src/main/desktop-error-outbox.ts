import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface DesktopFailureInput {
  kind: string;
  message: string;
  stackTrace?: string;
  context?: Record<string, unknown>;
  deviceId?: string;
  appVersion?: string;
}

export interface DesktopFailureRecord extends DesktopFailureInput {
  id: string;
  capturedAt: string;
  fingerprint: string;
}

const truncate = (value: unknown, limit: number) => String(value ?? "").slice(0, limit);
const redact = (value: string) => value
  .replace(/Bearer\s+[A-Za-z0-9._~+\-/=]+/gi, "Bearer [REDACTED]")
  .replace(/(api[_-]?key|access[_-]?token|refresh[_-]?token|password)(\s*[=:]\s*)[^\s,;]+/gi, "$1$2[REDACTED]");

const sanitizeContext = (context: Record<string, unknown> | undefined): Record<string, unknown> => {
  try {
    const serialized = redact(JSON.stringify(context ?? {}));
    if (serialized.length <= 16_000) {
      return JSON.parse(serialized) as Record<string, unknown>;
    }
    return { truncated: serialized.slice(0, 15_900) };
  } catch {
    return { unavailable: "Context could not be serialized" };
  }
};

export class DesktopErrorOutbox {
  private readonly root: string;
  private readonly now: () => Date;

  constructor(root: string, now = () => new Date()) {
    this.root = root;
    this.now = now;
  }

  private async ensureDirectories() {
    await Promise.all([
      mkdir(join(this.root, "pending"), { recursive: true }),
      mkdir(join(this.root, "sent"), { recursive: true })
    ]);
  }

  async capture(input: DesktopFailureInput): Promise<DesktopFailureRecord> {
    await this.ensureDirectories();
    const kind = truncate(input.kind || "renderer_error", 80);
    const message = redact(truncate(input.message || "Unknown renderer failure", 4_000));
    const stackTrace = redact(truncate(input.stackTrace, 24_000));
    const capturedAt = this.now().toISOString();
    // Prefer message in the fingerprint so distinct terminal failures (timeout vs
    // gateway refused vs tool-host exit) do not collapse into one stale ticket.
    const fingerprint = createHash("sha256")
      .update(`${kind}\n${message}\n${stackTrace}`)
      .digest("hex");
    const record: DesktopFailureRecord = {
      id: `desktop-error-${capturedAt.replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`,
      kind,
      message,
      stackTrace,
      context: sanitizeContext(input.context),
      deviceId: truncate(input.deviceId, 160),
      appVersion: truncate(input.appVersion, 64),
      capturedAt,
      fingerprint
    };
    const target = join(this.root, "pending", `${record.id}.json`);
    await writeFile(target, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    return record;
  }

  async flush(upload: (record: DesktopFailureRecord) => Promise<void>) {
    await this.ensureDirectories();
    const names = (await readdir(join(this.root, "pending"))).filter((name) => name.endsWith(".json")).sort();
    let uploaded = 0;
    let failed = 0;
    for (const name of names) {
      const pendingPath = join(this.root, "pending", name);
      try {
        const record = JSON.parse(await readFile(pendingPath, "utf8")) as DesktopFailureRecord;
        await upload(record);
        await rename(pendingPath, join(this.root, "sent", name));
        uploaded += 1;
      } catch {
        failed += 1;
      }
    }
    return { uploaded, failed };
  }
}
