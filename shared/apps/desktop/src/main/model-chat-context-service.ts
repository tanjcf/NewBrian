import type {
  ChatMessage,
  ModelChatInput,
  ModelChatMessageInput,
  WorkspaceCatalogItem,
  WorkspaceThreadRecord
} from "@codex-forge/protocol";
import { createHash } from "node:crypto";
import { appendRolloutRecords } from "./rollout-store.js";
import {
  activeThreadMessages,
  CODEX_COMPACTION_PROMPT,
  compactThreadMessages,
  shouldCompactThreadMessages
} from "./thread-context-policy.js";
import {
  DEFAULT_CONTEXT_WINDOW_TOKENS,
  pruneThreadToolEvents
} from "./context-budget-policy.ts";
import { createThreadEvent, toRolloutThreadEvent } from "./thread-event-policy.js";
import { reconcileThreadMessages } from "./thread-message-reconciliation.js";
import { createTimelineEvent, type ThreadStateFile } from "./thread-state-factory.js";
import type { LoadedModelSkill } from "./model-chat-skill-service.js";
import type { SkillDescriptor } from "./skill-selection.js";
import { buildSkillLoadedPayload } from "./skill-event-policy.js";

const MAX_REPLAYABLE_THREAD_EVENTS = 5_000;

interface RecalledMemory {
  id: string;
  scope: string;
  summary: string;
}

export interface ModelChatContextServiceDependencies {
  makeId: (prefix: string) => string;
  nowIso: () => string;
  getEventLogPath: (workspaceId: string, threadId: string) => string;
  writeThreadState: (
    workspace: WorkspaceCatalogItem,
    thread: WorkspaceThreadRecord,
    state: ThreadStateFile
  ) => Promise<unknown>;
  callModel: (input: Record<string, unknown>) => Promise<{ content?: string }>;
}

/** Reconciles one user turn and atomically mirrors its events into rollout storage. */
export class ModelChatContextService {
  private readonly dependencies: ModelChatContextServiceDependencies;

  constructor(dependencies: ModelChatContextServiceDependencies) {
    this.dependencies = dependencies;
  }

