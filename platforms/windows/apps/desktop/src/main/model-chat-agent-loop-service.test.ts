import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { ModelChatInput } from "@codex-forge/protocol";
import { PDFParse } from "pdf-parse";

const { ModelChatAgentLoopService, agentLoopStepLimit, prepareGovernmentPdfContent, shouldHandoffGovernmentOutline, shouldHandoffGovernmentSpecification, shouldRunGovernmentDraftDirectly, isGovernmentSpecificationConfirmRequest, isGovernmentSpecificationProceedRequest, isGovernmentMissingBodyRequest, hasIncompleteGovernmentOutlineConfirmation, canGenerateDirectGovernmentResearchSpecification, canFinalizeGovernmentResearchSpecification, buildEvidenceBackedGovernmentSpecification, isInvalidCapabilityRefusal, isOrdinaryChatRequest, buildInvalidRefusalRecoveryInstruction, isPoisonedCapabilityHistoryContent, sanitizeInvalidCapabilityHistory, INVALID_CAPABILITY_UPGRADE_BLOCKED_REPLY} = await import(
  new URL("./model-chat-agent-loop-service.ts", import.meta.url).href
);

const { requestedArtifactTargetPath } = await import(new URL("./artifact-request-policy.js", import.meta.url).href);
const { buildGovernmentRevisionPreview } = await import(new URL("./government-revision-preview.js", import.meta.url).href);

test("detects and blocks provider template refusals without escalating ordinary chat", () => {
  assert.equal(isInvalidCapabilityRefusal("作为一个人工智能语言模型，我还没学习如何回答这个问题，您可以向我问一些其它的问题。"), true);
  assert.equal(isInvalidCapabilityRefusal("这里是根据现有资料整理出的完整答案。"), false);
  assert.equal(isOrdinaryChatRequest("你好"), true);
  assert.equal(isOrdinaryChatRequest("请检索资料并交给专业子 Agent 分析"), false);
  const chatRecovery = buildInvalidRefusalRecoveryInstruction({
    latestUserRequest: "你好",
    availableToolNames: ["agent.delegate", "web.search"]
  });
  assert.match(chatRecovery, /不得检索、调用工具、委派子 Agent/);
  const complexRecovery = buildInvalidRefusalRecoveryInstruction({
    latestUserRequest: "请检索资料并交给专业子 Agent 分析",
    availableToolNames: ["agent.delegate", "agent.wait", "web.search"]
  });
  assert.match(complexRecovery, /必须先调用 agent\.delegate/);
  assert.match(complexRecovery, /spring-app Auto 路由选择更强模型/);
  assert.match(complexRecovery, /最后由主 Agent 审核并统一回答/);
});

test("scrubs prior template refusals so old threads do not keep failing the same prompt", () => {
  const poisoned = "作为一个人工智能语言模型，我还没学习如何回答这个问题，您可以向我问一些其它的问题。";
  assert.equal(isPoisonedCapabilityHistoryContent(poisoned), true);
  assert.equal(isPoisonedCapabilityHistoryContent(INVALID_CAPABILITY_UPGRADE_BLOCKED_REPLY), true);
  assert.equal(isPoisonedCapabilityHistoryContent("正常结论"), false);
  const sanitized = sanitizeInvalidCapabilityHistory([
    { role: "user", content: "同一句话" },
    { role: "assistant", content: poisoned },
    { role: "assistant", content: INVALID_CAPABILITY_UPGRADE_BLOCKED_REPLY },
    { role: "user", content: "同一句话" }
  ]);
  assert.equal(sanitized[0]?.content, "同一句话");
  assert.match(sanitized[1]?.content ?? "", /无效模板拒答已被系统拦截/);
  assert.match(sanitized[2]?.content ?? "", /无效模板拒答已被系统拦截/);
  assert.equal(sanitized[3]?.content, "同一句话");
  assert.equal(isInvalidCapabilityRefusal(sanitized[1]?.content), false);
});

test("allows artifact creation and verification the same bounded step budget as government delivery", () => {
  assert.equal(agentLoopStepLimit({ governmentWorkflowEnabled: false, nativeArtifactRequested: false }), Number.POSITIVE_INFINITY);
  assert.equal(agentLoopStepLimit({ governmentWorkflowEnabled: false, nativeArtifactRequested: true }), Number.POSITIVE_INFINITY);
  assert.equal(agentLoopStepLimit({ governmentWorkflowEnabled: true, nativeArtifactRequested: true }), Number.POSITIVE_INFINITY);
  assert.equal(agentLoopStepLimit({ governmentWorkflowEnabled: true, nativeArtifactRequested: false }), Number.POSITIVE_INFINITY);
});

test("builds a scenario-agnostic specification only from this turn's official reads and discovered cases", () => {
  const specification = buildEvidenceBackedGovernmentSpecification({
    request: "撰写某主题典型案例研究文章",
    snapshot: {
      plan: [{ stepId: "official-evidence-research", result: "已读取官方原文，案例素材涵盖甲地产业、乙地园区。" }]
    },
    messages: [{
      role: "assistant",
      content: "",
      toolCalls: [{ id: "read-1", name: "web.read_official", arguments: { url: "https://example.gov.cn/a.html" } }]
    }]
  } as never);
  assert.ok(specification);
  assert.deepEqual(specification.cases.map((item: { name: string }) => item.name), ["甲地产业", "乙地园区"]);
  assert.equal(specification.cases[0].evidence[0].url, "https://example.gov.cn/a.html");
  assert.equal(specification.requirements.some((item: { status: string }) => item.status === "pending"), false);
  assert.equal(specification.structure[0].title, "\u6458\u8981");
  assert.equal(buildEvidenceBackedGovernmentSpecification({
    request: "另一主题",
    snapshot: { plan: [{ stepId: "official-evidence-research", result: "没有案例候选" }] },
    messages: []
  } as never), null);
});

test("finalizes an evidence-backed specification when official reads succeeded but the model omitted plan updates", () => {
  const messages = [{
    role: "assistant",
    content: "案例选择：甲地产业、乙地园区。",
    toolCalls: [{ id: "read-1", name: "web.read_official", arguments: { url: "https://example.gov.cn/a.html" } }]
  }];
  const snapshot = {
    goal: { status: "active" },
    plan: [{ stepId: "official-evidence-research", status: "pending", result: "" }]
  };

  assert.equal(canFinalizeGovernmentResearchSpecification({
    snapshot,
    hasCurrentSpecification: false,
    request: "撰写典型案例研究文章",
    messages
  } as never), true);
  const specification = buildEvidenceBackedGovernmentSpecification({
    request: "撰写典型案例研究文章",
    snapshot,
    messages
  } as never);
  assert.deepEqual(specification?.cases.map((item: { name: string }) => item.name), ["甲地产业", "乙地园区"]);
});

test("hands government writing off once the writing-specification stage is ready for confirmation", () => {
  const snapshot: any = {
    goal: { status: "active" }, pendingQuestion: null,
    plan: [
      { stepId: "material-assessment", title: "材料评估", status: "completed" },
      { stepId: "requirement-clarification", title: "需求澄清", status: "completed" },
      { stepId: "official-evidence-research", title: "官方证据", status: "completed" },
      { stepId: "writing-specification", title: "生成写作规格", status: "completed" },
      { stepId: "specification-confirmation", title: "确认写作规格", status: "pending" }
    ]
  };
  assert.equal(shouldHandoffGovernmentSpecification(snapshot), true);
  assert.equal(shouldHandoffGovernmentOutline(snapshot), false);
  snapshot.plan[3].status = "in_progress";
  snapshot.plan[4].status = "pending";
  assert.equal(shouldHandoffGovernmentSpecification(snapshot), false);
  snapshot.plan[4].status = "in_progress";
  assert.equal(shouldHandoffGovernmentSpecification(snapshot), true);
  snapshot.plan[3].status = "completed";
  snapshot.plan[4].status = "completed";
  snapshot.plan.push({ stepId: "draft", title: "起草正文", status: "in_progress" });
  assert.equal(shouldHandoffGovernmentSpecification(snapshot), false);
});

test("recognizes short chat confirmations for the writing specification gate", () => {
  assert.equal(isGovernmentSpecificationConfirmRequest("确认"), true);
  assert.equal(isGovernmentSpecificationConfirmRequest("「确认」"), true);
  assert.equal(isGovernmentSpecificationConfirmRequest("确认、"), true);
  assert.equal(isGovernmentSpecificationConfirmRequest("确认并开始写作"), true);
  assert.equal(isGovernmentSpecificationConfirmRequest("可以开始写作"), true);
  assert.equal(isGovernmentSpecificationConfirmRequest("请把案例改成聚焦制造业，并补充篇幅说明"), false);
  assert.equal(isGovernmentSpecificationProceedRequest("输出到pdf文件中"), true);
  assert.equal(isGovernmentSpecificationProceedRequest("开始写作"), true);
  assert.equal(isGovernmentSpecificationProceedRequest("总结下问题在哪"), false);
  assert.equal(
    isGovernmentSpecificationConfirmRequest("原始交付要求：请撰写案例研究文章。\n当前用户选择或补充：确认"),
    true
  );
  assert.equal(
    isGovernmentSpecificationConfirmRequest("原始交付要求：请撰写案例研究文章。\n当前用户选择或补充：把篇幅改成5000字"),
    false
  );
  assert.equal(isGovernmentMissingBodyRequest("文字在哪"), true);
  assert.equal(isGovernmentMissingBodyRequest("继续输出正文"), true);
  assert.equal(isGovernmentSpecificationProceedRequest("文字在哪"), true);
});

