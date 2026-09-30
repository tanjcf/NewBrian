import type { ModelChatInput, ModelConfig } from "@codex-forge/protocol";
import type { CodexStorage } from "./codex-storage.js";
import {
  buildFallbackGovernmentOutlineDecision,
  buildGovernmentOutlineSource,
  buildGovernmentOutlineDecisionRequest,
  expandDurableOutlineResult,
  extractGovernmentOutlineSections,
  formatGovernmentOutlineMarkdown,
  isCompleteGovernmentOutline,
  markGovernmentOutlineReady,
  parseGovernmentOutlineDecision,
  shouldRunGovernmentOutlineService
} from "./government-outline-decision.js";
import { JsonStringFieldStream } from "./json-field-stream.js";
import { extractFirstJsonObject } from "./json-extraction.js";
import { sanitizeVisibleModelContent } from "./model-stream-visibility.js";
import { selectResearchIntakeModel } from "./research-intake.js";

interface OutlineModelResponse {
  content: string;
}

interface OutlineModelCall extends Record<string, unknown> {
  signal: AbortSignal;
  systemPrompt: string;
  messages: Array<{ role: "user"; content: string; attachments?: unknown[] }>;
  tools: unknown[];
  onTextDelta: (delta: string) => void;
}

export interface GovernmentOutlineServiceDependencies<TResponse extends OutlineModelResponse> {
  storage: CodexStorage;
  readAuthorizedModelConfig: () => Promise<ModelConfig>;
  callModel: (input: OutlineModelCall) => Promise<TResponse>;
  appendDiagnostics: (entry: string) => Promise<unknown>;
  extractAttachmentText: (filePath: string) => Promise<string>;
}

/** Produces and durably stages the government outline-confirmation decision. */
export class GovernmentOutlineService<TResponse extends OutlineModelResponse> {
  private readonly dependencies: GovernmentOutlineServiceDependencies<TResponse>;

  constructor(dependencies: GovernmentOutlineServiceDependencies<TResponse>) {
    this.dependencies = dependencies;
  }

