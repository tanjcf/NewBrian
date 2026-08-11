interface ModelChatTaskProjection {
  writtenArtifacts?: unknown[];
  skillDisclosure?: string;
  modelCallback?: unknown;
}

interface ModelChatTimingProjection {
  requestId: string;
  stage: string;
  stageMs: number;
  elapsedMs: number;
}

interface ModelChatAgentEvent {
  type: string;
  payload?: unknown;
}

interface ModelChatCompositionBindingOptions {
  getTask(requestId: string): ModelChatTaskProjection | undefined;
  getAgentEventObserver(requestId: string): ((event: ModelChatAgentEvent) => void) | undefined;
  appendDebugLog(line: string): Promise<unknown>;
}

export function createModelChatCompositionBindings(
  options: ModelChatCompositionBindingOptions
) {
  return {
    attachArtifacts(requestId: string, artifacts: unknown[]) {
      const task = options.getTask(requestId);
      if (task) task.writtenArtifacts = artifacts;
    },
    attachSkillDisclosure(requestId: string, disclosure: string) {
      const task = options.getTask(requestId);
      if (task) task.skillDisclosure = disclosure;
    },
    setModelCallback(requestId: string, callback: unknown) {
      const task = options.getTask(requestId);
      if (task) task.modelCallback = callback;
    },
    observeAgentEvents(requestId: string, events: ModelChatAgentEvent[]) {
      const observer = options.getAgentEventObserver(requestId);
      if (!observer) return;
      for (const event of events) observer(event);
    },
    observeTiming(mark: ModelChatTimingProjection) {
      void options.appendDebugLog(
        `model timing request=${mark.requestId} stage=${mark.stage} stage_ms=${mark.stageMs} elapsed_ms=${mark.elapsedMs}`
      );
    }
  };
}