test("does not steal outline confirmation or post-outline drafting into the writing-specification confirm path", () => {
  const outlinePending: any = {
    goal: { status: "active" }, pendingQuestion: null,
    plan: [
      { stepId: "writing-specification", title: "生成写作规格", status: "completed", result: "ready" },
      { stepId: "specification-confirmation", title: "确认写作规格", status: "in_progress", result: "" },
      { stepId: "outline", title: "生成提纲", status: "completed", result: "outline" },
      { stepId: "outline-confirmation", title: "提纲确认", status: "in_progress", result: "" },
      { stepId: "draft", title: "起草正文", status: "pending", result: "" }
    ]
  };
  assert.equal(hasIncompleteGovernmentOutlineConfirmation(outlinePending), true);
  assert.equal(shouldHandoffGovernmentSpecification(outlinePending), true);
  assert.equal(shouldRunGovernmentDraftDirectly(outlinePending), false);

  const outlineConfirmed: any = {
    goal: { status: "active" }, pendingQuestion: null,
    plan: [
      { stepId: "writing-specification", title: "生成写作规格", status: "completed", result: "ready" },
      { stepId: "specification-confirmation", title: "确认写作规格", status: "in_progress", result: "" },
      { stepId: "outline-confirmation", title: "提纲确认", status: "completed", result: "User selected: 确认" },
      { stepId: "draft", title: "起草正文", status: "in_progress", result: "" }
    ]
  };
  assert.equal(hasIncompleteGovernmentOutlineConfirmation(outlineConfirmed), false);
  assert.equal(shouldRunGovernmentDraftDirectly(outlineConfirmed), true);
});

test("missing writing-specification JSON falls through so the model can regenerate instead of dead-ending", async () => {
  let starts = 0;
  let executed = 0;
  const waitingSnapshot: any = {
    goal: { status: "active" }, runtime: { phase: "waiting_user" }, pendingQuestion: null,
    plan: [
      { stepId: "writing-specification", title: "生成写作规格", status: "completed", result: "ready" },
      { stepId: "specification-confirmation", title: "确认写作规格", status: "in_progress", result: "" },
      { stepId: "draft", title: "起草正文", status: "pending", result: "" }
    ]
  };
  const runtime = {
    sessionMachine: { events: [] },
    startAgentLoop: () => { starts += 1; },
    advanceAgentLoop: async () => ({
      status: "completed",
      messages: [{ role: "assistant", content: "# 写作任务\n\n完整规格\n\n```json\n{\"task\":\"t\",\"requirements\":[],\"cases\":[],\"structure\":[]}\n```", toolCalls: [] }],
      pending: null,
      finalContent: "# 写作任务\n\n完整规格"
    }),
    getSnapshot: () => ({ runs: [] })
  };
  const service = new ModelChatAgentLoopService({
    executeStep: async () => {
      executed += 1;
      return { content: "# 写作任务\n\n完整规格", toolCalls: [] };
    },
    projectEvent: () => undefined,
    runOutline: async (input: { generatedContent: string }) => input,
    runFinalization: async (input: { generatedContent: string }) => input,
    buildResult: (input: { generatedContent: string }) => ({ skillDisclosure: "", canonicalContent: input.generatedContent, result: input })
  } as never);

  const output = await service.run({
    modelInput: { requestId: "chat-confirm-missing-spec" } as ModelChatInput, runtime,
    abortController: new AbortController(), requestMessages: [{ role: "user", content: "确认" }],
    effectiveSystemPrompt: "system", centralSkillNames: ["government-research-writing"], disclosedSkills: [],
    nativeWebSearches: [], writtenArtifacts: [], workspacePath: "C:/workspace", threadId: "thread",
    latestUserRequest: "确认", goalSnapshot: waitingSnapshot, reasoningSummaryParts: [],
    emitReasoningSummary: () => undefined, emitStream: () => undefined, publishRetry: () => undefined,
    publishWebSearch: () => undefined, publishActivity: () => undefined, recordTokens: () => undefined,
    setModelCallback: () => undefined, getGoalSnapshot: () => waitingSnapshot,
    governmentSpecificationSnapshot: null,
    confirmGovernmentSpecificationFromChat: async () => {
      throw new Error("当前没有可确认的写作规格。请先等待助手输出完整写作规格（含可解析的 JSON），或在规格面板保存后再回复「确认」。");
    }
  } as never);

  assert.equal(starts, 1);
  assert.match(String(output.canonicalContent), /完整规格/);
  assert.doesNotMatch(String(output.canonicalContent), /规格确认未完成/);
});

test("chat confirmation of the writing specification advances into direct drafting", async () => {
  let confirmCalls = 0;
  let starts = 0;
  const waitingSnapshot: any = {
    goal: { status: "active" }, runtime: { phase: "waiting_user" }, pendingQuestion: null,
    plan: [
      { stepId: "writing-specification", title: "生成写作规格", status: "completed", result: "ready" },
      { stepId: "specification-confirmation", title: "确认写作规格", status: "in_progress", result: "" },
      { stepId: "draft", title: "起草正文", status: "pending", result: "" }
    ]
  };
  const confirmedSnapshot: any = {
    goal: { status: "active" }, runtime: { phase: "running" }, pendingQuestion: null,
    plan: [
      { stepId: "writing-specification", title: "生成写作规格", status: "completed", result: "ready" },
      { stepId: "specification-confirmation", title: "确认写作规格", status: "completed", result: "用户已确认" },
      { stepId: "draft", title: "起草正文", status: "in_progress", result: "" }
    ]
  };
  let current = waitingSnapshot;
  const runtime = {
    sessionMachine: { events: [] },
    startAgentLoop: () => { starts += 1; },
    advanceAgentLoop: async () => { throw new Error("generic loop must not start after chat confirm"); },
    getSnapshot: () => ({ runs: [] })
  };
  const service = new ModelChatAgentLoopService({
    executeStep: async () => ({ content: "正文起草已开始。", toolCalls: [] }),
    projectEvent: () => undefined,
    runOutline: async (input: { generatedContent: string }) => input,
    runFinalization: async (input: { generatedContent: string }) => input,
    buildResult: (input: { generatedContent: string }) => ({ skillDisclosure: "", canonicalContent: input.generatedContent, result: input })
  } as never);

  const wrappedConfirm = "原始交付要求：请撰写一篇关于因地制宜发展新质生产力的典型案例研究文章。\n当前用户选择或补充：确认";
  const output = await service.run({
    modelInput: { requestId: "chat-confirm-spec" } as ModelChatInput, runtime,
    abortController: new AbortController(), requestMessages: [{ role: "user", content: "确认" }],
    effectiveSystemPrompt: "system", centralSkillNames: ["government-research-writing"], disclosedSkills: [],
    nativeWebSearches: [], writtenArtifacts: [], workspacePath: "C:/workspace", threadId: "thread",
    latestUserRequest: wrappedConfirm, goalSnapshot: waitingSnapshot, reasoningSummaryParts: [],
    emitReasoningSummary: () => undefined, emitStream: () => undefined, publishRetry: () => undefined,
    publishWebSearch: () => undefined, publishActivity: () => undefined, recordTokens: () => undefined,
    setModelCallback: () => undefined, getGoalSnapshot: () => current,
    governmentSpecificationSnapshot: { currentVersionId: "v1", confirmedVersionId: undefined },
    confirmGovernmentSpecificationFromChat: async () => {
      confirmCalls += 1;
      current = confirmedSnapshot;
      return {
        currentVersionId: "v1",
        confirmedVersionId: "v1",
        currentVersion: { content: { requirements: [{ label: "篇幅", value: "3500字" }] } }
      };
    }
  } as never);

  assert.equal(confirmCalls, 1);
  assert.equal(starts, 0);
  assert.equal(output.canonicalContent, "正文起草已开始。");
});

test("PDF proceed requests at the confirmation gate confirm and draft instead of looping the wait prompt", async () => {
  let confirmCalls = 0;
  const waitingSnapshot: any = {
    goal: { status: "active" }, runtime: { phase: "waiting_user" }, pendingQuestion: null,
    plan: [
      { stepId: "writing-specification", title: "生成写作规格", status: "completed", result: "ready" },
      { stepId: "specification-confirmation", title: "确认写作规格", status: "in_progress", result: "" },
      { stepId: "draft", title: "起草正文", status: "pending", result: "" }
    ]
  };
  const confirmedSnapshot: any = {
    goal: { status: "active" }, runtime: { phase: "running" }, pendingQuestion: null,
    plan: [
      { stepId: "writing-specification", title: "生成写作规格", status: "completed", result: "ready" },
      { stepId: "specification-confirmation", title: "确认写作规格", status: "completed", result: "用户已确认" },
      { stepId: "draft", title: "起草正文", status: "in_progress", result: "" }
    ]
  };
  let current = waitingSnapshot;
  const runtime = {
    sessionMachine: { events: [] },
    startAgentLoop: () => { throw new Error("generic loop must not start after PDF proceed confirm"); },
    advanceAgentLoop: async () => { throw new Error("generic loop must not start after PDF proceed confirm"); },
    getSnapshot: () => ({ runs: [] })
  };
  const service = new ModelChatAgentLoopService({
    executeStep: async () => ({ content: "按确认规格起草并准备 PDF。", toolCalls: [] }),
    projectEvent: () => undefined,
    runOutline: async (input: { generatedContent: string }) => input,
    runFinalization: async (input: { generatedContent: string }) => input,
    buildResult: (input: { generatedContent: string }) => ({ skillDisclosure: "", canonicalContent: input.generatedContent, result: input })
  } as never);

  const output = await service.run({
    modelInput: { requestId: "pdf-proceed-confirm" } as ModelChatInput, runtime,
    abortController: new AbortController(), requestMessages: [{ role: "user", content: "输出到pdf文件中" }],
    effectiveSystemPrompt: "system", centralSkillNames: ["government-research-writing"], disclosedSkills: [],
    nativeWebSearches: [], writtenArtifacts: [], workspacePath: "C:/workspace", threadId: "thread",
    latestUserRequest: "输出到pdf文件中", goalSnapshot: waitingSnapshot, reasoningSummaryParts: [],
    emitReasoningSummary: () => undefined, emitStream: () => undefined, publishRetry: () => undefined,
    publishWebSearch: () => undefined, publishActivity: () => undefined, recordTokens: () => undefined,
    setModelCallback: () => undefined, getGoalSnapshot: () => current,
    governmentSpecificationSnapshot: { currentVersionId: "v1", confirmedVersionId: undefined, currentVersion: { content: { task: "t" } } },
    confirmGovernmentSpecificationFromChat: async () => {
      confirmCalls += 1;
      current = confirmedSnapshot;
      return {
        currentVersionId: "v1",
        confirmedVersionId: "v1",
        currentVersion: { content: { task: "贵阳大数据", requirements: [{ label: "篇幅", value: "约4000字" }] } }
      };
    }
  } as never);

  assert.equal(confirmCalls, 1);
  assert.doesNotMatch(String(output.canonicalContent), /写作规格分析已完成|请在规格面板/);
  assert.match(String(output.canonicalContent), /起草|PDF/);
});