  async run(input: {
    enabled: boolean;
    threadId: string;
    modelInput: ModelChatInput;
    generatedContent: string;
    latestUserRequest: string;
    loopMessages: Array<{ role: string; content: string }>;
    goalSnapshot: ReturnType<CodexStorage["getGoalSnapshot"]>;
    abortSignal: AbortSignal;
    emitStream: (payload: { requestId: string; delta: string; reset?: boolean }) => void;
  }) {
    let generatedContent = input.generatedContent;
    let goalSnapshot = input.goalSnapshot;
    // Modern writing-specification plans have no outline-confirmation gate. Any
    // non-intake pending question (e.g. model-asked report type) must not enter
    // the legacy outline path or it throws and aborts the turn.
    if (!input.enabled || !shouldRunGovernmentOutlineService(goalSnapshot, generatedContent)) {
      return { generatedContent, goalSnapshot };
    }

    const latestAttachments = [...new Map(
      input.modelInput.messages
        .filter((message) => message.role === "user")
        .flatMap((message) => message.attachments ?? [])
        .map((attachment) => [attachment.path, attachment])
    ).values()];
    const materialParts: string[] = [];
    for (const attachment of latestAttachments) {
      if (/\.(?:png|jpe?g|webp|gif)$/i.test(attachment.path)) {
        materialParts.push(`[\u73b0\u573a\u56fe\u7247\u5df2\u63d0\u4f9b: ${attachment.name}]`);
        continue;
      }
      try {
        const text = await this.dependencies.extractAttachmentText(attachment.path);
        materialParts.push(`[\u9644\u4ef6: ${attachment.name}]\n${text.slice(0, 80_000)}`);
      } catch (error) {
        await this.dependencies.appendDiagnostics(`government outline attachment extraction failed (${attachment.path}): ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const materialContext = materialParts.join("\n\n");
    const outlineSource = buildGovernmentOutlineSource(
      generatedContent,
      goalSnapshot?.plan
    );

    let priorInvalidDecision = "";
    let priorDecisionError = "";
    let streamedOutlineCharacters = 0;
    try {
      const config = await this.dependencies.readAuthorizedModelConfig();
      const model = (config.availableModels ?? []).find(
        (item) => item.model.toLowerCase() === input.modelInput.reviewModel.toLowerCase()
      ) ?? selectResearchIntakeModel(config, config.availableModels ?? []);
      let decision: ReturnType<typeof parseGovernmentOutlineDecision> | null = null;
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        let response: TResponse | null = null;
        try {
          const stream = new JsonStringFieldStream("outline");
          response = await this.dependencies.callModel({
            ...input.modelInput,
            provider: model.provider,
            model: model.model,
            reasoningEffort: "low",
            signal: input.abortSignal,
            systemPrompt: "You generate a structured government-writing outline decision. Return valid JSON only.",
            messages: [{
              role: "user",
              content: [
                buildGovernmentOutlineDecisionRequest(input.latestUserRequest, outlineSource),
                priorInvalidDecision
                  ? `\nThe previous JSON was invalid (${priorDecisionError}). Repair it without dropping the complete outline or model-derived options:\n${priorInvalidDecision}`
                  : "",
                materialContext ? `\nExtracted attachment material (fact boundary):\n${materialContext}` : ""
              ].filter(Boolean).join("\n")
            }],
            tools: [],
            onTextDelta: (delta) => {
              const visibleDelta = stream.push(delta);
              if (!visibleDelta) return;
              streamedOutlineCharacters += Array.from(visibleDelta).length;
              input.emitStream({ requestId: input.modelInput.requestId, delta: visibleDelta });
            }
          });
          decision = parseGovernmentOutlineDecision(response.content ?? "");
          if (
            extractGovernmentOutlineSections(decision.outline).length < 4
            || /用户要求|调整提纲|暂时不要生成/u.test(decision.outline)
          ) {
            throw new Error("Outline decision echoed instructions or omitted material-bound sections.");
          }
          break;
        } catch (error) {
          priorInvalidDecision = response ? String(response.content ?? "").slice(0, 8_000) : priorInvalidDecision;
          priorDecisionError = error instanceof Error ? error.message : String(error);
          if (attempt === 2 || input.abortSignal.aborted) throw error;
          input.emitStream({ requestId: input.modelInput.requestId, delta: "", reset: true });
        }
      }
      if (!decision) throw new Error("Outline decision model did not produce a complete outline.");
      const displayOutline = formatGovernmentOutlineMarkdown(
        decision.outline,
        Boolean(input.goalSnapshot?.pendingQuestion)
      );
      // Replace the raw streamed outline with the styled markdown presentation.
      input.emitStream({ requestId: input.modelInput.requestId, delta: "", reset: true });
      input.emitStream({ requestId: input.modelInput.requestId, delta: displayOutline });
      generatedContent = displayOutline;
      const goal = this.dependencies.storage.getGoal(input.threadId);
      if (goal?.status === "active") {
        if (!goalSnapshot?.pendingQuestion) this.dependencies.storage.createGoalQuestion(input.threadId, goal.goalId, decision);
        const plan = this.dependencies.storage.listGoalPlan(input.threadId, goal.goalId);
        this.dependencies.storage.replaceGoalPlan(input.threadId, goal.goalId, markGovernmentOutlineReady(plan, decision.outline));
        goalSnapshot = this.dependencies.storage.getGoalSnapshot(input.threadId);
      }
    } catch (error) {
      await this.dependencies.appendDiagnostics(
        `government outline decision fallback failed: ${error instanceof Error ? error.message : String(error)}`
      );
      const existingQuestion = this.dependencies.storage.getGoalSnapshot(input.threadId)?.pendingQuestion;
      if (existingQuestion) {
        let recoveredOutline = [...input.loopMessages].reverse()
          .filter((message) => message.role === "assistant")
          .map((message) => message.content)
          .find((content) => isCompleteGovernmentOutline(content)) ?? sanitizeVisibleModelContent(generatedContent);
        const recoveredJson = extractFirstJsonObject(priorInvalidDecision);
        if (recoveredJson) {
          try {
            const candidate = String((JSON.parse(recoveredJson) as { outline?: unknown }).outline ?? "").trim();
            if (candidate) recoveredOutline = candidate;
          } catch {
            // Preserve the agent-generated outline when repair JSON is malformed.
          }
        }
        generatedContent = formatGovernmentOutlineMarkdown(recoveredOutline, true);
        await this.streamFallback(input.modelInput.requestId, generatedContent, streamedOutlineCharacters, input.emitStream);
        this.markReady(input.threadId, recoveredOutline);
      } else {
        const goal = this.dependencies.storage.getGoal(input.threadId);
        const durableOutlineResult = goal
          ? this.dependencies.storage.listGoalPlan(input.threadId, goal.goalId).find((step) => {
              const identity = `${step.stepId} ${step.title}`;
              return /outline|\u63d0\u7eb2|\u5927\u7eb2/i.test(identity)
                && !/confirm|\u786e\u8ba4/i.test(identity);
            })?.result ?? ""
          : "";
        const expandedDurableOutline = expandDurableOutlineResult(durableOutlineResult);
        if (isCompleteGovernmentOutline(expandedDurableOutline)) {
          const fallback = buildFallbackGovernmentOutlineDecision(expandedDurableOutline);
          generatedContent = formatGovernmentOutlineMarkdown(fallback.outline);
          if (goal?.status === "active") {
            this.dependencies.storage.createGoalQuestion(input.threadId, goal.goalId, fallback);
            this.markReady(input.threadId, fallback.outline);
          }
        } else {
          generatedContent = "写作结构生成失败，当前阶段已保留。请重试，系统不会使用预置行业模板替代本轮内容。";
        }
        await this.streamFallback(input.modelInput.requestId, generatedContent, streamedOutlineCharacters, input.emitStream);
      }
      goalSnapshot = this.dependencies.storage.getGoalSnapshot(input.threadId);
    }
    return { generatedContent, goalSnapshot };
  }

  private markReady(threadId: string, content: string) {
    const goal = this.dependencies.storage.getGoal(threadId);
    if (!goal || goal.status !== "active") return;
    const plan = this.dependencies.storage.listGoalPlan(threadId, goal.goalId);
    this.dependencies.storage.replaceGoalPlan(threadId, goal.goalId, markGovernmentOutlineReady(plan, content));
  }

  private async streamFallback(
    requestId: string,
    content: string,
    alreadyStreamed: number,
    emit: (payload: { requestId: string; delta: string }) => void
  ) {
    if (alreadyStreamed > 0 || !content.trim()) return;
    const characters = Array.from(content);
    const chunkSize = Math.max(10, Math.ceil(characters.length / 60));
    for (let index = 0; index < characters.length; index += chunkSize) {
      emit({ requestId, delta: characters.slice(index, index + chunkSize).join("") });
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 6));
    }
  }
}
