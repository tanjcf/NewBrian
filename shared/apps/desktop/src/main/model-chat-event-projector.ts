import type { WrittenArtifact } from "./output-summary.js";
import { classifyToolActivity, toolActivityDetail } from "../shared/tool-activity-policy.js";

interface RuntimeRunProjection {
  id?: string;
  callId?: string;
  cwd?: string;
  status?: string;
}

export interface ModelChatEventProjectionContext {
  requestId: string;
  workspacePath: string;
  writtenArtifacts: WrittenArtifact[];
  getRuns: () => RuntimeRunProjection[];
  emitReasoningSummary: (delta: string) => void;
  publishActivity: (activity: Record<string, unknown>, requestId: string) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function commandDetail(call: Record<string, unknown>) {
  const name = String(call.name ?? "");
  const args = isRecord(call.arguments) ? call.arguments : {};
  return toolActivityDetail(name, args);
}

/** Projects agent-loop tool events into renderer activities and artifact summaries. */
export class ModelChatEventProjector {
  project(context: ModelChatEventProjectionContext, event: unknown) {
    if (!isRecord(event) || typeof event.type !== "string" || !isRecord(event.payload)) return;
    const payload = event.payload;
    if (event.type === "tool_call") {
      const call = payload;
      const name = String(call.name ?? "");
      const semantic = classifyToolActivity(name);
      const detail = commandDetail(call);
      context.emitReasoningSummary(`\n${semantic.runningTitle}：${detail}。`);
      context.publishActivity({
        type: semantic.commandDetails ? "run" : "complete",
        title: semantic.runningTitle,
        detail,
        callId: call.id,
        toolName: name,
        ...(semantic.commandDetails ? { command: detail, cwd: context.workspacePath } : {}),
        status: "running"
      }, context.requestId);
      return;
    }
    if (event.type === "approval_requested" && isRecord(payload.call)) {
      const call = payload.call;
      const name = String(call.name ?? "");
      const semantic = classifyToolActivity(name);
      const detail = commandDetail(call);
      context.publishActivity({
        type: semantic.commandDetails ? "run" : "complete",
        title: "等待批准",
        detail,
        callId: call.id,
        toolName: name,
        ...(semantic.commandDetails ? { command: detail, cwd: context.workspacePath } : {}),
        status: "approval"
      }, context.requestId);
      return;
    }
    if (event.type !== "tool_result" || !isRecord(payload.result)) return;
    const result = payload.result;
    const callId = String(payload.callId ?? "");
    const name = String(payload.name ?? "");
    const semantic = classifyToolActivity(name);
    const run = context.getRuns().find((item) => item.callId === callId);
    const recordsArtifact = name === "workspace.write_file" || name === "artifact.create" || name === "document.create_pdf" || name === "document.create_docx" || (
      name === "artifact.inspect" && isRecord(result.artifact) && Number(result.artifact.size) > 0
    );
    if (recordsArtifact && result.ok && isRecord(result.artifact) && result.artifact.path) {
      const artifact = result.artifact;
      const artifactSize = Number(artifact.size) || 0;
      const priorIndex = context.writtenArtifacts.findIndex((item) => item.path === String(artifact.path));
      const priorArtifact = priorIndex >= 0 ? context.writtenArtifacts[priorIndex] : undefined;
      const nextArtifact: WrittenArtifact = {
        path: String(artifact.path),
        size: artifactSize,
        changeType: name === "artifact.inspect" && priorArtifact
          ? priorArtifact.changeType
          : artifact.changeType === "modified" ? "modified" : "created"
      };
      if (priorIndex >= 0) context.writtenArtifacts[priorIndex] = nextArtifact;
      else context.writtenArtifacts.push(nextArtifact);
      if (!priorArtifact || name === "workspace.write_file" || name === "artifact.create" || name === "document.create_pdf" || name === "document.create_docx") {
        context.publishActivity({
          type: "patch",
          title: `${nextArtifact.changeType === "created" ? "已新建" : "已编辑"} ${nextArtifact.path}`,
          detail: "",
          artifactPath: nextArtifact.path,
          artifactSize: nextArtifact.size,
          artifactVerified: name === "artifact.inspect" || name === "artifact.create" || name === "document.create_pdf" || name === "document.create_docx"
        }, context.requestId);
      }
    }
    if (semantic.fileActivity && result.ok) return;
    context.publishActivity({
      type: semantic.commandDetails ? "run" : "complete",
      title: result.ok ? semantic.completedTitle : semantic.failedTitle,
      detail: String(result.detail ?? result.output ?? result.command ?? name).slice(0, 2_000),
      executionId: run?.id,
      callId,
      toolName: name,
      ...(semantic.commandDetails ? { command: String(result.command ?? name), cwd: run?.cwd } : {}),
      status: run?.status ?? (result.ok ? "completed" : "failed"),
      ...(semantic.commandDetails ? { exitCode: result.exitCode } : {}),
      durationMs: result.durationMs,
      stdout: result.stdout,
      stderr: result.stderr,
      failureMessage: result.failureMessage,
      outputTruncated: result.outputTruncated,
      originalOutputBytes: result.originalOutputBytes
    }, context.requestId);
  }
}