test("non-confirm questions at the confirmation gate are answered instead of looping the wait prompt", async () => {
  let modelSteps = 0;
  const waitingSnapshot: any = {
    goal: { status: "active" }, runtime: { phase: "waiting_user" }, pendingQuestion: null,
    plan: [
      { stepId: "writing-specification", title: "生成写作规格", status: "completed", result: "ready" },
      { stepId: "specification-confirmation", title: "确认写作规格", status: "in_progress", result: "" },
      { stepId: "draft", title: "起草正文", status: "pending", result: "" }
    ]
  };
  let modelCallback: ((input: { messages: unknown[]; tools: unknown[] }) => Promise<unknown>) | null = null;
  const runtime = {
    sessionMachine: { events: [] },
    startAgentLoop: () => undefined,
    advanceAgentLoop: async (callback: typeof modelCallback) => {
      modelCallback = callback;
      const answered = await callback!({ messages: [{ role: "user", content: "总结下问题在哪" }], tools: [] });
      return {
        status: "completed",
        messages: [{ role: "assistant", content: String((answered as { content?: string }).content ?? ""), toolCalls: [] }],
        pending: null,
        finalContent: String((answered as { content?: string }).content ?? "")
      };
    },
    getSnapshot: () => ({ runs: [] })
  };
  const service = new ModelChatAgentLoopService({
    executeStep: async () => {
      modelSteps += 1;
      return { content: "卡在规格确认：计划未持久化完成，纯文本确认未被推进起草。", toolCalls: [] };
    },
    projectEvent: () => undefined,
    runOutline: async (input: { generatedContent: string }) => input,
    runFinalization: async (input: { generatedContent: string }) => input,
    buildResult: (input: { generatedContent: string }) => ({ skillDisclosure: "", canonicalContent: input.generatedContent, result: input })
  } as never);

  const output = await service.run({
    modelInput: { requestId: "summarize-stall" } as ModelChatInput, runtime,
    abortController: new AbortController(), requestMessages: [{ role: "user", content: "总结下问题在哪" }],
    effectiveSystemPrompt: "system", centralSkillNames: ["government-research-writing"], disclosedSkills: [],
    nativeWebSearches: [], writtenArtifacts: [], workspacePath: "C:/workspace", threadId: "thread",
    latestUserRequest: "总结下问题在哪", goalSnapshot: waitingSnapshot, reasoningSummaryParts: [],
    emitReasoningSummary: () => undefined, emitStream: () => undefined, publishRetry: () => undefined,
    publishWebSearch: () => undefined, publishActivity: () => undefined, recordTokens: () => undefined,
    setModelCallback: (callback: typeof modelCallback) => { modelCallback = callback; },
    getGoalSnapshot: () => waitingSnapshot,
    governmentSpecificationSnapshot: { currentVersionId: "v1", confirmedVersionId: undefined },
    confirmGovernmentSpecificationFromChat: async () => {
      throw new Error("confirm should not run for a summarize question");
    }
  } as never);

  assert.ok(modelSteps >= 1);
  assert.doesNotMatch(String(output.canonicalContent), /写作规格分析已完成|请在规格面板/);
  assert.match(String(output.canonicalContent), /规格确认|计划/);
});

test("confirm requests never re-emit the waiting prompt when a durable specification already exists", async () => {
  let confirmCalls = 0;
  let modelSteps = 0;
  const waitingSnapshot: any = {
    goal: { status: "active" }, runtime: { phase: "waiting_user" }, pendingQuestion: null,
    plan: [
      { stepId: "writing-specification", title: "生成写作规格", status: "completed", result: "ready" },
      { stepId: "specification-confirmation", title: "确认写作规格", status: "in_progress", result: "" },
      { stepId: "draft", title: "起草正文", status: "pending", result: "" }
    ]
  };
  const confirmedSnapshot: any = {
    goal: { status: "active" }, runtime: { phase: "running" }, pendingQuestion: null,
    plan: [
      { stepId: "writing-specification", title: "生成写作规格", status: "completed", result: "ready" },
      { stepId: "specification-confirmation", title: "确认写作规格", status: "completed", result: "用户已确认" },
      { stepId: "draft", title: "起草正文", status: "in_progress", result: "" }
    ]
  };
  let current = waitingSnapshot;
  let modelCallback: ((input: { messages: unknown[]; tools: unknown[] }) => Promise<unknown>) | null = null;
  const runtime = {
    sessionMachine: { events: [] },
    startAgentLoop: () => undefined,
    advanceAgentLoop: async (callback: typeof modelCallback) => {
      modelCallback = callback;
      // Simulate the host asking for another model step while the plan is still waiting.
      const stuck = await callback!({ messages: [{ role: "user", content: "确认" }], tools: [] });
      return {
        status: "completed",
        messages: [{ role: "assistant", content: String((stuck as { content?: string }).content ?? ""), toolCalls: [] }],
        pending: null,
        finalContent: String((stuck as { content?: string }).content ?? "")
      };
    },
    getSnapshot: () => ({ runs: [] })
  };
  const service = new ModelChatAgentLoopService({
    executeStep: async () => {
      modelSteps += 1;
      return { content: "按确认规格开始起草正文。", toolCalls: [] };
    },
    projectEvent: () => undefined,
    runOutline: async (input: { generatedContent: string }) => input,
    runFinalization: async (input: { generatedContent: string }) => input,
    buildResult: (input: { generatedContent: string }) => ({ skillDisclosure: "", canonicalContent: input.generatedContent, result: input })
  } as never);

  // Force the generic loop by making the early confirm leave the plan still waiting,
  // then assert the model callback still confirms instead of repeating the wait prompt.
  const output = await service.run({
    modelInput: { requestId: "confirm-no-wait-loop" } as ModelChatInput, runtime,
    abortController: new AbortController(), requestMessages: [{ role: "user", content: "「确认」" }],
    effectiveSystemPrompt: "system", centralSkillNames: ["government-research-writing"], disclosedSkills: [],
    nativeWebSearches: [], writtenArtifacts: [], workspacePath: "C:/workspace", threadId: "thread",
    latestUserRequest: "「确认」", goalSnapshot: waitingSnapshot, reasoningSummaryParts: [],
    emitReasoningSummary: () => undefined, emitStream: () => undefined, publishRetry: () => undefined,
    publishWebSearch: () => undefined, publishActivity: () => undefined, recordTokens: () => undefined,
    setModelCallback: (callback: typeof modelCallback) => { modelCallback = callback; },
    getGoalSnapshot: () => current,
    governmentSpecificationSnapshot: { currentVersionId: "v1", confirmedVersionId: undefined, currentVersion: { content: { task: "t", requirements: [], cases: [], structure: [] } } },
    confirmGovernmentSpecificationFromChat: async () => {
      confirmCalls += 1;
      // Leave plan waiting so the model callback path is exercised.
      return {
        currentVersionId: "v1",
        confirmedVersionId: "v1",
        currentVersion: { content: { task: "t", requirements: [{ label: "篇幅", value: "3500字" }], cases: [], structure: [{ title: "一" }, { title: "二" }] } }
      };
    }
  } as never);

  assert.ok(confirmCalls >= 1);
  assert.ok(modelSteps >= 1);
  assert.doesNotMatch(String(output.canonicalContent), /写作规格分析已完成/);
  assert.match(String(output.canonicalContent), /起草正文|按确认规格/);
  // After the turn, even if the callback confirmed while plan stayed waiting, the wait prompt must not appear.
  current = confirmedSnapshot;
});

test("builds a file-free revision explanation from the user's numbered requirements", () => {
  const preview = buildGovernmentRevisionPreview(`保留第一版PDF，不得覆盖。\n1. 开头增加“同志们”；\n2. 增加对一线职工、技术人员和安全管理人员的感谢；\n3. “存在的问题”部分语气要客观，不回避问题；\n4. 结尾增加2026年工作动员；\n5. 先给修改说明，不要立即生成文件。`);
  assert.match(preview, /同志们/u);
  assert.match(preview, /一线职工、技术人员和安全管理人员/u);
  assert.match(preview, /存在的问题/u);
  assert.match(preview, /2026年工作动员/u);
  assert.match(preview, /不生成任何新文件/u);
  assert.match(preview, /不覆盖/u);
});

test("hands government writing off once prerequisite steps complete and outline starts", () => {
  const snapshot: any = {
    goal: { status: "active" }, pendingQuestion: null,
    plan: [
      { stepId: "material-assessment", title: "材料评估", status: "completed" },
      { stepId: "requirement-clarification", title: "需求澄清", status: "completed" },
      { stepId: "outline", title: "生成提纲", status: "in_progress" },
      { stepId: "outline-confirmation", title: "提纲确认", status: "pending" }
    ]
  };
  assert.equal(shouldHandoffGovernmentOutline(snapshot), true);
  assert.equal(shouldHandoffGovernmentOutline({ ...snapshot, plan: snapshot.plan.map((step: any, index: number) => index === 0 ? { ...step, status: "in_progress" } : step) }), false);
});

