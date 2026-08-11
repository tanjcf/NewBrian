import type { ModelChatInput, ModelConfig } from "@codex-forge/protocol";
import type { CodexStorage } from "./codex-storage.js";
import { shouldEnforceGovernmentDraftLength } from "./government-outline-decision.js";
import {
  buildGovernmentWritingFinalizationRequest,
  createGovernmentFinalizationReplacementEmitter,
  parseGovernmentWritingFinalization,
  sanitizeGovernmentDraftForDelivery,
  selectGovernmentDraftCandidate
} from "./government-writing-finalization.js";
import {
  enforceGovernmentWritingLength,
  isGovernmentWritingLengthAccepted,
  parseRequestedLengthRange
} from "./government-writing-output.js";
import { JsonStringFieldStream } from "./json-field-stream.js";
import { extractFirstJsonObject } from "./json-extraction.js";
import { selectResearchIntakeModel } from "./research-intake.js";
import { requestedArtifactFormats, requestedArtifactSatisfied } from "./native-tool-prompt-policy.js";
import type { WrittenArtifact } from "./output-summary.js";
import { preserveSubstantiveGovernmentDraft } from "./government-draft-preservation.js";

interface FinalizationResponse { content: string }
interface FinalizationCall extends Record<string, unknown> {
  signal: AbortSignal;
  systemPrompt: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  tools: unknown[];
  onTextDelta?: (delta: string) => void;
}

export interface GovernmentFinalizationDependencies<TResponse extends FinalizationResponse> {
  storage: CodexStorage;
  readAuthorizedModelConfig: () => Promise<ModelConfig>;
  callModel: (input: FinalizationCall) => Promise<TResponse>;
  appendDiagnostics: (entry: string) => Promise<unknown>;
  appendDebugLog: (entry: string) => Promise<unknown>;
}

type GoalSnapshot = ReturnType<CodexStorage["getGoalSnapshot"]>;
type Finalization = ReturnType<typeof parseGovernmentWritingFinalization>;

/** Finalizes, length-validates, reviews, and completes a government-writing goal. */
export class GovernmentFinalizationService<TResponse extends FinalizationResponse> {
  private readonly dependencies: GovernmentFinalizationDependencies<TResponse>;

  constructor(dependencies: GovernmentFinalizationDependencies<TResponse>) {
    this.dependencies = dependencies;
  }

