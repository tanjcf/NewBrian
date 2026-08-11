interface QuitEvent {
  preventDefault(): void;
}

interface AgentHostQuitCoordinatorOptions {
  shutdown: () => Promise<void>;
  quit: () => void;
  onError?: (error: unknown) => void;
}

export function createAgentHostQuitCoordinator(options: AgentHostQuitCoordinatorOptions) {
  let complete = false;
  let inFlight: Promise<void> | null = null;

  return {
    beforeQuit(event: QuitEvent) {
      if (complete) return;
      event.preventDefault();
      if (inFlight) return;
      inFlight = options.shutdown()
        .catch((error) => { options.onError?.(error); })
        .then(() => {
          complete = true;
          options.quit();
        });
    },
    wait() {
      return inFlight ?? Promise.resolve();
    }
  };
}