test("uses the dedicated full-draft stage after outline confirmation", () => {
  const snapshot: any = {
    goal: { status: "active" },
    pendingQuestion: null,
    plan: [
      { stepId: "outline-confirmation", title: "提纲确认", status: "completed" },
      { stepId: "draft-safety", title: "分段撰写：安全生产", status: "pending" },
      { stepId: "style", title: "统一政务文风与结构", status: "pending" },
      { stepId: "delivery", title: "交付正文与所需文件", status: "pending" }
    ]
  };
  assert.equal(shouldRunGovernmentDraftDirectly(snapshot), true);
  assert.equal(shouldRunGovernmentDraftDirectly({ ...snapshot, pendingQuestion: { questionId: "q" } }), false);
});
const { createLocalRuntime } = await import(
  new URL("./agent-runtime-adapter.ts", import.meta.url).href
);
import {
  isGovernmentRevisionPreviewRequest,
  shouldAutomaticallyUseGovernmentWriting
} from "./government-skill-routing.js";

test("recognizes a government revision preview that explicitly forbids file generation", () => {
  assert.equal(isGovernmentRevisionPreviewRequest("先在对话中给我修改说明，不要立即生成文件。"), true);
  assert.equal(isGovernmentRevisionPreviewRequest("确认修改，生成第二版PDF和DOCX。"), false);
});

test("keeps workflow commentary out of government PDF content", () => {
  const cleaned = prepareGovernmentPdfContent([
    "原始交付要求：写发言稿并生成 PDF。",
    "同志们：",
    "大家好！过去一年，全体干部职工担当尽责。新的一年，我们将守牢安全底线，推动企业高质量发展。谢谢大家！",
    "### 终审结果",
    "- 文风统一：已检查。",
    "PDF 文件尚未生成并验证，目标保持进行中。"
  ].join("\n"), [], "写发言稿并生成 PDF");
  assert.match(cleaned, /^同志们：/u);
  assert.doesNotMatch(cleaned, /原始交付要求|终审结果|尚未生成/u);
});

test("keeps the complete speech when the closing mobilization repeats the salutation", () => {
  const cleaned = prepareGovernmentPdfContent(
    "同志们：\n一、安全生产包含301万吨、5180人次和31套设备。\n二、存在的问题。\n同志们，新一年继续奋斗。\n谢谢大家。",
    [],
    ""
  );
  assert.match(cleaned, /301万吨/);
  assert.match(cleaned, /存在的问题/);
  assert.match(cleaned, /新一年继续奋斗/);
});

test("runs one bounded loop with isolated tool context and canonical projection", async () => {
  const captured = {
    messages: [] as Array<{ role: string; content: string }>,
    projected: 0,
    callbacks: 0,
    outlineRuns: 0,
    finalizationRuns: 0
  };
  const runtime = {
    sessionMachine: { events: [{ type: "before" }] },
    startAgentLoop: (messages: Array<{ role: string; content: string }>, options: { onEvent: (event: unknown) => void }) => {
      captured.messages = messages;
      options.onEvent({ type: "tool_started", payload: {} });
    },
    advanceAgentLoop: async (callback: (input: { messages: unknown[]; tools: unknown[] }) => Promise<unknown>) => {
      await callback({ messages: [], tools: [] });
      runtime.sessionMachine.events.push({ type: "after" });
      return {
        status: "completed",
        messages: [{ role: "assistant", content: "draft", toolCalls: [] }],
        pending: null,
        finalContent: "draft"
      };
    },
    getSnapshot: () => ({ runs: [] })
  };
  const service = new ModelChatAgentLoopService({
    executeStep: async () => ({ content: "step", toolCalls: [] }),
    projectEvent: () => { captured.projected += 1; },
    runOutline: async (input: { generatedContent: string }) => {
      captured.outlineRuns += 1;
      return { generatedContent: `${input.generatedContent}-outline` };
    },
    runFinalization: async (input: { generatedContent: string }) => {
      captured.finalizationRuns += 1;
      return { generatedContent: `${input.generatedContent}-final` };
    },
    buildResult: (input: { generatedContent: string }) => ({
      skillDisclosure: "skills",
      canonicalContent: input.generatedContent,
      result: { content: input.generatedContent }
    })
  } as never);

  const output = await service.run({
    modelInput: { requestId: "request-1", toolContext: "tool data" } as ModelChatInput,
    runtime,
    abortController: new AbortController(),
    requestMessages: [{ role: "user", content: "user words" }],
    effectiveSystemPrompt: "system",
    centralSkillNames: [],
    disclosedSkills: [],
    nativeWebSearches: [],
    writtenArtifacts: [],
    workspacePath: "C:/workspace",
    threadId: "thread-1",
    latestUserRequest: "user words",
    goalSnapshot: null,
    reasoningSummaryParts: [],
    emitReasoningSummary: () => undefined,
    emitStream: () => undefined,
    publishRetry: () => undefined,
    publishWebSearch: () => undefined,
    publishActivity: () => undefined,
    recordTokens: () => undefined,
    setModelCallback: () => { captured.callbacks += 1; },
    getGoalSnapshot: () => null
  } as never);

  assert.match(captured.messages[0].content, /user words/);
  assert.match(captured.messages[0].content, /non-user tool context/);
  assert.match(captured.messages[0].content, /tool data/);
  assert.equal(captured.projected, 1);
  assert.equal(captured.callbacks, 1);
  assert.equal(output.canonicalContent, "draft");
  assert.equal(captured.outlineRuns, 0);
  assert.equal(captured.finalizationRuns, 0);
  assert.deepEqual(output.agentEvents, [{ type: "after" }]);
});

test("intersects remote task tools with locally registered tools before loop start", async () => {
  let allowedToolNames: string[] | undefined;
  const runtime = {
    sessionMachine: { events: [] as unknown[] },
    startAgentLoop: (_messages: unknown[], options: { allowedToolNames?: string[] }) => {
      allowedToolNames = options.allowedToolNames;
    },
    advanceAgentLoop: async () => ({
      status: "completed", messages: [], pending: null, finalContent: "done"
    }),
    getSnapshot: () => ({ runs: [] })
  };
  const service = new ModelChatAgentLoopService({
    executeStep: async () => ({ content: "done", toolCalls: [] }),
    projectEvent: () => undefined,
    runOutline: async (input: { generatedContent: string }) => input,
    runFinalization: async (input: { generatedContent: string }) => input,
    buildResult: (input: { generatedContent: string }) => ({
      skillDisclosure: "", canonicalContent: input.generatedContent, result: input
    })
  } as never);

  await service.run({
    modelInput: { requestId: "remote-request" } as ModelChatInput,
    runtime,
    abortController: new AbortController(),
    requestMessages: [{ role: "user", content: "run" }],
    effectiveSystemPrompt: "system",
    centralSkillNames: [], disclosedSkills: [], nativeWebSearches: [], writtenArtifacts: [],
    workspacePath: "C:/workspace", threadId: "thread-1", latestUserRequest: "run", goalSnapshot: null,
    reasoningSummaryParts: [], emitReasoningSummary: () => undefined, emitStream: () => undefined,
    publishRetry: () => undefined, publishWebSearch: () => undefined, publishActivity: () => undefined,
    recordTokens: () => undefined, setModelCallback: () => undefined, getGoalSnapshot: () => null,
    remoteExecutionContext: {
      workItemId: "wi_1",
      knowledgeSnapshotId: "ks_1",
      allowedToolNames: ["shell", "unknown.remote.tool"],
      registeredToolNames: ["shell", "read_file"]
    }
  } as never);

  assert.deepEqual(allowedToolNames, ["shell"]);
});

test("allows government writing to continue after material-reading tool calls", async () => {
  const activeGoal = { goal: { status: "active" }, runtime: { phase: "running" }, pendingQuestion: null, plan: [] };
  let configuredMaxSteps = 0;
  const runtime = {
    sessionMachine: { events: [] as unknown[] },
    startAgentLoop: (_messages: unknown[], options: { maxSteps: number }) => {
      configuredMaxSteps = options.maxSteps;
    },
    advanceAgentLoop: async () => ({
      status: "completed",
      messages: [{ role: "assistant", content: "draft", toolCalls: [] }],
      pending: null,
      finalContent: "draft"
    }),
    getSnapshot: () => ({ runs: [] })
  };
  const service = new ModelChatAgentLoopService({
    executeStep: async () => ({ content: "draft", toolCalls: [] }),
    projectEvent: () => undefined,
    runOutline: async (input: { generatedContent: string }) => input,
    runFinalization: async (input: { generatedContent: string }) => input,
    buildResult: (input: { generatedContent: string }) => ({
      skillDisclosure: "",
      canonicalContent: input.generatedContent,
      result: input
    })
  } as never);

  await service.run({
    modelInput: { requestId: "government-tool-loop" } as ModelChatInput,
    runtime,
    abortController: new AbortController(),
    requestMessages: [{ role: "user", content: "read the attached workbook and write a report" }],
    effectiveSystemPrompt: "system",
    centralSkillNames: ["government-research-writing"],
    disclosedSkills: [], nativeWebSearches: [], writtenArtifacts: [],
    workspacePath: "C:/workspace", threadId: "thread-1",
    latestUserRequest: "read the attached workbook and write a report",
    goalSnapshot: activeGoal, reasoningSummaryParts: [], emitReasoningSummary: () => undefined,
    emitStream: () => undefined, publishRetry: () => undefined, publishWebSearch: () => undefined,
    publishActivity: () => undefined, recordTokens: () => undefined,
    setModelCallback: () => undefined, getGoalSnapshot: () => activeGoal
  } as never);

  assert.equal(configuredMaxSteps, Number.POSITIVE_INFINITY);
});

