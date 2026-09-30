export type ModelChatTimingStage =
  | "prepared"
  | "task-started"
  | "context-ready"
  | "loop-started"
  | "first-delta"
  | "loop-completed"
  | "run-persisted"
  | "success-persisted"
  | "finished";

export interface ModelChatTimingMark {
  requestId: string;
  stage: ModelChatTimingStage;
  elapsedMs: number;
  stageMs: number;
}
interface ModelChatTimingOptions {
  requestId: string;
  now?: () => number;
}

export class ModelChatTiming {
  private readonly requestId: string;
  private readonly now: () => number;
  private readonly startedAt: number;
  private lastAt: number;
  private readonly stages = new Set<ModelChatTimingStage>();

  constructor(options: ModelChatTimingOptions) {
    this.requestId = options.requestId;
    this.now = options.now ?? (() => performance.now());
    this.startedAt = this.now();
    this.lastAt = this.startedAt;
  }

  mark(stage: ModelChatTimingStage): ModelChatTimingMark {
    if (this.stages.has(stage)) {
      throw new Error(`Model chat timing stage was already recorded: ${stage}`);
    }
    const current = this.now();
    if (current < this.lastAt) {
      throw new Error(`Model chat timing clock must be monotonic: ${stage}`);
    }
    const mark = {
      requestId: this.requestId,
      stage,
      elapsedMs: Math.round(current - this.startedAt),
      stageMs: Math.round(current - this.lastAt)
    };
    this.stages.add(stage);
    this.lastAt = current;
    return mark;
  }
}
