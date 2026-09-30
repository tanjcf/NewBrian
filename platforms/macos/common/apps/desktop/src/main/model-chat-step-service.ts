import type { ModelChatInput } from "@codex-forge/protocol";
import {
  advanceAutoModelFallback,
  isAbnormalModelStepError,
  isAutoModelFallbackBlocked
} from "./model-auto-router.ts";

export interface ModelStepResponseShape {
  content: string;
  toolCalls: unknown[];
  usage?: unknown;
  /** Provider thinking trace for the current step (echo on later tool continuations). */
  reasoningSummary?: string;
  webSearchCalls: Array<{
    id: string;
    status: string;
    action?: unknown;
  }>;
  citations: Array<{ url: string; title: string }>;
  /** Real model resolved by spring-app Auto routing (never "auto"). */
  selectedModel?: string;
  routingReason?: string;
}

export interface ModelStepCall {
  signal: AbortSignal;
  systemPrompt: string;
  messages: unknown[];
  tools: unknown[];
  onTextDelta?: (delta: string) => void;
  onReasoningDelta: (delta: string) => void;
  [key: string]: unknown;
}

export interface ModelChatStepServiceDependencies<TResponse extends ModelStepResponseShape> {
  callModel: (input: ModelStepCall) => Promise<TResponse>;
  isRetryableError: (error: unknown) => boolean;
  readUsageTokens: (usage: unknown) => number;
  containsPrivatePlanning: (content: string) => boolean;
  /** Prefer sanitizeVisibleModelContent; defaults to identity when omitted (tests). */
  sanitizeVisibleContent?: (content: string) => string;
  /** Prefer extractPrivatePlanningNarration; defaults to empty when omitted (tests). */
  extractPlanningNarration?: (content: string) => string;
  delay?: (milliseconds: number) => Promise<void>;
}

export interface NativeWebSearchProjection {
  id: string;
  status: string;
  action?: unknown;
  citations: Array<{ url: string; title: string }>;
}

/** Stable empty-completion error shared by gateway parse and step validation. */
export const EMPTY_ASSISTANT_RESPONSE_ERROR =
  "Model response did not include assistant content or tool calls.";

export function isEmptyAssistantResponseError(error: unknown) {
  return error instanceof Error && error.message === EMPTY_ASSISTANT_RESPONSE_ERROR;
}

/** Executes one bounded model step while preserving visible-stream and retry policy. */
export class ModelChatStepService<TResponse extends ModelStepResponseShape> {
  private readonly dependencies: ModelChatStepServiceDependencies<TResponse>;

  constructor(dependencies: ModelChatStepServiceDependencies<TResponse>) {
    this.dependencies = dependencies;
  }