test("only exposes durable goal tools to the government writing model", async () => {
  const activeGoal = { goal: { status: "active" }, runtime: { phase: "running" }, pendingQuestion: null, plan: [] };
  let exposedToolNames: string[] = [];
  const runtime = {
    sessionMachine: { events: [] },
    startAgentLoop: () => undefined,
    advanceAgentLoop: async (callback: any) => {
      await callback({ messages: [], tools: [
        { name: "workspace.scan" }, { name: "shell.exec" }, { name: "workspace.write_file" },
        { name: "agent.delegate" }, { name: "goal.get" }, { name: "goal.update_plan" },
        { name: "web.search_official" }, { name: "web.read_official" }
      ] });
      return { status: "completed", messages: [{ role: "assistant", content: "outline" }], pending: null, finalContent: "outline" };
    },
    getSnapshot: () => ({ runs: [] })
  };
  const service = new ModelChatAgentLoopService({
    executeStep: async ({ tools }: { tools: Array<{ name: string }> }) => {
      exposedToolNames = tools.map((tool) => tool.name);
      return { content: "outline", toolCalls: [] };
    },
    projectEvent: () => undefined,
    runOutline: async (input: any) => input,
    runFinalization: async (input: any) => input,
    buildResult: (input: any) => ({ skillDisclosure: "", canonicalContent: input.generatedContent, result: input })
  } as never);
  await service.run({
    modelInput: { requestId: "no-government-delegation" }, runtime,
    abortController: new AbortController(), requestMessages: [{ role: "user", content: "write" }],
    effectiveSystemPrompt: "system", centralSkillNames: ["government-research-writing"], disclosedSkills: [],
    nativeWebSearches: [], writtenArtifacts: [], workspacePath: "C:/workspace", threadId: "thread",
    latestUserRequest: "write", goalSnapshot: activeGoal, reasoningSummaryParts: [], emitReasoningSummary: () => undefined,
    emitStream: () => undefined, publishRetry: () => undefined, publishWebSearch: () => undefined,
    publishActivity: () => undefined, recordTokens: () => undefined, setModelCallback: () => undefined,
    getGoalSnapshot: () => activeGoal
  } as never);
  assert.deepEqual(exposedToolNames, [
    "goal.get", "goal.update_plan", "web.search_official", "web.read_official"
  ]);
});

test("streams all displayable government-writing text without a visibility gate", async () => {
  let suppressVisibleContent: boolean | undefined;
  const runtime = {
    sessionMachine: { events: [] }, startAgentLoop: () => undefined,
    advanceAgentLoop: async (callback: any) => {
      await callback({ messages: [], tools: [] });
      return { status: "completed", messages: [{ role: "assistant", content: "正文" }], pending: null, finalContent: "正文" };
    },
    getSnapshot: () => ({ runs: [] })
  };
  const service = new ModelChatAgentLoopService({
    executeStep: async (input: { suppressVisibleContent: boolean }) => {
      suppressVisibleContent = input.suppressVisibleContent;
      return { content: "正文", toolCalls: [] };
    },
    projectEvent: () => undefined,
    runOutline: async (input: any) => input,
    runFinalization: async (input: any) => input,
    buildResult: (input: any) => ({ skillDisclosure: "", canonicalContent: input.generatedContent, result: input })
  } as never);
  await service.run({
    modelInput: { requestId: "government-visible-output" }, runtime,
    abortController: new AbortController(), requestMessages: [{ role: "user", content: "撰写报告" }],
    effectiveSystemPrompt: "system", centralSkillNames: ["government-research-writing"], disclosedSkills: [],
    nativeWebSearches: [], writtenArtifacts: [], workspacePath: "C:/workspace", threadId: "thread",
    latestUserRequest: "撰写报告", goalSnapshot: null, reasoningSummaryParts: [], emitReasoningSummary: () => undefined,
    emitStream: () => undefined, publishRetry: () => undefined, publishWebSearch: () => undefined,
    publishActivity: () => undefined, recordTokens: () => undefined, setModelCallback: () => undefined,
    getGoalSnapshot: () => null
  } as never);
  assert.equal(suppressVisibleContent, false);
});

test("government outline preparation bypasses the generic agent loop", async () => {
  let genericLoopStarted = false;
  let outlineInput: any = null;
  const goalSnapshot = {
    goal: { status: "active" }, runtime: { phase: "running" }, pendingQuestion: null,
    plan: [
      { stepId: "material-assessment", title: "material", status: "in_progress", result: "" },
      { stepId: "outline", title: "outline", status: "pending", result: "" },
      { stepId: "outline-confirmation", title: "confirm", status: "pending", result: "" },
      { stepId: "draft", title: "draft", status: "pending", result: "" }
    ]
  };
  const service = new ModelChatAgentLoopService({
    executeStep: async () => { throw new Error("generic model step must not run"); },
    projectEvent: () => undefined,
    runOutline: async (input: any) => { outlineInput = input; return { generatedContent: "完整提纲" }; },
    runFinalization: async (input: any) => input,
    buildResult: (input: any) => ({ skillDisclosure: "", canonicalContent: input.generatedContent, result: input })
  } as never);
  const runtime = {
    sessionMachine: { events: [] },
    startAgentLoop: () => { genericLoopStarted = true; },
    advanceAgentLoop: async () => { throw new Error("generic loop must not advance"); },
    getSnapshot: () => ({ runs: [] })
  };
  const output = await service.run({
    modelInput: { requestId: "direct-outline" }, runtime,
    abortController: new AbortController(),
    requestMessages: [{ role: "user", content: "先给提纲" }],
    effectiveSystemPrompt: "system", centralSkillNames: ["government-research-writing"], disclosedSkills: [],
    nativeWebSearches: [], writtenArtifacts: [], workspacePath: "C:/workspace", threadId: "thread",
    latestUserRequest: "先给提纲", goalSnapshot, reasoningSummaryParts: [], emitReasoningSummary: () => undefined,
    emitStream: () => undefined, publishRetry: () => undefined, publishWebSearch: () => undefined,
    publishActivity: () => undefined, recordTokens: () => undefined, setModelCallback: () => undefined,
    getGoalSnapshot: () => goalSnapshot
  } as never);
  assert.equal(genericLoopStarted, false);
  assert.equal(outlineInput.generatedContent, "");
  assert.equal(output.canonicalContent, "完整提纲");
});

test("government writing executes a material-reading tool and then performs the next model step", async (t) => {
  const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "newbrain-government-tool-loop-"));
  t.after(() => fs.rm(workspacePath, { recursive: true, force: true }));
  await fs.writeFile(path.join(workspacePath, "material.txt"), "301 万吨", "utf8");
  const runtime = await createLocalRuntime({
    runtimeId: "government-tool-loop",
    workspacePath,
    platformLabel: "Windows",
    shellLabel: "PowerShell"
  });
  let modelSteps = 0;
  let sawToolResult = false;
  const service = new ModelChatAgentLoopService({
    executeStep: async ({ messages }: { messages: Array<{ role: string }> }) => {
      modelSteps += 1;
      if (modelSteps === 1) {
        return {
          content: "",
          toolCalls: [{ id: "scan-materials", name: "workspace.scan", arguments: "{}" }]
        };
      }
      sawToolResult = messages.at(-1)?.role === "tool";
      return { content: "已根据材料继续撰写正文。", toolCalls: [] };
    },
    projectEvent: () => undefined,
    runOutline: async (input: { generatedContent: string }) => input,
    runFinalization: async (input: { generatedContent: string }) => input,
    buildResult: (input: { generatedContent: string }) => ({
      skillDisclosure: "",
      canonicalContent: input.generatedContent,
      result: input
    })
  } as never);

  const output = await service.run({
    modelInput: { requestId: "government-tool-loop", permissionMode: "full" } as ModelChatInput,
    runtime,
    abortController: new AbortController(),
    requestMessages: [{ role: "user", content: "读取材料后撰写报告" }],
    effectiveSystemPrompt: "system", centralSkillNames: ["government-research-writing"],
    disclosedSkills: [], nativeWebSearches: [], writtenArtifacts: [], workspacePath,
    threadId: "thread-1", latestUserRequest: "读取材料后撰写报告", goalSnapshot: null,
    reasoningSummaryParts: [], emitReasoningSummary: () => undefined, emitStream: () => undefined,
    publishRetry: () => undefined, publishWebSearch: () => undefined, publishActivity: () => undefined,
    recordTokens: () => undefined, setModelCallback: () => undefined, getGoalSnapshot: () => null
  } as never);

  assert.equal(modelSteps, 2);
  assert.equal(sawToolResult, true);
  assert.equal(output.canonicalContent, "已根据材料继续撰写正文。");
});

test("routes a typical government case-study article to government writing", () => {
  assert.equal(shouldAutomaticallyUseGovernmentWriting("请你撰写一篇关于‘因地制宜发展新质生产力’的典型案例研究文章。"), true);
  assert.equal(shouldAutomaticallyUseGovernmentWriting("撰写一篇理论案例文章，兼具理论深度和实践温度。"), true);
});

test("case-study specification cannot bypass official evidence research", () => {
  const request = "请撰写一篇典型案例研究文章";
  const snapshot = {
    goal: { status: "active" },
    plan: [
      { stepId: "official-evidence-research", status: "in_progress" },
      { stepId: "writing-specification", status: "pending" }
    ]
  } as never;
  assert.equal(canGenerateDirectGovernmentResearchSpecification({
    snapshot,
    hasCurrentSpecification: false,
    request
  }), false);

  const researched = {
    goal: { status: "active" },
    plan: [
      { stepId: "official-evidence-research", status: "completed" },
      { stepId: "writing-specification", status: "in_progress" }
    ]
  } as never;
  assert.equal(canGenerateDirectGovernmentResearchSpecification({
    snapshot: researched,
    hasCurrentSpecification: false,
    request
  }), true);
  assert.equal(canGenerateDirectGovernmentResearchSpecification({
    snapshot: researched,
    hasCurrentSpecification: true,
    request
  }), false);
});

