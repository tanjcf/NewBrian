/**
 * Persist user-approved shell commands so identical later calls skip the approval UI.
 */

export type ApprovalMemoryDecision = "allow" | "ask" | "deny";

export type ApprovalMemoryRule = {
  id: string;
  toolName: string;
  commandPrefix: string;
  decision: ApprovalMemoryDecision;
  enabled: boolean;
  reason: string;
  /** exact = full normalized command; prefix = legacy startsWith */
  match?: "exact" | "prefix";
};

/** Normalize a shell command for stable equality matching. */
export function normalizeApprovalCommand(command: string): string {
  return String(command ?? "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .replace(/[ \t]+/g, " ")
    .trim()
    .toLowerCase();
}

/** Stable id for a remembered shell allow rule. */
export function approvalMemoryRuleId(toolName: string, command: string): string {
  const key = normalizeApprovalCommand(command).slice(0, 120);
  const digest = Array.from(key).reduce((hash, char) => ((hash * 33) ^ char.charCodeAt(0)) >>> 0, 5381);
  return `remember-${String(toolName || "shell.exec").replace(/[^\w.-]+/g, "_")}-${digest.toString(16)}`;
}

/**
 * Build or update the policy rule list after the user approves a tool call.
 * Only shell.exec / exec commands are remembered; critical denies stay untouched.
 */
export function rememberApprovedCommand(
  rules: ApprovalMemoryRule[],
  input: { toolName?: string; command?: string }
): ApprovalMemoryRule[] {
  const toolName = String(input.toolName || "").trim() || "shell.exec";
  if (toolName !== "shell.exec" && toolName !== "exec") return rules;
  const command = String(input.command || "").trim();
  if (!command) return rules;
  const normalized = normalizeApprovalCommand(command);
  if (!normalized) return rules;
  const id = approvalMemoryRuleId(toolName, command);
  const next: ApprovalMemoryRule = {
    id,
    toolName: "shell.exec",
    commandPrefix: command.trim(),
    decision: "allow",
    enabled: true,
    reason: "user-approval-memory",
    match: "exact"
  };
  const withoutDup = rules.filter((rule) => {
    if (rule.id === id) return false;
    if (rule.match === "exact" && rule.toolName === "shell.exec"
      && normalizeApprovalCommand(rule.commandPrefix) === normalized) {
      return false;
    }
    return true;
  });
  return [next, ...withoutDup];
}

/**
 * Extract the pending shell command from a runtime approval / agent-loop pending payload.
 */
export function extractPendingApprovalCommand(snapshot: {
  approval?: { detail?: string; toolName?: string } | null;
  pendingTool?: { name?: string; arguments?: Record<string, unknown> } | null;
} | null | undefined, pending?: {
  call?: { name?: string; arguments?: Record<string, unknown> };
} | null): { toolName: string; command: string } | null {
  const call = pending?.call
    || (snapshot?.pendingTool
      ? { name: snapshot.pendingTool.name, arguments: snapshot.pendingTool.arguments }
      : null);
  const toolName = String(call?.name || snapshot?.approval?.toolName || "").trim();
  const args = call?.arguments && typeof call.arguments === "object" ? call.arguments : {};
  const command = String((args as { command?: unknown }).command ?? "").trim()
    || String(snapshot?.approval?.detail || "").trim();
  if (!toolName && !command) return null;
  return { toolName: toolName || "shell.exec", command };
}
