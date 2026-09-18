import {
  buildLoopBlockedResult,
  createToolLoopState,
  detectToolCallLoop,
  recordToolCall,
  resolveLoopDetectionConfig,
  shouldEmitLoopWarning
} from "./tool-loop-detection.js";

function parseArguments(value) {
  if (value && typeof value === "object") return value;
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Tool arguments must be an object.");
    return parsed;
  } catch (error) {
    throw new Error(`Invalid tool arguments: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** `null`/`undefined`/non-finite/`<=0` means unlimited (Codex/OpenClaw-aligned). */
export function resolveMaxSteps(value) {
  if (value == null) return Number.POSITIVE_INFINITY;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return Number.POSITIVE_INFINITY;
  return Math.floor(n);
}

function recentToolLoopBlockMessage(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "tool") continue;
    try {
      const parsed = JSON.parse(String(message.content ?? ""));
      if (parsed?.deniedReason === "tool-loop" && parsed?.output) {
        return String(parsed.output);
      }
    } catch {
      // ignore malformed tool payloads
    }
  }
  return "";
}

function toolMessage(call, result) {
  const content = {
    ok: result.ok,
    exitCode: result.exitCode,
    output: result.output ?? "",
    durationMs: result.durationMs
  };
  if (typeof result.deniedReason === "string" && result.deniedReason) {
    content.deniedReason = result.deniedReason;
  }
  if (typeof result.loopWarning === "string" && result.loopWarning) {
    content.loopWarning = result.loopWarning;
  }
  return {
    role: "tool",
    toolCallId: call.id,
    name: call.name,
    content: JSON.stringify(content)
  };
}

function normalizeSteeringAttachments(value) {
  if (!Array.isArray(value)) return [];
  const attachments = [];
  for (const item of value.slice(0, 8)) {
    if (!item || typeof item !== "object") continue;
    const path = typeof item.path === "string" ? item.path.trim() : "";
    if (!path) continue;
    const name = typeof item.name === "string" && item.name.trim()
      ? item.name.trim()
      : path.split(/[\\/]/).pop() || "attachment";
    const url = typeof item.url === "string" ? item.url : "";
    attachments.push(url ? { name, path, url } : { name, path });
  }
  return attachments;
}

export function normalizeSteeringInput(input) {
  if (typeof input === "string") {
    return { content: input.trim(), attachments: [] };
  }
  if (!input || typeof input !== "object") {
    return { content: "", attachments: [] };
  }
  const content = typeof input.content === "string"
    ? input.content.trim()
    : typeof input.message === "string"
      ? input.message.trim()
      : "";
  return {
    content,
    attachments: normalizeSteeringAttachments(input.attachments)
  };
}

function steeringMessage(payload) {
  // Steering supplements the in-flight task; without this boundary a model can
  // misread a short follow-up as a replacement request and abandon active work.
  const normalized = normalizeSteeringInput(payload);
  const body = normalized.content
    || (normalized.attachments.length ? "Please inspect the attached files and incorporate them into the current task." : "");
  const message = {
    role: "user",
    content: [
      "[User guidance for the current active task]",
      body,
      "",
      "Continue the current task. Incorporate this guidance without abandoning or repeating work already completed."
    ].join("\n")
  };
  if (normalized.attachments.length) {
    message.attachments = normalized.attachments;
  }
  return message;
}

export class AgentLoop {
  constructor(input) {
    this.toolRegistry = input.toolRegistry;
    this.toolContext = input.toolContext ?? {};
    this.maxSteps = resolveMaxSteps(input.maxSteps);
    this.requiresApproval = input.requiresApproval ?? ((descriptor) => descriptor.requiresApproval !== false);
    this.authorize = input.authorize ?? ((descriptor, call) => ({
      decision: this.requiresApproval(descriptor, call) ? "ask" : "allow",
      source: "legacy",
      reason: ""
    }));
    this.onEvent = input.onEvent ?? (() => undefined);
    this.abortSignal = input.abortSignal ?? null;
    this.allowedToolNames = input.allowedToolNames == null ? null : new Set(input.allowedToolNames);
    this.loopDetection = resolveLoopDetectionConfig(input.loopDetection);
    /** Codex-like stall abort: consecutive tool steps with zero ok=true results. */
    this.noProgressStepLimit = Math.max(2, Number(input.noProgressStepLimit) || 4);
    this.reset();
  }

  reset() {
    this.status = "idle";
    this.messages = [];
    this.pending = null;
    this.steps = 0;
    this.finalContent = "";
    this.pendingSteering = [];
    this.toolLoopState = createToolLoopState();
    this.consecutiveNoProgressSteps = 0;
    this.stepMadeProgress = false;
  }

  steer(input) {
    const payload = normalizeSteeringInput(input);
    if (!payload.content && !payload.attachments.length) {
      throw new Error("A steering message or attachment is required.");
    }
    if (this.status !== "running" && this.status !== "awaiting-approval") {
      throw new Error(`Agent loop cannot be steered from ${this.status}.`);
    }
    this.pendingSteering.push(payload);
    this.onEvent({
      type: "agent_loop_steered",
      payload: {
        queuedMessages: this.pendingSteering.length,
        attachmentCount: payload.attachments.length
      }
    });
    return this.snapshot();
  }

  drainSteering() {
    if (!this.pendingSteering.length) return;
    for (const payload of this.pendingSteering.splice(0)) {
      this.messages.push(steeringMessage(payload));
    }
  }

  assertNotCancelled() {
    if (this.abortSignal?.aborted || this.status === "failed") {
      this.status = "failed";
      this.pending = null;
      throw new Error("Agent loop was cancelled.");
    }
  }

  start(messages) {
    if (this.status === "running" || this.status === "awaiting-approval") {
      throw new Error("Agent loop is already active.");
    }
    this.reset();
    this.messages = structuredClone(messages);
    this.status = "running";
    this.onEvent({ type: "agent_loop_started", payload: { messageCount: this.messages.length } });
    return this.snapshot();
  }

  snapshot() {
    const pending = this.pending ? {
      call: structuredClone(this.pending.call),
      remainingCalls: structuredClone(this.pending.remainingCalls ?? []),
      descriptor: {
        name: this.pending.descriptor.name,
        title: this.pending.descriptor.title,
        description: this.pending.descriptor.description,
        kind: this.pending.descriptor.kind,
        risk: this.pending.descriptor.risk,
        requiresApproval: this.pending.descriptor.requiresApproval,
        inputSchema: structuredClone(this.pending.descriptor.inputSchema)
      }
    } : null;
    return {
      status: this.status,
      steps: this.steps,
      messages: structuredClone(this.messages),
      pending,
      finalContent: this.finalContent
    };
  }

  restore(snapshot) {
    if (!snapshot || !["running", "awaiting-approval", "completed", "failed"].includes(snapshot.status)) {
      throw new Error("Invalid agent loop checkpoint.");
    }
    this.messages = structuredClone(Array.isArray(snapshot.messages) ? snapshot.messages : []);
    this.steps = Math.max(0, Number(snapshot.steps) || 0);
    this.finalContent = String(snapshot.finalContent || "");
    this.status = snapshot.status;
    this.pending = null;
    this.pendingSteering = [];
    this.toolLoopState = createToolLoopState();
    if (snapshot.status === "awaiting-approval") {
      const call = snapshot.pending?.call;
      const descriptor = call?.name ? this.toolRegistry.get(call.name) : null;
      if (!call || !descriptor) throw new Error("Agent loop checkpoint references an unavailable pending tool.");
      this.pending = {
        descriptor,
        call: structuredClone(call),
        remainingCalls: structuredClone(snapshot.pending?.remainingCalls ?? [])
      };
    }
    this.onEvent({ type: "agent_loop_restored", payload: { status: this.status, step: this.steps } });
    return this.snapshot();
  }

  toolDefinitions() {
    return this.toolRegistry.list().filter((tool) =>
      this.allowedToolNames == null || this.allowedToolNames.has(tool.name)
    ).map((tool) => ({
      type: "function",
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
      strict: true
    }));
  }

  recordToolOutcome(call, result) {
    this.messages.push(toolMessage(call, result));
    this.onEvent({ type: "tool_result", payload: { callId: call.id, name: call.name, result } });
    if (result?.deniedReason === "tool-loop") {
      this.stepMadeProgress = true;
    }
    return result;
  }

  async processToolCalls(calls) {
    for (let index = 0; index < calls.length; index += 1) {
      const rawCall = calls[index];
      if (this.allowedToolNames != null && !this.allowedToolNames.has(rawCall.name)) {
        this.messages.push(toolMessage(rawCall, { ok: false, output: `Tool is disabled for this task: ${rawCall.name}` }));
        this.onEvent({ type: "tool_denied", payload: { call: rawCall, authorization: { decision: "deny", source: "task-tool-allowlist" } } });
        continue;
      }
      const descriptor = this.toolRegistry.get(rawCall.name);
      if (!descriptor) {
        this.messages.push(toolMessage(rawCall, { ok: false, output: `Unknown tool: ${rawCall.name}` }));
        continue;
      }
      let args;
      try {
        args = parseArguments(rawCall.arguments);
      } catch (error) {
        this.messages.push(toolMessage(rawCall, { ok: false, output: error.message }));
        continue;
      }
      if (rawCall.name === "shell.exec" && !String(args.command ?? "").trim()) {
        this.messages.push(toolMessage({ id: rawCall.id, name: rawCall.name, arguments: args }, {
          ok: false,
          exitCode: 1,
          output: "Shell command cannot be empty. Provide a non-empty command argument."
        }));
        this.onEvent({ type: "tool_invalid", payload: { call: rawCall, reason: "empty_command" } });
        continue;
      }
      const call = { id: rawCall.id, name: rawCall.name, arguments: args };
      this.onEvent({ type: "tool_call", payload: call });
      const authorization = await this.authorize(descriptor, call);
      this.onEvent({ type: "policy_decision", payload: { call, authorization } });
      if (authorization.decision === "deny") {
        const result = { ok: false, output: authorization.reason || "工具调用被安全策略拒绝。" };
        this.onEvent({ type: "tool_denied", payload: { call, authorization } });
        this.recordToolOutcome(call, result);
        continue;
      }
      if (authorization.decision === "ask") {
        this.assertNotCancelled();
        this.pending = {
          descriptor,
          call,
          remainingCalls: structuredClone(calls.slice(index + 1)),
          authorization
        };
        this.status = "awaiting-approval";
        this.onEvent({
          type: "approval_requested",
          payload: {
            call,
            risk: descriptor.risk,
            authorization: {
              decision: authorization.decision,
              source: authorization.source,
              ruleId: authorization.ruleId,
              reason: authorization.reason
            }
          }
        });
        return true;
      }
      this.assertNotCancelled();
      const loopGuard = this.evaluateToolLoop(call);
      if (loopGuard?.block) {
        this.onEvent({ type: "tool_loop_blocked", payload: { call, loop: loopGuard.loop } });
        recordToolCall(this.toolLoopState, call.name, call.arguments, loopGuard.result, this.loopDetection);
        this.recordToolOutcome(call, loopGuard.result);
        continue;
      }
      await this.execute(call, loopGuard?.warningMessage);
      this.assertNotCancelled();
    }
    return false;
  }

  evaluateToolLoop(call) {
    const loop = detectToolCallLoop(this.toolLoopState, call.name, call.arguments, this.loopDetection);
    if (!loop.stuck) return null;
    if (loop.level === "critical") {
      return {
        block: true,
        loop,
        result: buildLoopBlockedResult(loop.message)
      };
    }
    const warningKey = loop.warningKey ?? `${loop.detector}:${call.name}`;
    if (shouldEmitLoopWarning(this.toolLoopState, warningKey, loop.count)) {
      this.onEvent({ type: "tool_loop_warning", payload: { call, loop } });
      return { block: false, loop, warningMessage: loop.message };
    }
    return { block: false, loop };
  }

  async advance(callModel) {
    if (this.status !== "running") throw new Error(`Agent loop cannot advance from ${this.status}.`);
    while (this.steps < this.maxSteps) {
      this.assertNotCancelled();
      this.drainSteering();
      this.steps += 1;
      let response;
      try {
        response = await callModel({
          messages: structuredClone(this.messages),
          tools: this.toolDefinitions(),
          step: this.steps
        });
      } catch (error) {
        this.steps -= 1;
        this.status = "running";
        this.onEvent({ type: "model_error", payload: { message: error instanceof Error ? error.message : String(error) } });
        throw error;
      }
      const calls = Array.isArray(response.toolCalls) ? response.toolCalls : [];
      // Thinking-mode providers (DeepSeek / Kimi / Qwen …) require the prior
      // assistant reasoning_content to be echoed on the next request after tools.
      const providerReasoningContent = typeof response.providerReasoningContent === "string"
        ? response.providerReasoningContent.trim()
        : "";
      this.messages.push({
        role: "assistant",
        content: response.content ?? "",
        ...(providerReasoningContent ? { providerReasoningContent } : {}),
        toolCalls: structuredClone(calls)
      });
      this.onEvent({ type: "model_response", payload: { step: this.steps, toolCallCount: calls.length } });
      if (!calls.length) {
        if (this.pendingSteering.length) continue;
        this.status = "completed";
        this.finalContent = String(response.content ?? "");
        this.onEvent({ type: "agent_loop_completed", payload: { step: this.steps } });
        return this.snapshot();
      }
      this.stepMadeProgress = false;
      if (await this.processToolCalls(calls)) return this.snapshot();
      if (this.stepMadeProgress) {
        this.consecutiveNoProgressSteps = 0;
      } else {
        this.consecutiveNoProgressSteps += 1;
        this.onEvent({
          type: "agent_loop_no_progress",
          payload: {
            step: this.steps,
            consecutiveNoProgressSteps: this.consecutiveNoProgressSteps,
            limit: this.noProgressStepLimit
          }
        });
        if (this.consecutiveNoProgressSteps >= this.noProgressStepLimit) {
          this.status = "failed";
          this.onEvent({
            type: "agent_loop_failed",
            payload: {
              reason: "no_progress",
              consecutiveNoProgressSteps: this.consecutiveNoProgressSteps,
              steps: this.steps
            }
          });
          {
            const loopBlockMessage = recentToolLoopBlockMessage(this.messages);
            throw new Error(
              loopBlockMessage
                ? `Agent loop stalled: ${loopBlockMessage}`
                : `Agent loop stalled: no tool progress across ${this.consecutiveNoProgressSteps} consecutive steps.`
            );
          }
        }
      }
    }
    this.status = "failed";
    this.onEvent({ type: "agent_loop_failed", payload: { reason: "max_steps", maxSteps: this.maxSteps } });
    throw new Error(`Agent loop exceeded ${this.maxSteps} model steps.`);
  }

  async execute(call, loopWarningMessage) {
    this.assertNotCancelled();
    let result = await this.toolRegistry.invoke(call.name, call.arguments, this.toolContext);
    if (result?.ok === true) this.stepMadeProgress = true;
    if (loopWarningMessage) {
      const baseOutput = String(result?.output ?? "");
      result = {
        ...result,
        loopWarning: loopWarningMessage,
        output: baseOutput
          ? `${baseOutput}\n\n[tool-loop-warning] ${loopWarningMessage}`
          : `[tool-loop-warning] ${loopWarningMessage}`
      };
    }
    this.recordToolOutcome(call, result);
    recordToolCall(this.toolLoopState, call.name, call.arguments, result, this.loopDetection);
    this.assertNotCancelled();
    return result;
  }

  async resumeApproval(approved, callModel) {
    this.assertNotCancelled();
    if (this.status !== "awaiting-approval" || !this.pending) {
      throw new Error("No tool call is awaiting approval.");
    }
    const { call, remainingCalls = [] } = this.pending;
    this.pending = null;
    if (approved) {
      this.assertNotCancelled();
      this.onEvent({ type: "approval_resolved", payload: { call, approved: true } });
      const loopGuard = this.evaluateToolLoop(call);
      if (loopGuard?.block) {
        this.onEvent({ type: "tool_loop_blocked", payload: { call, loop: loopGuard.loop } });
        recordToolCall(this.toolLoopState, call.name, call.arguments, loopGuard.result, this.loopDetection);
        this.recordToolOutcome(call, loopGuard.result);
      } else {
        await this.execute(call, loopGuard?.warningMessage);
      }
    } else {
      const result = { ok: false, output: "The user denied this tool call." };
      this.onEvent({ type: "approval_denied", payload: { call } });
      this.recordToolOutcome(call, result);
    }
    this.status = "running";
    if (await this.processToolCalls(remainingCalls)) return this.snapshot();
    return this.advance(callModel);
  }

  cancel(reason = "Agent loop was cancelled.") {
    this.pending = null;
    this.status = "failed";
    this.finalContent = reason;
    this.onEvent({ type: "agent_loop_cancelled", payload: { reason } });
    return this.snapshot();
  }
}