test("confirmed government specification drafts directly without starting the generic agent loop", async () => {
  let starts = 0;
  let executedTools: unknown[] | undefined;
  let visibleContentIdleTimeoutMs: number | undefined;
  let finalizationRequest = "";
  const snapshot = {
    goal: { status: "active" }, runtime: { phase: "running" }, pendingQuestion: null,
    plan: [
      { stepId: "spec-confirm", title: "确认写作规格", status: "completed", result: "confirmed" },
      { stepId: "draft", title: "起草正文", status: "in_progress", result: "" }
    ]
  };
  const runtime = {
    sessionMachine: { events: [] },
    startAgentLoop: () => { starts += 1; },
    advanceAgentLoop: async () => { throw new Error("generic loop must not start"); },
    getSnapshot: () => ({ runs: [] })
  };
  const service = new ModelChatAgentLoopService({
    executeStep: async ({ tools, visibleContentIdleTimeoutMs: timeout }: { tools: unknown[]; visibleContentIdleTimeoutMs?: number }) => {
      executedTools = tools;
      visibleContentIdleTimeoutMs = timeout;
      return { content: "正文已经开始。", toolCalls: [] };
    },
    projectEvent: () => undefined,
    runOutline: async (input: { generatedContent: string }) => input,
    runFinalization: async (input: { generatedContent: string; latestUserRequest: string }) => {
      finalizationRequest = input.latestUserRequest;
      return input;
    },
    buildResult: (input: { generatedContent: string }) => ({ skillDisclosure: "", canonicalContent: input.generatedContent, result: input })
  } as never);

  const output = await service.run({
    modelInput: { requestId: "confirmed-draft" } as ModelChatInput, runtime,
    abortController: new AbortController(), requestMessages: [{ role: "user", content: "规格已确认，开始写作" }],
    effectiveSystemPrompt: "system", centralSkillNames: ["government-research-writing"], disclosedSkills: [],
    nativeWebSearches: [], writtenArtifacts: [], workspacePath: "C:/workspace", threadId: "thread",
    latestUserRequest: "规格已确认，开始写作", goalSnapshot: snapshot, reasoningSummaryParts: [],
    emitReasoningSummary: () => undefined, emitStream: () => undefined, publishRetry: () => undefined,
    publishWebSearch: () => undefined, publishActivity: () => undefined, recordTokens: () => undefined,
    setModelCallback: () => undefined, getGoalSnapshot: () => snapshot,
    governmentSpecificationSnapshot: { currentVersionId: "v1", confirmedVersionId: "v1", currentVersion: { content: { requirements: [{ label: "篇幅", value: "3500-4000字" }] } } }
  } as never);

  assert.equal(starts, 0);
  assert.deepEqual(executedTools, []);
  assert.equal(visibleContentIdleTimeoutMs, 10 * 60_000);
  assert.equal(output.canonicalContent, "正文已经开始。");
  assert.match(finalizationRequest, /3500-4000字/u);
});

test("legacy confirmed outline without a specification still reaches the model", async () => {
  let modelSteps = 0;
  const snapshot = {
    goal: { status: "active" }, runtime: { phase: "running" }, pendingQuestion: null,
    plan: [
      { stepId: "outline-confirm", title: "确认当前提纲", status: "completed", result: "confirmed" },
      { stepId: "draft", title: "起草正文", status: "in_progress", result: "" }
    ]
  };
  const runtime = {
    sessionMachine: { events: [] },
    startAgentLoop: () => { throw new Error("legacy confirmed outline must use the direct draft path"); },
    advanceAgentLoop: async () => { throw new Error("generic loop must not start"); },
    getSnapshot: () => ({ runs: [] })
  };
  const service = new ModelChatAgentLoopService({
    executeStep: async () => {
      modelSteps += 1;
      return { content: "已从确认的旧提纲继续起草。", toolCalls: [] };
    },
    projectEvent: () => undefined,
    runOutline: async (input: { generatedContent: string }) => input,
    runFinalization: async (input: { generatedContent: string }) => input,
    buildResult: (input: { generatedContent: string }) => ({ skillDisclosure: "", canonicalContent: input.generatedContent, result: input })
  } as never);

  const output = await service.run({
    modelInput: { requestId: "legacy-confirmed-outline" } as ModelChatInput, runtime,
    abortController: new AbortController(), requestMessages: [{ role: "user", content: "从上次异常中断的位置继续执行。" }],
    effectiveSystemPrompt: "system", centralSkillNames: ["government-research-writing"], disclosedSkills: [],
    nativeWebSearches: [], writtenArtifacts: [], workspacePath: "C:/workspace", threadId: "thread",
    latestUserRequest: "从上次异常中断的位置继续执行。", goalSnapshot: snapshot, reasoningSummaryParts: [],
    emitReasoningSummary: () => undefined, emitStream: () => undefined, publishRetry: () => undefined,
    publishWebSearch: () => undefined, publishActivity: () => undefined, recordTokens: () => undefined,
    setModelCallback: () => undefined, getGoalSnapshot: () => snapshot,
    governmentSpecificationSnapshot: null
  } as never);

  assert.equal(modelSteps, 1);
  assert.equal(output.canonicalContent, "已从确认的旧提纲继续起草。");
});

test("automatically continues an active durable goal until its plan completes", async () => {
  let loops = 0;
  let starts = 0;
  const activities: unknown[] = [];
  const goal = (completed: boolean) => ({
    goal: { status: "active" },
    runtime: { phase: "running" },
    pendingQuestion: null,
    plan: [{ stepId: "draft-1", status: completed ? "completed" : "in_progress", result: completed ? "written" : "" }]
  });
  const runtime = {
    sessionMachine: { events: [] as unknown[] },
    startAgentLoop: (messages: Array<{ role: string; content: string }>) => {
      starts += 1;
      if (starts === 2) assert.match(messages.at(-1)?.content ?? "", /durable-goal continuation/);
    },
    advanceAgentLoop: async () => {
      loops += 1;
      return {
        status: "completed",
        messages: [{ role: "assistant", content: `draft-${loops}`, toolCalls: [] }],
        pending: null,
        finalContent: `draft-${loops}`
      };
    },
    getSnapshot: () => ({ runs: [] })
  };
  const service = new ModelChatAgentLoopService({
    executeStep: async () => ({ content: "step", toolCalls: [] }),
    projectEvent: () => undefined,
    runOutline: async (input: { generatedContent: string }) => ({ generatedContent: input.generatedContent }),
    runFinalization: async (input: { generatedContent: string }) => ({ generatedContent: input.generatedContent }),
    buildResult: (input: { generatedContent: string }) => ({ skillDisclosure: "", canonicalContent: input.generatedContent, result: input })
  } as never);

  const output = await service.run({
    modelInput: { requestId: "request-goal" } as ModelChatInput,
    runtime,
    abortController: new AbortController(),
    requestMessages: [{ role: "user", content: "write" }],
    effectiveSystemPrompt: "system",
    centralSkillNames: [], disclosedSkills: [], nativeWebSearches: [], writtenArtifacts: [],
    workspacePath: "C:/workspace", threadId: "thread-1", latestUserRequest: "write",
    goalSnapshot: goal(false), reasoningSummaryParts: [], emitReasoningSummary: () => undefined,
    emitStream: () => undefined, publishRetry: () => undefined, publishWebSearch: () => undefined,
    publishActivity: (activity: unknown) => { activities.push(activity); }, recordTokens: () => undefined,
    setModelCallback: () => undefined,
    getGoalSnapshot: () => goal(loops >= 2)
  } as never);

  assert.equal(loops, 2);
  assert.equal(starts, 2);
  assert.equal(activities.length, 1);
  assert.equal(output.canonicalContent, "draft-2");
});

test("hands off an active durable goal without reporting a model failure when continuation makes no progress", async () => {
  const snapshot = {
    goal: { status: "active" }, runtime: { phase: "running" }, pendingQuestion: null,
    plan: [{ stepId: "draft-1", status: "in_progress", result: "" }]
  };
  const runtime = {
    sessionMachine: { events: [] as unknown[] },
    startAgentLoop: () => undefined,
    advanceAgentLoop: async () => ({
      status: "completed", messages: [{ role: "assistant", content: "working", toolCalls: [] }],
      pending: null, finalContent: "working"
    }),
    getSnapshot: () => ({ runs: [] })
  };
  const service = new ModelChatAgentLoopService({
    executeStep: async () => ({ content: "step", toolCalls: [] }), projectEvent: () => undefined,
    runOutline: async (input: { generatedContent: string }) => input,
    runFinalization: async (input: { generatedContent: string }) => input,
    buildResult: (input: { generatedContent: string }) => ({ skillDisclosure: "", canonicalContent: input.generatedContent, result: input })
  } as never);

  const output = await service.run({
    modelInput: { requestId: "request-stalled-goal" } as ModelChatInput, runtime,
    abortController: new AbortController(), requestMessages: [{ role: "user", content: "continue" }],
    effectiveSystemPrompt: "system", centralSkillNames: [], disclosedSkills: [], nativeWebSearches: [], writtenArtifacts: [],
    workspacePath: "C:/workspace", threadId: "thread-1", latestUserRequest: "continue", goalSnapshot: snapshot,
    reasoningSummaryParts: [], emitReasoningSummary: () => undefined, emitStream: () => undefined,
    publishRetry: () => undefined, publishWebSearch: () => undefined, publishActivity: () => undefined,
    recordTokens: () => undefined, setModelCallback: () => undefined, getGoalSnapshot: () => snapshot
  } as never);

  assert.match(output.canonicalContent, /没有产生进度/);
});