  async execute(input: {
    modelInput: ModelChatInput;
    messages: unknown[];
    tools: unknown[];
    systemPrompt: string;
    abortSignal: AbortSignal;
    suppressVisibleContent: boolean;
    requestId: string;
    emitReasoningSummary: (delta: string) => void;
    emitStream: (input: { requestId: string; delta: string; reset?: boolean }) => void;
    publishRetry: (requestId: string, attempt: number, maxAttempts: number, delayMs: number) => void;
    resilientGoalMode?: boolean;
    publishWebSearch: (action: unknown, requestId: string) => void;
    recordWebSearch: (search: NativeWebSearchProjection) => void;
    recordTokens: (tokens: number) => void;
    /**
     * Auto fallback_chain for「异常步长」recovery. When the current model step
     * fails abnormally after bounded same-model retries, advance to the next
     * alternate model and retry this step (does not replay tools).
     */
    modelFallback?: {
      enabled: boolean;
      selected: string;
      fallback_chain: string[];
      fallback_index?: number;
      onFallback?: (info: {
        from: string;
        to: string;
        fallbackIndex: number;
        reason: string;
      }) => void;
    };
  }): Promise<TResponse> {
    let response: TResponse | null = null;
    const retryDelaysMs = [500, 1_000, 2_000, 4_000, 8_000];
    const maxAttempts = retryDelaysMs.length + 1;
    let streamedContent = "";
    let activeModelInput = input.modelInput;
    let fallbackIndex = Math.max(0, Number(input.modelFallback?.fallback_index) || 0);
    const tryAdvanceModelFallback = (error: unknown): boolean => {
      if (!input.modelFallback?.enabled) return false;
      if (isAutoModelFallbackBlocked(error)) return false;
      if (!isAbnormalModelStepError(error) && !isEmptyAssistantResponseError(error)) {
        return false;
      }
      const advanced = advanceAutoModelFallback({
        selected: input.modelFallback.selected || String(activeModelInput.model || ""),
        fallback_chain: input.modelFallback.fallback_chain,
        fallback_index: fallbackIndex
      });
      if (!advanced) return false;
      const from = String(activeModelInput.model || input.modelFallback.selected || "");
      fallbackIndex = advanced.fallback_index;
      if (input.modelFallback) {
        input.modelFallback.fallback_index = advanced.fallback_index;
      }
      activeModelInput = { ...activeModelInput, model: advanced.model };
      // Keep shared turn identity on the recovered model for later steps.
      input.modelInput.model = advanced.model;
      const reason = error instanceof Error ? error.message : String(error ?? "abnormal step");
      input.modelFallback.onFallback?.({
        from,
        to: advanced.model,
        fallbackIndex: advanced.fallback_index,
        reason
      });
      input.emitReasoningSummary(
        `本轮模型步骤异常，正在切换到备用模型 ${advanced.model} 并重试。\n`
      );
      input.publishRetry(input.requestId, advanced.fallback_index, input.modelFallback.fallback_chain.length, 500);
      return true;
    };
    modelAttempt: for (;;) {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let streamedVisibleContent = false;
      let streamedReasoning = false;
      let resetOnFirstDelta = attempt > 1 && streamedContent.length > 0;
      let planningMode = false;
      let seenText = "";
      const emitVisible = (delta: string) => {
        if (!delta) return;
        if (resetOnFirstDelta) {
          input.emitStream({ requestId: input.requestId, delta: "", reset: true });
          streamedContent = "";
          resetOnFirstDelta = false;
        }
        streamedVisibleContent = true;
        streamedContent += delta;
        input.emitStream({ requestId: input.requestId, delta });
      };
      const emitReasoning = (delta: string) => {
        if (!delta) return;
        streamedReasoning = true;
        input.emitReasoningSummary(delta);
      };
      try {
        response = await this.dependencies.callModel({
          ...activeModelInput,
          signal: input.abortSignal,
          systemPrompt: input.systemPrompt,
          messages: input.messages,
          tools: input.tools,
          onTextDelta: (delta: string) => {
            if (!delta) return;
            if (planningMode) {
              emitReasoning(delta);
              return;
            }
            seenText += delta;
            if (this.dependencies.containsPrivatePlanning(seenText)) {
              planningMode = true;
              if (streamedVisibleContent) {
                // Keep already accepted chat text. Only divert the latest planning
                // delta so government-writing progress does not vanish mid-stream.
                emitReasoning(delta);
                return;
              }
              // No visible answer yet: move the whole planning trace into thinking.
              emitReasoning(seenText);
              return;
            }
            emitVisible(delta);
          },
          onReasoningDelta: (delta: string) => {
            emitReasoning(delta);
          }
        });
        const visibleAnswer = (this.dependencies.sanitizeVisibleContent
          ?? ((content: string) => (this.dependencies.containsPrivatePlanning(content) ? "" : content.trim())))(
          response.content
        );
        const planningNarration = (this.dependencies.extractPlanningNarration
          ?? ((content: string) => (this.dependencies.containsPrivatePlanning(content) ? content : "")))(
          response.content
        );
        if (
          !streamedVisibleContent
          && !streamedReasoning
          && input.suppressVisibleContent === false
          && response.content.trim()
        ) {
          if (visibleAnswer) {
            if (planningNarration) emitReasoning(planningNarration);
            const characters = Array.from(visibleAnswer);
            const chunkSize = Math.max(12, Math.ceil(characters.length / 80));
            for (let index = 0; index < characters.length; index += chunkSize) {
              emitVisible(characters.slice(index, index + chunkSize).join(""));
              await new Promise((resolveDelay) => setTimeout(resolveDelay, 6));
            }
          } else if (this.dependencies.containsPrivatePlanning(response.content) || planningNarration) {
            emitReasoning(planningNarration || response.content);
          } else {
            const characters = Array.from(response.content);
            const chunkSize = Math.max(12, Math.ceil(characters.length / 80));
            for (let index = 0; index < characters.length; index += chunkSize) {
              emitVisible(characters.slice(index, index + chunkSize).join(""));
              await new Promise((resolveDelay) => setTimeout(resolveDelay, 6));
            }
          }
        } else if (visibleAnswer && !streamedVisibleContent) {
          // Planning was diverted to the thinking panel, but a user-facing reply
          // (e.g. short Chinese greeting after English self-talk) is recoverable.
          if (planningNarration) emitReasoning(planningNarration);
          input.emitStream({ requestId: input.requestId, delta: "", reset: true });
          streamedContent = "";
          emitVisible(visibleAnswer);
        }
        if (visibleAnswer) {
          if (!streamedVisibleContent || response.content !== visibleAnswer) {
            // Prefer the sanitized user-facing body for downstream persistence when
            // we recovered from a mixed planning payload; keep already-streamed
            // progress turns intact when tools follow.
            if (!streamedVisibleContent || !response.toolCalls.length) {
              response = { ...response, content: visibleAnswer };
            }
          }
          if (response.selectedModel) {
            emitReasoning(`网关 Auto 实选并计费：${response.selectedModel}${response.routingReason ? `（${response.routingReason}）` : ""}\n`);
          }
          break;
        }
        if (
          !response.toolCalls.length
          && response.content.trim()
          && (
            this.dependencies.containsPrivatePlanning(response.content)
            || Boolean(planningNarration)
          )
        ) {
          throw new Error(EMPTY_ASSISTANT_RESPONSE_ERROR);
        }
        break;
      } catch (error) {
        if (input.abortSignal.aborted) {
          throw input.abortSignal.reason instanceof Error
            ? input.abortSignal.reason
            : error;
        }
        const headersTimedOut = error instanceof Error
          && /Model response headers timed out after \d+ms\./i.test(error.message);
        const emptyVisible = isEmptyAssistantResponseError(error);
        // Empty-visible / planning-only: one short retry max. Do not burn the full
        // 5-step backoff — extra English “say briefly” prompts make flash models worse.
        if (
          attempt === maxAttempts
          || (headersTimedOut && attempt >= 2)
          || (emptyVisible && attempt >= 2)
          || !this.dependencies.isRetryableError(error)
        ) {
          if (tryAdvanceModelFallback(error)) {
            streamedContent = "";
            await (this.dependencies.delay ?? ((milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds))))(500);
            if (input.abortSignal.aborted) throw input.abortSignal.reason ?? error;
            continue modelAttempt;
          }
          throw error;
        }
        const delayMs = emptyVisible ? Math.min(retryDelaysMs[attempt - 1] ?? 500, 500) : (retryDelaysMs[attempt - 1] ?? 0);
        input.publishRetry(input.requestId, attempt, emptyVisible ? 1 : retryDelaysMs.length, delayMs);
        if (delayMs > 0) {
          await (this.dependencies.delay ?? ((milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds))))(delayMs);
          if (input.abortSignal.aborted) throw input.abortSignal.reason ?? error;
        }
      }
    }
    break modelAttempt;
    }
    if (!response) throw new Error("Model step did not return a response.");
    input.recordTokens(this.dependencies.readUsageTokens(response.usage));
    for (const search of response.webSearchCalls) {
      input.recordWebSearch({ ...search, citations: response.citations });
      input.publishWebSearch(search.action, input.requestId);
    }
    return response;
  }
}
