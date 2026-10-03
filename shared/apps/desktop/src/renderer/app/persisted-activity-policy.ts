import { classifyToolActivity, toolActivityDetail } from "../../shared/tool-activity-policy.js";

type PersistedEvent = {
  id: string;
  type: string;
  createdAt: string;
  turnId?: string;
  payload: Record<string, unknown>;
};

export type PersistedActivity = Record<string, unknown> & {
  type: "run" | "patch" | "complete";
  title: string;
  detail: string;
  turnId?: string;
  createdAt?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function commandDetail(name: string, payload: Record<string, unknown>) {
  const args = isRecord(payload.arguments) ? payload.arguments : {};
  return toolActivityDetail(name, args);
}

/** Rebuilds user-visible activity rows from durable thread events after restart or navigation. */
export function projectPersistedActivities(events: PersistedEvent[] = []): PersistedActivity[] {
  const activities = new Map<string, PersistedActivity>();
  for (const event of events) {
    const payload = event.payload ?? {};
    if (event.type === "skill_loaded") {
      const name = String(payload.name ?? "Skill");
      activities.set(`skill:${event.id}`, {
        type: "complete",
        title: "已应用 Skill",
        detail: name,
        callId: `skill:${event.id}`,
        status: "completed",
        durationMs: 0,
        turnId: event.turnId,
        createdAt: event.createdAt
      });
      continue;
    }
    if (event.type === "context_compacted") {
      const compactedCount = Array.isArray(payload.compactedMessageIds) ? payload.compactedMessageIds.length : 0;
      activities.set(`context:${event.id}`, {
        type: "complete",
        title: "上下文已压缩",
        detail: `已压缩 ${compactedCount} 条较早消息；当前估算 ${Number(payload.estimatedTokens) || 0} / ${Number(payload.modelContextWindow) || 0} Token。`,
        callId: `context:${event.id}`,
        status: "completed",
        turnId: event.turnId,
        createdAt: event.createdAt
      });
      continue;
    }
    if (event.type === "tool_call") {
      const callId = String(payload.id ?? event.id);
      const name = String(payload.name ?? "工具");
      const semantic = classifyToolActivity(name);
      const detail = commandDetail(name, payload);
      activities.set(callId, {
        type: semantic.commandDetails ? "run" : "complete",
        title: semantic.runningTitle,
        detail,
        callId,
        toolName: name,
        ...(semantic.commandDetails ? { command: detail } : {}),
        status: "running",
        turnId: event.turnId,
        createdAt: event.createdAt
      });
      continue;
    }
    if (event.type === "approval" && isRecord(payload.call)) {
      const call = payload.call;
      const callId = String(call.id ?? event.id);
      const name = String(call.name ?? "工具");
      const semantic = classifyToolActivity(name);
      const detail = commandDetail(name, call);
      activities.set(callId, {
        ...(activities.get(callId) ?? {}),
        type: semantic.commandDetails ? "run" : "complete",
        title: "等待批准",
        detail,
        callId,
        toolName: name,
        ...(semantic.commandDetails ? { command: detail } : {}),
        status: "approval",
        turnId: event.turnId,
        createdAt: event.createdAt
      });
      continue;
    }
    if (event.type !== "tool_result" || !isRecord(payload.result)) continue;
    const result = payload.result;
    const callId = String(payload.callId ?? event.id);
    const prior = activities.get(callId);
    const name = String(payload.name ?? prior?.toolName ?? "工具");
    const semantic = classifyToolActivity(name);
    const artifact = isRecord(result.artifact) ? result.artifact : undefined;
    const detail = String(result.detail ?? result.output ?? result.command ?? prior?.detail ?? name).slice(0, 2_000);
    if (semantic.fileActivity && result.ok !== false && artifact?.path) {
      activities.set(callId, {
        type: "patch",
        title: `${artifact.changeType === "modified" ? "已编辑" : "已新建"} ${String(artifact.path)}`,
        detail: "",
        callId,
        artifactPath: String(artifact.path),
        artifactSize: Number(artifact.size) || 0,
        artifactVerified: name === "artifact.inspect" || name === "artifact.create" || name === "document.create_pdf" || name === "document.create_docx" || name === "office.convert",
        turnId: event.turnId ?? prior?.turnId,
        createdAt: event.createdAt
      });
      continue;
    }
    activities.set(callId, {
      ...(prior ?? {}),
      type: semantic.commandDetails ? "run" : "complete",
      title: result.ok === false ? semantic.failedTitle : semantic.completedTitle,
      detail,
      callId,
      toolName: name,
      ...(semantic.commandDetails ? { command: String(result.command ?? prior?.command ?? name) } : { command: undefined }),
      status: result.ok === false ? "failed" : "completed",
      exitCode: semantic.commandDetails ? result.exitCode : undefined,
      durationMs: result.durationMs,
      stdout: result.stdout,
      stderr: result.stderr,
      output: result.output,
      failureMessage: result.failureMessage,
      outputTruncated: result.outputTruncated,
      originalOutputBytes: result.originalOutputBytes,
      turnId: event.turnId ?? prior?.turnId,
      createdAt: event.createdAt
    });
  }
  return [...activities.values()];
}