  async run(input: {
    enabled: boolean;
    threadId: string;
    modelInput: ModelChatInput;
    generatedContent: string;
    latestUserRequest: string;
    loopMessages: Array<{ role: string; content: string }>;
    requestMessages: Array<{ role: string; content: string }>;
    goalSnapshot: GoalSnapshot;
    abortSignal: AbortSignal;
    effectiveSystemPrompt: string;
    writtenArtifacts: WrittenArtifact[];
    emitStream: (payload: { requestId: string; delta: string; reset?: boolean }) => void;
    deliveryOnly?: boolean;
  }) {
    let generatedContent = input.generatedContent;
    let goalSnapshot = input.goalSnapshot;
    if (input.deliveryOnly) {
      if (input.enabled && requestedArtifactSatisfied(input.latestUserRequest, input.writtenArtifacts)) {
        goalSnapshot = this.completeGoal(input.threadId);
        generatedContent = generatedContent
          .replace(/\n*(?:PDF 文件|请求的输出文件)尚未生成并验证[\s\S]*?不能把聊天正文当作(?: PDF)? 文件?交付。\s*/u, "\n")
          .trim();
        const deliveries = input.writtenArtifacts
          .filter((artifact) => !generatedContent.includes(`](${artifact.path})`))
          .map((artifact) => `${artifact.path.split(".").at(-1)?.toUpperCase() || "文件"} 已生成并验证：[${artifact.path}](${artifact.path})（${artifact.size} 字节）`);
        generatedContent = [generatedContent, ...deliveries].filter(Boolean).join("\n\n");
      }
      return { generatedContent, goalSnapshot, finalizationFailed: false };
    }
    let finalization: Finalization | null = null;
    let failed = false;
    const candidates = [
      ...[...input.loopMessages].reverse().filter((message) => message.role === "assistant").map((message) => message.content),
      ...[...input.requestMessages].reverse().filter((message) => message.role === "assistant").map((message) => message.content)
    ];
    if (
      input.enabled
      && generatedContent.trim()
      && goalSnapshot?.goal.status === "active"
      && !goalSnapshot.pendingQuestion
      && shouldEnforceGovernmentDraftLength(goalSnapshot)
    ) {
      try {
        const config = await this.dependencies.readAuthorizedModelConfig();
        const model = (config.availableModels ?? []).find(
          (item) => item.model.toLowerCase() === input.modelInput.reviewModel.toLowerCase()
        ) ?? selectResearchIntakeModel(config, config.availableModels ?? []);
        const draftCandidate = selectGovernmentDraftCandidate(generatedContent, candidates);
        if (!draftCandidate || draftCandidate.replace(/\s+/g, "").length < 80) {
          generatedContent = [
            "正文尚未在对话中完整输出，不能进入风格统一、事实核验或交付完成。",
            "请继续直接输出完整正文（含全部章节），不要用「初稿已完成」「字数声明」或验证表代替正文。",
            "风格统一与事实边界由系统在正文可见后自动终审，无需用户额外确认。"
          ].join("\n");
          return { generatedContent, goalSnapshot, finalizationFailed: true };
        }
        let priorInvalid = "";
        let priorError = "";
        for (let attempt = 1; attempt <= 2; attempt += 1) {
          let response: TResponse | null = null;
          try {
            const stream = new JsonStringFieldStream("finalDraft");
            const emitReplacement = createGovernmentFinalizationReplacementEmitter(
              input.modelInput.requestId,
              input.emitStream
            );
            response = await this.dependencies.callModel({
              ...input.modelInput,
              provider: model.provider,
              model: model.model,
              reasoningEffort: "low",
              signal: input.abortSignal,
              systemPrompt: "You are the final style and fact-boundary reviewer for a government-writing workflow. Return valid JSON only.",
              messages: [{
                role: "user",
                content: [
                  buildGovernmentWritingFinalizationRequest(input.latestUserRequest, draftCandidate),
                  priorInvalid
                    ? `\nThe previous finalization was invalid (${priorError}). Return corrected JSON and remove every identified violation:\n${priorInvalid}`
                    : ""
                ].filter(Boolean).join("\n")
              }],
              tools: [],
              onTextDelta: (delta) => {
                const visibleDelta = stream.push(delta);
                if (visibleDelta) {
                  if (attempt === 1) input.emitStream({ requestId: input.modelInput.requestId, delta: visibleDelta });
                  else emitReplacement(visibleDelta);
                }
              }
            });
            finalization = parseGovernmentWritingFinalization(response.content ?? "");
            const evidenceText = [
              input.latestUserRequest,
              input.modelInput.toolContext ?? "",
              ...input.requestMessages.filter((message) => message.role === "user").map((message) => message.content)
            ].join("\n");
            finalization.finalDraft = sanitizeGovernmentDraftForDelivery(
              finalization.finalDraft,
              evidenceText
            );
            finalization.finalDraft = preserveSubstantiveGovernmentDraft(
              finalization.finalDraft,
              sanitizeGovernmentDraftForDelivery(draftCandidate, evidenceText)
            );
            if (finalization.finalDraft.replace(/\s+/g, "").length < 80) {
              throw new Error("Government writing finalDraft lost substantive content after evidence-boundary enforcement.");
            }
            break;
          } catch (error) {
            priorInvalid = response ? String(response.content ?? "").slice(0, 10_000) : priorInvalid;
            priorError = error instanceof Error ? error.message : String(error);
            if (attempt === 2 && response) finalization = this.recoverFinalization(response.content, input.latestUserRequest);
            if (finalization) break;
            if (attempt === 2 || input.abortSignal.aborted) throw error;
          }
        }
        if (!finalization) throw new Error("Government writing finalizer did not produce a substantive result.");
        generatedContent = finalization.finalDraft;
        goalSnapshot = this.markReviewsInProgress(input.threadId, finalization);
      } catch (error) {
        failed = true;
        await this.dependencies.appendDiagnostics(
          `government writing finalization failed: ${error instanceof Error ? error.message : String(error)}`
        );
        const recovered = selectGovernmentDraftCandidate(generatedContent, candidates);
        generatedContent = recovered
          ? [
            recovered,
            "正文初稿已生成，但风格统一与事实边界终审未完成。目标保持进行中，不会将未校验初稿标记为交付完成。"
          ].join("\n\n")
          : [
            "正文尚未在对话中完整输出，风格统一与事实边界终审未启动。",
            "请继续输出完整正文后再交付；不要将进度说明或验证表当作正文。"
          ].join("\n");
      }
    }

    const requestedLength = input.enabled
      ? parseRequestedLengthRange([input.latestUserRequest, input.modelInput.toolContext ?? ""].filter(Boolean).join("\n"))
      : null;
    if (
      requestedLength
      && generatedContent
      && !failed
      && shouldEnforceGovernmentDraftLength(goalSnapshot)
      && !isGovernmentWritingLengthAccepted(generatedContent, requestedLength)
    ) {
      generatedContent = await enforceGovernmentWritingLength({
        text: generatedContent,
        range: requestedLength,
        evidenceContext: [
          input.latestUserRequest,
          input.modelInput.toolContext ?? "",
          ...input.requestMessages.map((message) => message.content)
        ].join("\n"),
        onRevision: async (count, revision) => {
          await this.dependencies.appendDebugLog(
            `government writing length revision=${revision} count=${count} target=${requestedLength.min}-${requestedLength.max}`
          );
        },
        revise: async (currentText, currentCount) => {
          const revised = await this.dependencies.callModel({
            ...input.modelInput,
            signal: input.abortSignal,
            systemPrompt: input.effectiveSystemPrompt,
            tools: [],
            onTextDelta: (delta: string) => {
              if (delta) input.emitStream({ requestId: input.modelInput.requestId, delta });
            },
            messages: [
              { role: "user", content: input.latestUserRequest },
              { role: "assistant", content: currentText },
              {
                role: "user",
                content: `上稿按可见正文字符计为 ${currentCount} 字，不符合 ${requestedLength.min}-${requestedLength.max} 字的硬性验收范围。请在保持已确认结构、事实边界和【待核验】标记的前提下修订。只返回修订后的完整正文，不要解释、不执行工具、不创建文件。`
              }
            ]
          });
          const candidate = sanitizeGovernmentDraftForDelivery(revised.content || "", input.latestUserRequest);
          if (/(?:我们(?:被要求|需要|当前)|让我|我决定|步骤[:：]|artifact\.(?:create|inspect)|workspace\.write_file|shell\.exec|PDF 文件尚未生成)/i.test(candidate)) {
            return currentText;
          }
          return candidate || currentText;
        },
        // A single rewrite is not reliable with reasoning models: they can
        // preserve the evidence boundary yet still return an abbreviated
        // article. Keep revising the preserved draft within the hard range;
        // enforceGovernmentWritingLength still rejects the result after the
        // bounded third attempt instead of treating a short draft as complete.
        maxRevisions: 3
      });
    }
    const artifactSatisfied = requestedArtifactSatisfied(input.latestUserRequest, input.writtenArtifacts);
    if (finalization && artifactSatisfied) {
      generatedContent = [generatedContent, this.formatReview(finalization)].join("\n\n");
      goalSnapshot = this.completeGoal(input.threadId);
    } else if (finalization && !artifactSatisfied) {
      generatedContent = [
        generatedContent,
        this.formatReview(finalization),
        `请求的输出文件尚未生成并验证（${requestedArtifactFormats(input.latestUserRequest).map((format) => format.toUpperCase()).join("、") || "未知格式"}），目标保持进行中。请继续执行文件创建与 artifact.inspect 验证，不能把聊天正文当作文件交付。`
      ].join("\n\n");
    }
    return { generatedContent, goalSnapshot, finalizationFailed: failed };
  }

