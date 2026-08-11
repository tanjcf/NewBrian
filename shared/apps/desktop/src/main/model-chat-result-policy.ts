import type { WrittenArtifact } from "./output-summary.js";
import { formatWrittenArtifactSummary, linkWrittenArtifactMentions } from "./output-summary.js";
import { extractPrivatePlanningNarration, sanitizeVisibleModelContent } from "./model-stream-visibility.js";
import { formatSkillDisclosure, type SkillDescriptor } from "./skill-selection.js";
import type { NativeWebSearchProjection } from "./model-chat-step-service.js";
import { buildEmptyTurnFallbackContent } from "./approval-continuation-policy.ts";

interface AssistantToolCall {
  id: string;
  name: string;
  arguments: unknown;
  [key: string]: unknown;
}

export interface ModelChatResultInput<TRuntimeSnapshot> {
  generatedContent: string;
  disclosedSkills: SkillDescriptor[];
  workspacePath: string;
  writtenArtifacts: WrittenArtifact[];
  reasoningSummary: string;
  toolCalls: AssistantToolCall[];
  nativeWebSearches: NativeWebSearchProjection[];
  awaitingApproval: boolean;
  runtimeSnapshot: TRuntimeSnapshot;
  latestUserRequest?: string;
  /** Soft stop that completed without throwing (e.g. government max-steps). */
  softStopReason?: "max_steps";
}

/** Creates one canonical user-visible and persisted result for a completed agent loop. */
export function buildModelChatResult<TRuntimeSnapshot>(input: ModelChatResultInput<TRuntimeSnapshot>) {
  const skillDisclosure = input.disclosedSkills.length
    ? `本轮使用 Skill：${formatSkillDisclosure(input.disclosedSkills)}。`
    : "";
  const planningNarration = extractPrivatePlanningNarration(input.generatedContent);
  let generatedContent = linkWrittenArtifactMentions(
    sanitizeVisibleModelContent(input.generatedContent),
    input.workspacePath,
    input.writtenArtifacts
  );
  const artifactSummary = formatWrittenArtifactSummary(input.workspacePath, input.writtenArtifacts);
  // Skill disclosure is execution telemetry. Keep it on the task/activity record, never in the final answer.
  let canonicalContent = [generatedContent, artifactSummary].filter(Boolean).join("\n\n");
  if (!canonicalContent.trim()) {
    if (input.awaitingApproval) {
      const pendingTools = input.toolCalls
        .map((call) => String(call.name || "").trim())
        .filter(Boolean)
        .slice(0, 4);
      canonicalContent = [
        "已请求执行工具，等待你批准后继续。",
        pendingTools.length ? `待确认工具：${pendingTools.join("、")}` : "",
        "批准后会继续生成可见结果；拒绝则本轮停止。"
      ].filter(Boolean).join("\n\n");
    } else {
      const runs = (input.runtimeSnapshot as { runs?: Array<{ status?: string; command?: string; failureMessage?: string; stderr?: string }> })
        ?.runs ?? [];
      canonicalContent = buildEmptyTurnFallbackContent({
        latestUserText: input.latestUserRequest,
        failedCommands: runs
          .filter((run) => run.status === "failed")
          .map((run) => ({
            command: run.command,
            failureMessage: run.failureMessage,
            stderr: run.stderr
          }))
      });
    }
  }
  const reasoningSummary = [input.reasoningSummary.trim(), planningNarration]
    .filter(Boolean)
    .filter((part, index, parts) => parts.indexOf(part) === index)
    .join("\n\n");
  const citations = [
    ...new Map(
      input.nativeWebSearches.flatMap((search) => search.citations).map((citation) => [citation.url, citation])
    ).values()
  ];
  return {
    skillDisclosure,
    canonicalContent,
    result: {
    // Keep partial answer visible while waiting for approval so the user can
    // review context next to the approval controls.
    content: canonicalContent,
      reasoningSummary,
      toolCalls: input.toolCalls.map((call) => ({
        ...call,
        arguments: typeof call.arguments === "string" ? call.arguments : JSON.stringify(call.arguments)
      })),
      webSearchCalls: input.nativeWebSearches.map(({ citations: _citations, ...search }) => search),
      citations,
      usage: undefined,
      awaitingApproval: input.awaitingApproval,
      runtimeSnapshot: input.runtimeSnapshot,
      softStopReason: input.softStopReason
    }
  };
}
