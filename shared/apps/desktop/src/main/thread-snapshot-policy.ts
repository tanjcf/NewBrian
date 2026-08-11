import type { ThreadStateFile } from "./thread-state-factory.js";

export interface ThreadRuntimeSnapshot {
  session: { status: string };
  approval?: { message?: string } | null;
  patch?: { summary?: string } | null;
  runs: Array<{ label: string; status?: string }>;
}

export function describeThreadSnapshot(snapshot: ThreadRuntimeSnapshot) {
  if (snapshot.patch?.summary) return `补丁更新: ${snapshot.patch.summary}`;
  if (snapshot.approval?.message) return `审批请求: ${snapshot.approval.message}`;
  if (snapshot.runs[0]) return `运行记录: ${snapshot.runs[0].label}`;
  return "线程内容已更新";
}

export function deriveThreadStatusMetadata(snapshot: ThreadRuntimeSnapshot) {
  const latestRun = snapshot.runs[0];
  if (snapshot.approval) return { status: "awaiting-approval" as const, statusLabel: "等待批准" };
  if (snapshot.session.status === "running" || latestRun?.status === "running" || latestRun?.status === "queued") {
    return { status: "running" as const, statusLabel: "运行中" };
  }
  if (snapshot.session.status === "failed" || latestRun?.status === "failed") {
    return { status: "failed" as const, statusLabel: "执行失败" };
  }
  return { status: "idle" as const, statusLabel: "" };
}

export function buildSnapshotWithThreadState<T extends ThreadRuntimeSnapshot>(snapshot: T, threadState: ThreadStateFile) {
  return {
    ...snapshot,
    messages: threadState.messages,
    memories: threadState.memories,
    runs: threadState.runs,
    timeline: threadState.timeline,
    events: threadState.events ?? []
  };
}