test("hands off instead of reporting a model failure when an unsafe tool call lacks a durable result", async () => {
  const snapshot = {
    goal: { status: "active" }, runtime: { phase: "running" }, pendingQuestion: null,
    plan: [{ stepId: "draft-1", status: "in_progress", result: "" }]
  };
  const runtime = {
    sessionMachine: { events: [{ type: "tool_call", payload: { id: "unsafe-call", replaySafe: false } }] },
    startAgentLoop: () => undefined,
    advanceAgentLoop: async () => ({
      status: "completed", messages: [{ role: "assistant", content: "working", toolCalls: [] }],
      pending: null, finalContent: "working"
    }),
    getSnapshot: () => ({ runs: [] })
  };
  const service = new ModelChatAgentLoopService({
    executeStep: async () => ({ content: "step", toolCalls: [] }), projectEvent: () => undefined,
    runOutline: async (input: { generatedContent: string }) => input,
    runFinalization: async (input: { generatedContent: string }) => input,
    buildResult: (input: { generatedContent: string }) => ({ skillDisclosure: "", canonicalContent: input.generatedContent, result: input })
  } as never);

  const output = await service.run({
    modelInput: { requestId: "request-unsafe-orphan" } as ModelChatInput, runtime,
    abortController: new AbortController(), requestMessages: [{ role: "user", content: "continue" }],
    effectiveSystemPrompt: "system", centralSkillNames: [], disclosedSkills: [], nativeWebSearches: [], writtenArtifacts: [],
    workspacePath: "C:/workspace", threadId: "thread-1", latestUserRequest: "continue", goalSnapshot: snapshot,
    reasoningSummaryParts: [], emitReasoningSummary: () => undefined, emitStream: () => undefined,
    publishRetry: () => undefined, publishWebSearch: () => undefined, publishActivity: () => undefined,
    recordTokens: () => undefined, setModelCallback: () => undefined, getGoalSnapshot: () => snapshot
  } as never);

  assert.match(output.canonicalContent, /未落盘结果/);
});

test("lets the selected model decide and execute a DOCX follow-up after the prior goal completed", async (t) => {
  const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "newbrain-docx-followup-"));
  t.after(() => fs.rm(workspacePath, { recursive: true, force: true }));
  const runtime = await createLocalRuntime({ runtimeId: "docx-followup", workspacePath, platformLabel: "Windows", shellLabel: "PowerShell" });
  const writtenArtifacts: Array<{ path: string; size: number; changeType: "created" | "modified" }> = [];
  const prior = "# 年度工作总结\n\n## 一、主要工作\n\n坚持稳中求进，持续改进工作质效。\n\n## 二、下一步安排\n\n压实责任，推动各项任务落实。";
  const completedGoal = { goal: { status: "complete" }, runtime: { phase: "complete" }, pendingQuestion: null, plan: [] };
  let modelSteps = 0;
  let exposedToolNames: string[] = [];
  const service = new ModelChatAgentLoopService({
    executeStep: async ({ messages, tools }: { messages: Array<{ role: string }>; tools: Array<{ name: string }> }) => {
      modelSteps += 1;
      exposedToolNames = tools.map((tool) => tool.name);
      if (modelSteps === 1) return {
        content: "",
        toolCalls: [{ id: "model-chosen-docx", name: "artifact.create", arguments: {
          targetPath: "outputs/newbrain-output.docx", format: "docx", title: "年度工作总结", content: prior
        } }]
      };
      assert.equal(messages.at(-1)?.role, "tool");
      return { content: "已根据当前对话生成并验证 DOCX 文件。", toolCalls: [] };
    },
    projectEvent: (projection: { writtenArtifacts: typeof writtenArtifacts }, event: { type: string; payload: any }) => {
      const artifact = event.payload?.result?.artifact;
      if (event.type === "tool_result" && artifact?.path && artifact?.size && !projection.writtenArtifacts.some((item) => item.path === artifact.path)) {
        projection.writtenArtifacts.push({ path: artifact.path, size: artifact.size, changeType: artifact.changeType ?? "created" });
      }
    },
    runOutline: async (input: any) => input,
    runFinalization: async (input: any) => input,
    buildResult: (input: any) => ({ skillDisclosure: "", canonicalContent: input.generatedContent, result: input })
  } as never);
  const output = await service.run({
    modelInput: { requestId: "docx-followup", permissionMode: "full" } as ModelChatInput, runtime,
    abortController: new AbortController(), requestMessages: [
      { role: "assistant", content: prior }, { role: "user", content: "输出docx文件" }
    ], effectiveSystemPrompt: "system", centralSkillNames: ["government-research-writing"], disclosedSkills: [],
    nativeWebSearches: [], writtenArtifacts, workspacePath, threadId: "thread", latestUserRequest: "输出docx文件",
    goalSnapshot: completedGoal, reasoningSummaryParts: [], emitReasoningSummary: () => undefined, emitStream: () => undefined,
    publishRetry: () => undefined, publishWebSearch: () => undefined, publishActivity: () => undefined,
    recordTokens: () => undefined, setModelCallback: () => undefined, getGoalSnapshot: () => completedGoal
  } as never);
  const docxPath = path.join(workspacePath, "outputs", "newbrain-output.docx");
  const bytes = await fs.readFile(docxPath);
  assert.equal(bytes.subarray(0, 2).toString("ascii"), "PK");
  assert.equal(modelSteps, 2);
  assert.equal(exposedToolNames.includes("artifact.create"), true);
  assert.equal(output.writtenArtifacts.some((artifact: { path: string }) => artifact.path.endsWith(".docx")), true);
});

test("forces another draft pass when the plan claims draft done but chat has no article body", () => {
  const snapshot: any = {
    goal: { status: "active" },
    pendingQuestion: null,
    plan: [
      { stepId: "specification-confirmation", title: "确认写作规格", status: "completed", result: "confirmed" },
      { stepId: "draft", title: "起草正文", status: "completed", result: "Draft produced" },
      { stepId: "style-unification", title: "风格统一", status: "pending", result: "" }
    ]
  };
  assert.equal(
    shouldRunGovernmentDraftDirectly(snapshot, [
      "⏸️ 初稿已完成（约2900字）。Skill 规则要求在确认前不继续推进后续步骤。如需继续，请确认是否进入风格统一与事实核验步骤？"
    ]),
    true
  );
  assert.equal(
    shouldRunGovernmentDraftDirectly(snapshot, [
      `一、背景\n${"贵阳市大数据产业从资源禀赋出发，探索新质生产力落地路径。".repeat(10)}`
    ]),
    false
  );
});

test("retries when the first draft reply is only a completion claim without the article body", async () => {
  let steps = 0;
  const body = `一、背景\n${"贵阳市大数据产业从资源禀赋出发，探索新质生产力落地路径。".repeat(10)}\n二、做法\n${"围绕算力、数据和场景协同推进。".repeat(10)}`;
  const snapshot = {
    goal: { status: "active" }, runtime: { phase: "running" }, pendingQuestion: null,
    plan: [
      { stepId: "specification-confirmation", title: "确认写作规格", status: "completed", result: "confirmed" },
      { stepId: "draft", title: "起草正文", status: "completed", result: "claimed" }
    ]
  };
  const runtime = {
    sessionMachine: { events: [] },
    startAgentLoop: () => { throw new Error("must use direct draft"); },
    advanceAgentLoop: async () => { throw new Error("generic loop must not start"); },
    getSnapshot: () => ({ runs: [] })
  };
  const service = new ModelChatAgentLoopService({
    executeStep: async () => {
      steps += 1;
      if (steps === 1) {
        return {
          content: "⏸️ 初稿已完成（约2900字）。请确认是否进入风格统一与事实核验步骤？",
          toolCalls: []
        };
      }
      return { content: body, toolCalls: [] };
    },
    projectEvent: () => undefined,
    runOutline: async (input: { generatedContent: string }) => input,
    runFinalization: async (input: { generatedContent: string }) => input,
    buildResult: (input: { generatedContent: string }) => ({ skillDisclosure: "", canonicalContent: input.generatedContent, result: input })
  } as never);

  const output = await service.run({
    modelInput: { requestId: "claim-without-body" } as ModelChatInput, runtime,
    abortController: new AbortController(),
    requestMessages: [
      { role: "user", content: "确认" },
      { role: "assistant", content: "⏸️ 初稿已完成（约2900字）。完整正文已在上方呈现。" }
    ],
    effectiveSystemPrompt: "system", centralSkillNames: ["government-research-writing"], disclosedSkills: [],
    nativeWebSearches: [], writtenArtifacts: [], workspacePath: "C:/workspace", threadId: "thread",
    latestUserRequest: "确认", goalSnapshot: snapshot, reasoningSummaryParts: [],
    emitReasoningSummary: () => undefined, emitStream: () => undefined, publishRetry: () => undefined,
    publishWebSearch: () => undefined, publishActivity: () => undefined, recordTokens: () => undefined,
    setModelCallback: () => undefined, getGoalSnapshot: () => snapshot,
    governmentSpecificationSnapshot: { currentVersionId: "v1", confirmedVersionId: "v1", currentVersion: { content: { task: "案例研究" } } }
  } as never);

  assert.equal(steps, 2);
  assert.match(String(output.canonicalContent), /贵阳市大数据产业/);
  assert.doesNotMatch(String(output.canonicalContent), /初稿已完成|风格统一与事实/);
});