  async prepare(input: {
    workspace: WorkspaceCatalogItem;
    thread: WorkspaceThreadRecord;
    state: ThreadStateFile;
    messages: ModelChatMessageInput[];
    persistedAt: string;
    turnId: string;
    loadedSkills: LoadedModelSkill[];
    disclosedSkills: SkillDescriptor[];
    recalledMemories: RecalledMemory[];
    modelInput: ModelChatInput;
    abortSignal: AbortSignal;
    setRuntimeState: (state: ThreadStateFile) => void;
    /** Force summarization even when under the soft threshold (overflow recovery). */
    forceCompact?: boolean;
  }) {
    const context = { makeId: this.dependencies.makeId, nowIso: this.dependencies.nowIso };
    input.state.messages = reconcileThreadMessages(
      input.state.messages ?? [],
      input.messages,
      () => this.dependencies.makeId("msg"),
      input.persistedAt
    ) as ChatMessage[];
    let compactionSummary: string | undefined;
    const modelContextWindow = (() => {
      const parsed = Math.floor(Number(input.state.context?.modelContextWindow)
        || Number((input.modelInput as { maxContext?: number }).maxContext)
        || 0);
      return Number.isFinite(parsed) && parsed >= 8_000 ? parsed : DEFAULT_CONTEXT_WINDOW_TOKENS;
    })();
    const prunedEvents = pruneThreadToolEvents(input.state.events ?? []);
    if (prunedEvents.pruned > 0) {
      input.state.events = prunedEvents.events;
    }
    const needsCompact = input.forceCompact
      || shouldCompactThreadMessages(
        input.state.messages,
        input.state.context,
        modelContextWindow,
        input.state.events
      );
    if (needsCompact) {
      const compactionInput = activeThreadMessages(input.state.messages, input.state.context)
        .filter((message) => message.role !== "tool" && !message.excludeFromModelContext)
        .map((message) => ({ role: message.role, content: message.content }));
      const response = await this.dependencies.callModel({
        ...input.modelInput,
        signal: input.abortSignal,
        systemPrompt: "Create only the requested context checkpoint. Do not continue the task or call tools.",
        messages: [...compactionInput, { role: "user", content: CODEX_COMPACTION_PROMPT }],
        tools: [],
        onTextDelta: () => undefined,
        onReasoningDelta: () => undefined
      });
      compactionSummary = response.content?.trim();
      if (!compactionSummary) throw new Error("Context compaction model returned an empty summary.");
    }
    const compacted = compactThreadMessages(
      input.state.messages,
      input.state.context,
      modelContextWindow,
      {
        ...context,
        summary: compactionSummary,
        force: Boolean(input.forceCompact)
      },
      input.state.events
    );
    input.state.context = compacted.context;
    const requestMessages = compacted.messages
      .filter((message): message is ChatMessage & { role: "user" | "assistant" | "system" } =>
        message.role !== "tool" && !message.excludeFromModelContext
      )
      .map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        createdAt: message.createdAt,
        reasoningSummary: message.reasoningSummary,
        // Thinking-mode gateways (for example DeepSeek/Kimi) require the
        // opaque provider reasoning token to be echoed on the next request.
        // Keep it in the reconstructed thread context; the visible summary is
        // intentionally not a substitute for this provider field.
        providerReasoningContent: message.providerReasoningContent,
        attachments: message.attachments
      }));
    const latestMessage = input.messages.at(-1);
    const pendingEvents = [createThreadEvent("message", {
      role: "user",
      messageId: latestMessage?.id ?? "",
      content: latestMessage?.content ?? ""
    }, input.turnId, context)];
    if (compacted.compacted) {
      pendingEvents.push(createThreadEvent("context_compacted", {
        trigger: "auto",
        reason: "context_limit",
        implementation: "responses",
        phase: "pre_turn",
        strategy: "memento",
        status: "completed",
        estimatedTokens: compacted.context.estimatedTokens,
        modelContextWindow: compacted.context.modelContextWindow,
        compactedMessageIds: compacted.context.compactedMessageIds,
        summaryMessageId: compacted.context.summaryMessageId,
        retainedMessageIds: compacted.context.retainedMessageIds,
        windowNumber: compacted.context.windowNumber,
        firstWindowId: compacted.context.firstWindowId,
        previousWindowId: compacted.context.previousWindowId,
        windowId: compacted.context.windowId,
        replacementHistory: compacted.messages.map((message) => ({
          id: message.id,
          role: message.role,
          content: message.content,
          createdAt: message.createdAt
        }))
      }, input.turnId, context));
    }
    for (const skill of input.disclosedSkills) {
      pendingEvents.push(createThreadEvent("skill_loaded", buildSkillLoadedPayload(skill), input.turnId, context));
    }
    if (input.recalledMemories.length) {
      pendingEvents.push(createThreadEvent("memory_recalled", {
        memoryIds: input.recalledMemories.map((memory) => memory.id),
        count: input.recalledMemories.length
      }, input.turnId, context));
    }
    input.state.events = [...(input.state.events ?? []), ...pendingEvents].slice(-MAX_REPLAYABLE_THREAD_EVENTS);
    input.state.timeline = [
      createTimelineEvent("message", "用户问题", latestMessage?.content.slice(0, 120) ?? "", context),
      ...(compacted.compacted
        ? [createTimelineEvent(
            "thread",
            "上下文已压缩",
            `估算 ${compacted.context.estimatedTokens} / ${compacted.context.modelContextWindow} tokens`,
            context
          )]
        : []),
      ...(input.state.timeline ?? [])
    ].slice(0, 80);
    await this.dependencies.writeThreadState(input.workspace, input.thread, input.state);
    await appendRolloutRecords(
      this.dependencies.getEventLogPath(input.workspace.id, input.thread.id),
      pendingEvents.map((event) => toRolloutThreadEvent(input.thread.id, event))
    );
    input.setRuntimeState(input.state);
    return { state: input.state, requestMessages, compacted: compacted.compacted };
  }

  async updateModelContext(input: {
    workspace: WorkspaceCatalogItem;
    thread: WorkspaceThreadRecord;
    state: ThreadStateFile;
    turnId: string;
    systemPrompt: string;
    provider: string;
    model: string;
    setRuntimeState: (state: ThreadStateFile) => void;
  }) {
    const context = input.state.context;
    if (!context) return input.state;
    const systemPromptHash = createHash("sha256").update(input.systemPrompt).digest("hex");
    if (
      context.systemPromptHash === systemPromptHash
      && context.provider === input.provider
      && context.model === input.model
    ) return input.state;

    input.state.context = { ...context, systemPromptHash, provider: input.provider, model: input.model };
    const event = createThreadEvent("context_changed", {
      systemPromptHash,
      provider: input.provider,
      model: input.model
    }, input.turnId, { makeId: this.dependencies.makeId, nowIso: this.dependencies.nowIso });
    input.state.events = [...(input.state.events ?? []), event].slice(-MAX_REPLAYABLE_THREAD_EVENTS);
    await this.dependencies.writeThreadState(input.workspace, input.thread, input.state);
    await appendRolloutRecords(
      this.dependencies.getEventLogPath(input.workspace.id, input.thread.id),
      [toRolloutThreadEvent(input.thread.id, event)]
    );
    input.setRuntimeState(input.state);
    return input.state;
  }
}
