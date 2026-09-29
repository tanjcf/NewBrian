import type { ModelChatInput } from "@codex-forge/protocol";

export interface DelegatedModelStepResult {
  content: string;
  toolCalls?: unknown[];
  selectedModel?: string;
  routingReason?: string;
}

/**
 * Child-agent model calls enter the same step service as the parent turn.
 * The child still dials /v1/responses with the desktop login; this wrapper
 * only applies the shared retry and usage policy.
 */
export function executeDelegatedModelStep<TResponse extends DelegatedModelStepResult>(
  stepService: {
    execute(input: {
      modelInput: ModelChatInput;
      messages: unknown[];
      tools: unknown[];
      systemPrompt: string;
      abortSignal: AbortSignal;
      suppressVisibleContent: boolean;
      requestId: string;
      emitReasoningSummary: (delta: string) => void;
      emitStream: (payload: { requestId: string; delta: string; reset?: boolean }) => void;
      publishRetry: (requestId: string, attempt: number, maxAttempts: number, delayMs: number) => void;
      publishWebSearch: (action: unknown, requestId: string) => void;
      recordWebSearch: (search: {
        id: string;
        status: string;
        action?: unknown;
        citations: Array<{ url: string; title: string }>;
      }) => void;
      recordTokens: (tokens: number) => void;
    }): Promise<TResponse>;
  },
  input: {
    modelInput: ModelChatInput;
    messages: unknown[];
    tools: unknown[];
    systemPrompt: string;
    abortSignal: AbortSignal;
    requestId: string;
    onReasoningDelta: (delta: string) => void;
    onRetry: (requestId: string, attempt: number, maxAttempts: number, delayMs: number) => void;
  }
): Promise<TResponse> {
  return stepService.execute({
    modelInput: input.modelInput,
    messages: input.messages,
    tools: input.tools,
    systemPrompt: input.systemPrompt,
    abortSignal: input.abortSignal,
    suppressVisibleContent: true,
    requestId: input.requestId,
    emitReasoningSummary: input.onReasoningDelta,
    emitStream: () => undefined,
    publishRetry: input.onRetry,
    publishWebSearch: () => undefined,
    recordWebSearch: () => undefined,
    recordTokens: () => undefined
  });
}