  private recoverFinalization(content: string, latestRequest: string): Finalization | null {
    const json = extractFirstJsonObject(content ?? "");
    if (!json) return null;
    try {
      const parsed = JSON.parse(json) as Partial<Finalization>;
      const finalDraft = sanitizeGovernmentDraftForDelivery(String(parsed.finalDraft ?? ""), latestRequest);
      if (finalDraft.replace(/\s+/g, "").length < 80) return null;
      return {
        finalDraft,
        styleReview: "已统一为克制、务实的内部部署讲话语体。",
        factReview: "已移除无来源的日期、机构、成绩和执行机制表述。",
        verificationNeeded: []
      };
    } catch {
      return null;
    }
  }

  private markReviewsInProgress(threadId: string, finalization: Finalization) {
    const goal = this.dependencies.storage.getGoal(threadId);
    if (!goal || goal.status !== "active") return this.dependencies.storage.getGoalSnapshot(threadId);
    const plan = this.dependencies.storage.listGoalPlan(threadId, goal.goalId).map((step) => {
      const identity = `${step.stepId} ${step.title}`;
      if (/draft|起草|正文|撰写|初稿/i.test(identity)) return { ...step, status: "completed" as const, result: "Draft produced from the confirmed outline." };
      if (/style|风格|文风/i.test(identity)) return { ...step, status: "completed" as const, result: finalization.styleReview };
      if (/fact|verify|事实|核验/i.test(identity)) return { ...step, status: "completed" as const, result: finalization.factReview };
      if (/delivery|交付/i.test(identity)) return { ...step, status: "in_progress" as const };
      return step;
    });
    this.dependencies.storage.replaceGoalPlan(threadId, goal.goalId, plan);
    return this.dependencies.storage.getGoalSnapshot(threadId);
  }

  private formatReview(finalization: Finalization) {
    return [
      "### 终审结果",
      `- 文风统一：${finalization.styleReview}`,
      `- 事实边界：${finalization.factReview}`,
      ...(finalization.verificationNeeded.length
        ? finalization.verificationNeeded.map((item) => `- 待核验：${item}`)
        : ["- 待核验：无"])
    ].join("\n");
  }

  private completeGoal(threadId: string) {
    const goal = this.dependencies.storage.getGoal(threadId);
    if (!goal || goal.status !== "active") return this.dependencies.storage.getGoalSnapshot(threadId);
    const plan = this.dependencies.storage.listGoalPlan(threadId, goal.goalId).map((step) =>
      /delivery|交付/i.test(`${step.stepId} ${step.title}`)
        ? { ...step, status: "completed" as const, result: "Final draft delivered after length, style, and fact-boundary checks." }
        : step
    );
    this.dependencies.storage.replaceGoalPlan(threadId, goal.goalId, plan);
    this.dependencies.storage.updateGoal(threadId, "complete");
    return this.dependencies.storage.getGoalSnapshot(threadId);
  }
}
