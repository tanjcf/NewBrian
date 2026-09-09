export type UsageExceptionCommandResult =
  | { matched: false }
  | { matched: true; description: string }
  | { matched: true; error: string };

const TRIGGER = "newbrain使用异常";
const DESCRIPTION_REQUIRED = "请补充 NewBrain 使用异常的具体现象。";

/** Parse the explicit user-feedback command without treating ordinary mentions as commands. */
export function parseUsageExceptionCommand(input: string): UsageExceptionCommandResult {
  const normalized = String(input ?? "").trim();
  const prefix = normalized.slice(0, TRIGGER.length);
  if (prefix.toLocaleLowerCase() !== TRIGGER) return { matched: false };

  const boundary = normalized.slice(TRIGGER.length, TRIGGER.length + 1);
  if (boundary && !/[\s:：]/u.test(boundary)) return { matched: false };

  const description = normalized
    .slice(TRIGGER.length)
    .replace(/^[\s:：]+/u, "")
    .trim();
  return description
    ? { matched: true, description }
    : { matched: true, error: DESCRIPTION_REQUIRED };
}
