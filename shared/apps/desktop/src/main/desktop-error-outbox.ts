import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
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

const CONTEXT_CHAR_BUDGET = 16_000;
const SENSITIVE_CONTEXT_KEY = /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|authorization|cookie|secret)/i;

const boundedText = (value: unknown, limit: number, keepTail = false) => {
  const text = typeof value === "string" ? value : String(value ?? "");
  if (text.length <= limit) return text;
  const marker = "\n...[TRUNCATED]...\n";
  const available = Math.max(0, limit - marker.length);
  return keepTail
    ? `${marker}${text.slice(-available)}`
    : `${text.slice(0, available)}${marker}`;
};

const sanitizeContextValue = (value: unknown, seen = new WeakSet<object>()): unknown => {
  if (typeof value === "string") return redact(value);
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map((item) => sanitizeContextValue(item, seen));
  if (!value || typeof value !== "object") return String(value ?? "");
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = SENSITIVE_CONTEXT_KEY.test(key)
      ? "[REDACTED]"
      : sanitizeContextValue(item, seen);
  }
  seen.delete(value);
  return output;
};

const compactConversation = (value: unknown) => {
  if (!Array.isArray(value)) return undefined;
  return value.slice(-6).map((item) => {
    const record = item && typeof item === "object" && !Array.isArray(item)
      ? item as Record<string, unknown>
      : { content: item };
    return {
      ...(record.id == null ? {} : { id: boundedText(record.id, 160) }),
      ...(record.role == null ? {} : { role: boundedText(record.role, 32) }),
      content: boundedText(record.content, 560)
    };
  });
};

const buildBudgetedContext = (context: Record<string, unknown>, originalChars: number) => {
  const output: Record<string, unknown> = {};
  const scalarLimits: Record<string, number> = {
    symptomSummary: 1_200,
    possibleCause: 1_800,
    contextSummary: 1_600
  };
  for (const key of ["feedbackSchemaVersion", "category"] as const) {
    if (context[key] != null) output[key] = context[key];
  }
  if (Array.isArray(context.stableFeatures)) {
    output.stableFeatures = context.stableFeatures.slice(0, 8).map((item) => boundedText(item, 120));
  }
  for (const [key, limit] of Object.entries(scalarLimits)) {
    if (context[key] != null) output[key] = boundedText(context[key], limit);
  }
  const recentConversation = compactConversation(context.recentConversation);
  if (recentConversation?.length) output.recentConversation = recentConversation;
  if (context.diagnostics != null) output.diagnostics = boundedText(context.diagnostics, 5_000, true);

  output.truncation = {
    applied: true,
    originalChars,
    strategy: "structured_field_budget_v1",
    retainedFields: Object.keys(output)
  };
  let serialized = JSON.stringify(output);
  if (serialized.length > CONTEXT_CHAR_BUDGET && typeof output.diagnostics === "string") {
    output.diagnostics = boundedText(output.diagnostics, 2_000, true);
    serialized = JSON.stringify(output);
  }
  if (serialized.length > CONTEXT_CHAR_BUDGET) {
    delete output.recentConversation;
  }
  (output.truncation as Record<string, unknown>).retainedChars = JSON.stringify(output).length;
  return output;
};

const sanitizeContext = (context: Record<string, unknown> | undefined): Record<string, unknown> => {
  try {
    const sanitized = sanitizeContextValue(context ?? {}) as Record<string, unknown>;
    const serialized = JSON.stringify(sanitized);
    if (serialized.length <= CONTEXT_CHAR_BUDGET) return sanitized;
    return buildBudgetedContext(sanitized, serialized.length);
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

  async pruneSent(input: { maxCount?: number; maxAgeMs?: number; nowMs?: number } = {}): Promise<number> {
    await this.ensureDirectories();
    const maxCount = input.maxCount ?? 200;
    const maxAgeMs = input.maxAgeMs ?? 30 * 24 * 60 * 60 * 1_000;
    const nowMs = input.nowMs ?? Date.now();
    const sentRoot = join(this.root, "sent");
    const names = (await readdir(sentRoot)).filter((name) => name.endsWith(".json")).sort();
    const candidates: Array<{ name: string; createdAt: string }> = [];
    for (const name of names) {
      try {
        const record = JSON.parse(await readFile(join(sentRoot, name), "utf8")) as DesktopFailureRecord;
        candidates.push({ name, createdAt: record.capturedAt || "1970-01-01T00:00:00.000Z" });
      } catch {
        candidates.push({ name, createdAt: "1970-01-01T00:00:00.000Z" });
      }
    }
    const sorted = candidates.sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
    const victims = sorted.filter((item, index) => {
      const age = nowMs - Date.parse(item.createdAt);
      return (Number.isFinite(age) && age > maxAgeMs) || index < Math.max(0, sorted.length - maxCount);
    });
    let removed = 0;
    for (const victim of victims) {
      try {
        await unlink(join(sentRoot, victim.name));
        removed += 1;
      } catch {
        /* Ignore races with concurrent flush. */
      }
    }
    return removed;
  }
}
