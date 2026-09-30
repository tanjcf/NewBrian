export const agentCollaborationRoles = ["planner", "researcher", "verifier", "editor"] as const;
export type AgentCollaborationRole = typeof agentCollaborationRoles[number];

/** OpenClaw OC-12 defaults: depth-1 only; at most N concurrent children per parent. */
export const DEFAULT_MAX_SPAWN_DEPTH = 1;
export const DEFAULT_MAX_CHILDREN_PER_PARENT = 3;

export const DELEGATE_DEPTH_EXCEEDED = "delegate_depth_exceeded";
export const DELEGATE_CHILDREN_LIMIT = "delegate_children_limit";
export const DELEGATE_REFUSED_AFTER_FAILURE = "delegate_refused_after_failure";
export const WAIT_UNAVAILABLE = "wait_unavailable";

const EXTRA_ROLE_RE = /^[a-z][a-z0-9-]{1,63}$/;

/** Recovery package when child failures hit the hard refuse threshold (Codex-style actionable stop). */
export function buildDelegateFailureRecoveryMessage(failedCount: number) {
  const failed = Math.max(0, Math.trunc(failedCount));
  return [
    `Too many child failures (${failed}). Merge evidence and finish; do not keep re-delegating.`,
    "next_action: Do not call agent.delegate again this turn.",
    "Finish yourself with workspace-relative workspace.write_file / workspace.edit / workspace.apply_patch.",
    "Never write source via shell.exec (Set-Content, Out-File, heredoc, cat>).",
    "Summarize child evidence you already have and produce the final deliverable."
  ].join(" ");
}

export function normalizeDelegationRequest(
  input: Record<string, unknown>,
  options?: { allowedExtraRoles?: string[] }
) {
  const title = String(input.title ?? "").trim().slice(0, 120);
  const instruction = String(input.instruction ?? "").trim().slice(0, 12_000);
  const requestedRole = String(input.role ?? "researcher").trim();
  const allowedExtra = new Set(
    (options?.allowedExtraRoles ?? [])
      .map((role) => String(role || "").trim())
      .filter((role) => EXTRA_ROLE_RE.test(role))
  );
  const role = agentCollaborationRoles.includes(requestedRole as AgentCollaborationRole)
    ? requestedRole
    : allowedExtra.has(requestedRole)
      ? requestedRole
      : "researcher";
  if (!title || !instruction) throw new Error("Child agent title and instruction are required.");
  const dependsOn = [...new Set((Array.isArray(input.dependsOn) ? input.dependsOn : [])
    .map((value) => String(value).trim()).filter(Boolean))].slice(0, 8);
  return { title, instruction, role, dependsOn };
}

export function normalizeChildThreadIds(input: unknown, limit = 8) {
  const ids = [...new Set(
    (Array.isArray(input) ? input : [])
      .map((value) => String(value).trim())
      .filter(Boolean)
  )].slice(0, limit);
  if (ids.length === 0) throw new Error("At least one childThreadId is required.");
  return ids;
}

export function isTerminalDelegatedStatus(status: string | undefined | null) {
  const value = String(status || "").trim().toLowerCase();
  return value === "completed" || value === "failed" || value === "cancelled" || value === "canceled";
}

export function countActiveChildren(
  tasks: Array<{ status?: string }>,
  maxChildren = DEFAULT_MAX_CHILDREN_PER_PARENT
) {
  const active = tasks.filter((task) => !isTerminalDelegatedStatus(task.status)).length;
  return { active, maxChildren: Math.max(1, Math.trunc(maxChildren)), remaining: Math.max(0, Math.max(1, Math.trunc(maxChildren)) - active) };
}

