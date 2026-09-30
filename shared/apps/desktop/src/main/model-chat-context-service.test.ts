import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ThreadStateFile } from "./thread-state-factory.js";
// @ts-expect-error Node's native TypeScript test runner requires the source extension.
import { ModelChatContextService } from "./model-chat-context-service.ts";
// @ts-expect-error Node's native TypeScript test runner requires the source extension.
import { buildUpstreamModelMessages } from "./model-gateway-protocol.ts";

test("runs Codex-style model compaction and persists replacement history before the main turn", async () => {
  const root = await mkdtemp(join(tmpdir(), "newbrain-context-compaction-"));
  const rolloutPath = join(root, "rollout.jsonl");
  const calls: Array<Record<string, unknown>> = [];
  let written: ThreadStateFile | null = null;
  const service = new ModelChatContextService({
    makeId: (prefix: string) => `${prefix}-fixed`,
    nowIso: () => "2026-07-19T00:00:00.000Z",
    getEventLogPath: () => rolloutPath,
    writeThreadState: async (_workspace: unknown, _thread: unknown, state: ThreadStateFile) => { written = structuredClone(state); },
    callModel: async (input: Record<string, unknown>) => {
      calls.push(input);
      return { content: "Current progress is persisted. Continue the latest user request." };
    }
  });
  const state: ThreadStateFile = {
    version: 2,
    messages: [],
    memories: [],
    runs: [],
    timeline: [],
    events: [],
    context: { version: 1, summary: "", compactedMessageIds: [], estimatedTokens: 0, modelContextWindow: 100 }
  };
  const messages = Array.from({ length: 14 }, (_, index) => ({
    id: `message-${index}`,
    role: index % 2 ? "assistant" as const : "user" as const,
    content: `message ${index} `.repeat(40),
    createdAt: "2026-07-19T00:00:00.000Z"
  }));
  try {
    const result = await service.prepare({
      workspace: { id: "workspace", name: "Workspace", path: root, threads: [] },
      thread: { id: "thread", title: "Thread", summary: "", updatedAt: "2026-07-19T00:00:00.000Z" },
      state,
      messages,
      persistedAt: "2026-07-19T00:00:00.000Z",
      turnId: "turn-1",
      loadedSkills: [],
      disclosedSkills: [],
      recalledMemories: [],
      modelInput: {
        requestId: "request-1", provider: "provider", baseUrl: "https://example.invalid", apiKey: "key",
        wireApi: "responses", model: "model", reviewModel: "model", reasoningEffort: "low",
        disableResponseStorage: true, systemPrompt: "system", messages
      },
      abortSignal: new AbortController().signal,
      setRuntimeState: () => undefined
    });

    assert.equal(calls.length, 1);
    assert.equal((calls[0]?.tools as unknown[])?.length, 0);
    assert.match(String((calls[0]?.messages as Array<{ content: string }>).at(-1)?.content), /CONTEXT CHECKPOINT COMPACTION/);
    assert.equal(result.compacted, true);
    assert.equal(result.requestMessages.at(-1)?.role, "user");
    assert.match(result.requestMessages.at(-1)?.content ?? "", /^Another language model started/);
    assert.equal((written as ThreadStateFile | null)?.context?.windowNumber, 1);
    const rollout = await readFile(rolloutPath, "utf8");
    assert.match(rollout, /context_compacted/);
    assert.match(rollout, /replacementHistory/);
    assert.match(rollout, /context-window-fixed/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("persists an automatically routed central skill for activity replay", async () => {
  const root = await mkdtemp(join(tmpdir(), "newbrain-central-skill-event-"));
  const rolloutPath = join(root, "rollout.jsonl");
  let written: ThreadStateFile | null = null;
  const service = new ModelChatContextService({
    makeId: (prefix: string) => `${prefix}-fixed`,
    nowIso: () => "2026-07-19T00:00:00.000Z",
    getEventLogPath: () => rolloutPath,
    writeThreadState: async (_workspace: unknown, _thread: unknown, state: ThreadStateFile) => { written = structuredClone(state); },
    callModel: async () => ({ content: "unused" })
  });
  const state: ThreadStateFile = { version: 2, messages: [], memories: [], runs: [], timeline: [], events: [] };
  try {
    await service.prepare({
      workspace: { id: "workspace", name: "Workspace", path: root, threads: [] },
      thread: { id: "thread", title: "Thread", summary: "", updatedAt: "2026-07-19T00:00:00.000Z" },
      state,
      messages: [{ id: "message-1", role: "user", content: "撰写年度讲话稿", createdAt: "2026-07-19T00:00:00.000Z" }],
      persistedAt: "2026-07-19T00:00:00.000Z", turnId: "turn-1", loadedSkills: [],
      disclosedSkills: [{ name: "government-research-writing", description: "Government writing" }],
      recalledMemories: [],
      modelInput: {
        requestId: "request-1", provider: "provider", baseUrl: "https://example.invalid", apiKey: "key",
        wireApi: "responses", model: "model", reviewModel: "model", reasoningEffort: "low",
        disableResponseStorage: true, systemPrompt: "system",
        messages: [{ id: "message-1", role: "user", content: "撰写年度讲话稿", createdAt: "2026-07-19T00:00:00.000Z" }]
      },
      abortSignal: new AbortController().signal,
      setRuntimeState: () => undefined
    });

    const skillEvent = (written as ThreadStateFile | null)?.events?.find((event) => event.type === "skill_loaded");
    assert.equal(skillEvent?.payload.name, "government-research-writing");
    assert.equal("instructionPath" in (skillEvent?.payload ?? {}), false);
    assert.match(await readFile(rolloutPath, "utf8"), /government-research-writing/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("does not serialize persisted assistant reasoning summaries as provider thinking context", async () => {
  const root = await mkdtemp(join(tmpdir(), "newbrain-context-reasoning-"));
  const rolloutPath = join(root, "rollout.jsonl");
  const service = new ModelChatContextService({
    makeId: (prefix: string) => `${prefix}-fixed`,
    nowIso: () => "2026-08-19T00:00:00.000Z",
    getEventLogPath: () => rolloutPath,
    writeThreadState: async () => undefined,
    callModel: async () => ({ content: "unused" })
  });
  const state: ThreadStateFile = {
    version: 2,
    messages: [{
      id: "assistant-previous",
      role: "assistant",
      content: "已完成上一轮检查。",
      reasoningSummary: "先检查项目，再给出结论。",
      createdAt: "2026-08-19T00:00:00.000Z"
    }],
    memories: [],
    runs: [],
    timeline: [],
    events: []
  };
  const messages = [{
    id: "user-next",
    role: "user" as const,
    content: "继续",
    createdAt: "2026-08-19T00:01:00.000Z"
  }];
  try {
    const result = await service.prepare({
      workspace: { id: "workspace", name: "Workspace", path: root, threads: [] },
      thread: { id: "thread", title: "Thread", summary: "", updatedAt: "2026-08-19T00:01:00.000Z" },
      state,
      messages,
      persistedAt: "2026-08-19T00:01:00.000Z",
      turnId: "turn-2",
      loadedSkills: [],
      disclosedSkills: [],
      recalledMemories: [],
      modelInput: {
        requestId: "request-2", provider: "provider", baseUrl: "https://example.invalid", apiKey: "key",
        wireApi: "chat.completions", model: "thinking-model", reviewModel: "thinking-model", reasoningEffort: "low",
        disableResponseStorage: true, systemPrompt: "system", messages
      },
      abortSignal: new AbortController().signal,
      setRuntimeState: () => undefined
    });

    const priorAssistant = result.requestMessages.find((message) => message.id === "assistant-previous");
    assert.equal(priorAssistant?.reasoningSummary, "先检查项目，再给出结论。");
    const upstream = buildUpstreamModelMessages("chat.completions", "", result.requestMessages);
    assert.equal("reasoning_content" in (upstream[0] ?? {}), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