test("recovers a missing government body after the generic loop returns only a delivery summary", async () => {
  const summary = [
    "报道已完成交付。以下是最终成果摘要：",
    "| 项目 | 状态 |",
    "| 标题 | 超2500万人已受益 育儿补贴政策落地见效 |",
    "| 篇幅 | 约800字 |"
  ].join("\n");
  const body = `超2500万人已受益 育儿补贴政策落地见效\n\n${"育儿补贴政策加快落地，生育支持体系由制度设计转向惠民实践。".repeat(18)}`;
  const snapshot = {
    goal: { status: "active" }, runtime: { phase: "running" }, pendingQuestion: null,
    plan: [
      { stepId: "specification-confirmation", title: "确认写作规格", status: "pending", result: "" },
      { stepId: "draft", title: "按确认规格撰写初稿", status: "pending", result: "" },
      { stepId: "delivery", title: "交付正文与所需文件", status: "pending", result: "" }
    ]
  };
  let draftSteps = 0;
  const runtime = {
    sessionMachine: { events: [] },
    startAgentLoop: () => undefined,
    advanceAgentLoop: async () => ({
      status: "completed", messages: [{ role: "assistant", content: summary }], pending: null, finalContent: summary
    }),
    getSnapshot: () => ({ runs: [] })
  };
  const service = new ModelChatAgentLoopService({
    executeStep: async () => { draftSteps += 1; return { content: body, toolCalls: [] }; },
    projectEvent: () => undefined,
    runOutline: async (input: { generatedContent: string }) => input,
    runFinalization: async (input: { generatedContent: string }) => input,
    buildResult: (input: { generatedContent: string }) => ({ skillDisclosure: "", canonicalContent: input.generatedContent, result: input })
  } as never);

  const output = await service.run({
    modelInput: { requestId: "summary-without-body" } as ModelChatInput, runtime,
    abortController: new AbortController(), requestMessages: [{ role: "user", content: "800字" }],
    effectiveSystemPrompt: "system", centralSkillNames: ["government-research-writing"], disclosedSkills: [],
    nativeWebSearches: [], writtenArtifacts: [], workspacePath: "C:/workspace", threadId: "thread",
    latestUserRequest: "800字", goalSnapshot: snapshot, reasoningSummaryParts: [],
    emitReasoningSummary: () => undefined, emitStream: () => undefined, publishRetry: () => undefined,
    publishWebSearch: () => undefined, publishActivity: () => undefined, recordTokens: () => undefined,
    setModelCallback: () => undefined, getGoalSnapshot: () => snapshot,
    governmentSpecificationSnapshot: { currentVersionId: "v1", confirmedVersionId: "", currentVersion: { content: { task: "写一篇报道" } } }
  } as never);

  assert.equal(draftSteps, 1);
  assert.match(String(output.canonicalContent), /育儿补贴政策加快落地/);
  assert.doesNotMatch(String(output.canonicalContent), /最终成果摘要/);
});

test("「文字在哪」forces a direct visible draft instead of more tool deliberation", async () => {
  let starts = 0;
  let modelSteps = 0;
  const body = `一、背景\n${"贵阳市大数据产业从资源禀赋出发，探索新质生产力落地路径。".repeat(10)}`;
  const snapshot = {
    goal: { status: "active" }, runtime: { phase: "running" }, pendingQuestion: null,
    plan: [
      { stepId: "specification-confirmation", title: "确认写作规格", status: "completed", result: "confirmed" },
      { stepId: "draft", title: "起草正文", status: "completed", result: "claimed" }
    ]
  };
  const runtime = {
    sessionMachine: { events: [] },
    startAgentLoop: () => { starts += 1; },
    advanceAgentLoop: async () => { throw new Error("generic loop must not start"); },
    getSnapshot: () => ({ runs: [] })
  };
  const service = new ModelChatAgentLoopService({
    executeStep: async () => {
      modelSteps += 1;
      return { content: body, toolCalls: [] };
    },
    projectEvent: () => undefined,
    runOutline: async (input: { generatedContent: string }) => input,
    runFinalization: async (input: { generatedContent: string }) => input,
    buildResult: (input: { generatedContent: string }) => ({ skillDisclosure: "", canonicalContent: input.generatedContent, result: input })
  } as never);

  const output = await service.run({
    modelInput: { requestId: "where-is-text" } as ModelChatInput, runtime,
    abortController: new AbortController(),
    requestMessages: [{ role: "user", content: "文字在哪" }],
    effectiveSystemPrompt: "system", centralSkillNames: ["government-research-writing"], disclosedSkills: [],
    nativeWebSearches: [], writtenArtifacts: [], workspacePath: "C:/workspace", threadId: "thread",
    latestUserRequest: "文字在哪", goalSnapshot: snapshot, reasoningSummaryParts: [],
    emitReasoningSummary: () => undefined, emitStream: () => undefined, publishRetry: () => undefined,
    publishWebSearch: () => undefined, publishActivity: () => undefined, recordTokens: () => undefined,
    setModelCallback: () => undefined, getGoalSnapshot: () => snapshot,
    governmentSpecificationSnapshot: { currentVersionId: "v1", confirmedVersionId: "v1", currentVersion: { content: { task: "案例研究" } } }
  } as never);

  assert.equal(starts, 0);
  assert.equal(modelSteps, 1);
  assert.match(String(output.canonicalContent), /贵阳市大数据产业/);
});

test("delivers and verifies a real PDF through the native runtime within a bounded time", async (t) => {
  const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "newbrain-pdf-delivery-"));
  t.after(() => fs.rm(workspacePath, { recursive: true, force: true }));
  const runtime = await createLocalRuntime({
    runtimeId: "pdf-e2e",
    workspacePath,
    platformLabel: "Windows",
    shellLabel: "PowerShell"
  });
  let exposedTools: Array<{ name?: string }> = [];
  const finalizationModes: Array<boolean> = [];
  const writtenArtifacts: Array<{ path: string; size: number; changeType: "created" | "modified" }> = [];
  const draft = "各位同事，过去一年，我们坚持安全生产底线，持续优化现场管理和设备维护，生产组织更加稳健。面对市场变化，全体员工迎难而上，在质量、效率和协同方面取得积极进展。新的一年，我们将继续压实安全责任，推进智能化建设，强化成本管控和人才培养，以更加务实的作风完成各项目标任务。感谢大家一年来的辛勤付出，让我们凝心聚力、稳中求进，共同推动企业高质量发展。";
  const request = "写一个煤炭企业2025年年终总结发言稿，输出PDF文件";
  const centralSkillNames = shouldAutomaticallyUseGovernmentWriting(request)
    ? ["government-research-writing"]
    : [];
  const service = new ModelChatAgentLoopService({
    executeStep: async ({ tools }: { tools: Array<{ name?: string }> }) => {
      exposedTools = tools;
      return { content: draft, toolCalls: [] };
    },
    projectEvent: (projection: { writtenArtifacts: typeof writtenArtifacts }, event: { type: string; payload: any }) => {
      const artifact = event.payload?.result?.artifact;
      if (event.type === "tool_result" && event.payload?.result?.ok && artifact?.path && artifact?.size
        && !projection.writtenArtifacts.some((item) => item.path === artifact.path)) {
        projection.writtenArtifacts.push({ path: artifact.path, size: artifact.size, changeType: artifact.changeType ?? "created" });
      }
    },
    runOutline: async (input: { generatedContent: string }) => input,
    runFinalization: async (input: { generatedContent: string; deliveryOnly?: boolean }) => {
      finalizationModes.push(input.deliveryOnly === true);
      return input;
    },
    buildResult: (input: { generatedContent: string }) => ({ skillDisclosure: "", canonicalContent: input.generatedContent, result: input })
  } as never);
  const startedAt = Date.now();
  const output = await service.run({
    modelInput: { requestId: "pdf-request", permissionMode: "full" } as ModelChatInput,
    runtime,
    abortController: new AbortController(),
    requestMessages: [{ role: "user", content: request }],
    effectiveSystemPrompt: "system", centralSkillNames, disclosedSkills: [], nativeWebSearches: [], writtenArtifacts,
    workspacePath, threadId: "pdf-thread", latestUserRequest: request,
    goalSnapshot: null, reasoningSummaryParts: [], emitReasoningSummary: () => undefined, emitStream: () => undefined,
    publishRetry: () => undefined, publishWebSearch: () => undefined, publishActivity: () => undefined,
    recordTokens: () => undefined, setModelCallback: () => undefined, getGoalSnapshot: () => ({
      goal: { status: "active" },
      runtime: { phase: "running" },
      pendingQuestion: null,
      plan: [
        { stepId: "draft", title: "Draft", status: "completed", result: "done" },
        { stepId: "delivery", title: "Delivery", status: "completed", result: "ready" }
      ]
    })
  } as never);
  const elapsedMs = Date.now() - startedAt;
  const pdfPath = path.join(workspacePath, requestedArtifactTargetPath(request, "pdf", { government: true }));
  const bytes = await fs.readFile(pdfPath);
  const parser = new PDFParse({ data: bytes });
  const extracted = await parser.getText();
  await parser.destroy();
  assert.ok(elapsedMs < 5_000, `native PDF delivery took ${elapsedMs}ms`);
  assert.deepEqual(exposedTools.map((tool) => tool.name), [],
    "Government-writing models must not receive free-form workspace or shell tools; native delivery remains runtime-owned.");
  assert.equal(bytes.subarray(0, 5).toString("ascii"), "%PDF-");
  assert.match(bytes.subarray(-64).toString("latin1"), /%%EOF/);
  assert.ok(bytes.length > 1_000);
  assert.match(extracted.text, /安全生产/);
  assert.match(extracted.text, /高质量发展/);
  assert.equal(output.writtenArtifacts.some((artifact: { path: string }) => artifact.path.endsWith(".pdf")), true);
  assert.deepEqual(finalizationModes, [false, true]);
  assert.deepEqual(centralSkillNames, ["government-research-writing"]);
});