export function assertCanDelegateChild(input: {
  parentKind?: string;
  spawnDepth?: number;
  maxSpawnDepth?: number;
  activeChildCount: number;
  maxChildrenPerParent?: number;
  recentFailedCount?: number;
  maxFailuresBeforeRefuse?: number;
}) {
  const maxSpawnDepth = Math.max(1, Math.trunc(input.maxSpawnDepth ?? DEFAULT_MAX_SPAWN_DEPTH));
  const spawnDepth = Math.max(0, Math.trunc(input.spawnDepth ?? (input.parentKind === "subagent" ? 1 : 0)));
  if (spawnDepth >= maxSpawnDepth || input.parentKind === "subagent") {
    const error = new Error(`Child agents cannot spawn further children (max_spawn_depth=${maxSpawnDepth}).`);
    (error as Error & { code?: string }).code = DELEGATE_DEPTH_EXCEEDED;
    throw error;
  }
  const maxChildren = Math.max(1, Math.trunc(input.maxChildrenPerParent ?? DEFAULT_MAX_CHILDREN_PER_PARENT));
  if (input.activeChildCount >= maxChildren) {
    const error = new Error(`At most ${maxChildren} active child agents are allowed for this parent.`);
    (error as Error & { code?: string }).code = DELEGATE_CHILDREN_LIMIT;
    throw error;
  }
  const maxFailures = Math.max(1, Math.trunc(input.maxFailuresBeforeRefuse ?? 2));
  const failed = Math.max(0, Math.trunc(input.recentFailedCount ?? 0));
  if (failed >= maxFailures) {
    const error = new Error(buildDelegateFailureRecoveryMessage(failed));
    (error as Error & { code?: string; nextAction?: string }).code = DELEGATE_REFUSED_AFTER_FAILURE;
    (error as Error & { code?: string; nextAction?: string }).nextAction = [
      "Do not call agent.delegate again this turn.",
      "Use workspace.write_file with relative paths; do not write files via shell.exec.",
      "Merge child evidence and finish the deliverable yourself."
    ].join(" ");
    throw error;
  }
}

export function buildAgentCollaborationInstruction(maxParallelAgents = DEFAULT_MAX_CHILDREN_PER_PARENT) {
  return [
    "You can delegate independent, bounded work to background child agents with agent.delegate.",
    "Child agents run as internal isolated sessions (not visible as sidebar threads); results return via agent.wait / announce.",
    `Use at most ${Math.max(1, Math.trunc(maxParallelAgents))} child agents at once.`,
    "Children cannot spawn further children.",
    "Classify greetings, thanks, farewells, simple confirmations, and short reliable conversation as ordinary chat; answer those directly and never delegate, search, switch models, or invoke tools.",
    "Delegate when independent work streams can proceed, a specialist or stronger model is required because the current Agent cannot reliably complete the task, or a separate verifier materially improves confidence.",
    "If you are about to say that you do not know, have not learned how to answer, or cannot answer, you MUST try the relevant retrieval/tool capability and delegate to a suitable child agent before returning a limitation.",
    "Do not delegate a small task the current Agent can reliably complete itself or work with strict sequential dependencies.",
    "Give every child a concrete objective, scope, expected evidence, and completion condition.",
    "Start independent children before calling agent.wait so they can run concurrently.",
    "Use agent.list to inspect status and agent.wait to collect results before making claims based on delegated work.",
    "If a child fails, treat the failure as terminal evidence: merge what you have and finish. Do not empty-loop re-delegate the same work.",
    "After repeated child failures the runtime refuses further agent.delegate; finish with workspace.write_file/edit/apply_patch using relative paths—never shell whole-file writes.",
    "The root agent remains responsible for resolving conflicts and producing the final deliverable."
  ].join(" ");
}

/** Wait for the active child run without imposing a wall-clock execution deadline. */
export async function waitForAgentRun<T>(
  run: Promise<T> | undefined,
  fallback: T | undefined
): Promise<{ ok: true; value: T } | { ok: false; code: typeof WAIT_UNAVAILABLE; value?: T }> {
  if (!run) {
    if (fallback !== undefined && isTerminalDelegatedStatus((fallback as { status?: string }).status)) {
      return { ok: true, value: fallback };
    }
    return { ok: false, code: WAIT_UNAVAILABLE, ...(fallback === undefined ? {} : { value: fallback }) };
  }
  try {
    return { ok: true, value: await run };
  } catch {
    if (fallback !== undefined && isTerminalDelegatedStatus((fallback as { status?: string }).status)) {
      return { ok: true, value: fallback };
    }
    return { ok: false, code: WAIT_UNAVAILABLE, ...(fallback === undefined ? {} : { value: fallback }) };
  }
}
