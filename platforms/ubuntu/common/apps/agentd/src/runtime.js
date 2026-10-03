import { promises as fs } from "node:fs";
import path from "node:path";
import { createSessionMachine } from "@codex-forge/protocol/session-machine";
import { AgentLoop } from "./agent-loop.js";
import { MemoryIndex } from "./memory-index.js";
import { MultiAgentOrchestrator } from "./multi-agent-orchestrator.js";
import { PolicyEngine } from "./policy-engine.js";
import { SkillRegistry, defaultSkillRoots } from "./skill-registry.js";
import { createBuiltinCapabilityCatalog, createBuiltinCapabilityRuntime, createBuiltinToolRegistry } from "./tool-registry.js";
import { UserShadow } from "./user-shadow.js";
import { updateCompanionMemoryFromExchange } from "./companion-memory.js";
import { createCapabilitySystem, restoreCapabilitySystem } from "./capability-system.js";
import {
  emptyDeliveryPreferences,
  parseDeliveryPreferences
} from "./delivery-preferences.js";
import { extractDeliveryPreferenceUpdate } from "./delivery-preference-extract.js";

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function clone(value) {
  return structuredClone(value);
}

function withinWorkspace(workspacePath, targetPath) {
  const workspace = path.resolve(workspacePath);
  const target = path.resolve(targetPath);
  return target === workspace || target.startsWith(`${workspace}${path.sep}`);
}

function buildPatchPreview(originalText, nextText) {
  const originalLines = originalText.split(/\r?\n/);
  const nextLines = nextText.split(/\r?\n/);
  const preview = [];
  const maxLines = Math.max(originalLines.length, nextLines.length);

  for (let index = 0; index < maxLines && preview.length < 16; index += 1) {
    const before = originalLines[index];
    const after = nextLines[index];

    if (before === after) {
      continue;
    }

    if (typeof before === "string") {
      preview.push(`- ${before}`);
    }

    if (typeof after === "string") {
      preview.push(`+ ${after}`);
    }
  }

  return preview.length > 0 ? preview : ["+ File contents changed"];
}

export class LocalAgentRuntime {
  constructor(input) {
    this.runtimeId = input.runtimeId;
    this.workspacePath = path.resolve(input.workspacePath);
    this.platformLabel = input.platformLabel;
    this.shellLabel = input.shellLabel;
    this.shellEnv = { ...(process.env ?? {}), ...(input.shellEnv ?? {}) };
    this.toolRegistry = input.toolRegistry ?? createBuiltinToolRegistry();
    this.capabilitySystem = input.capabilitySystem ?? (!input.capabilityRuntime && !input.capabilityResolver ? createCapabilitySystem({ toolRegistry: this.toolRegistry, catalog: input.capabilityCatalog, dataRoot: input.capabilityDataRoot, platform: "ubuntu", onEvent: (event) => this.recordCapabilityEvent(event) }) : null);
    this.capabilityRuntime = input.capabilityRuntime ?? this.capabilitySystem?.capabilityRuntime ?? createBuiltinCapabilityRuntime(this.toolRegistry);
    this.capabilityCatalog = input.capabilityCatalog ?? this.capabilitySystem?.capabilityCatalog ?? createBuiltinCapabilityCatalog(this.toolRegistry);
    this.capabilityResolver = input.capabilityResolver ?? this.capabilitySystem?.resolver ?? null;
    this.capabilitySystemRestored = false;
    this.preflightedCapabilityIntents = new Set();
    this.policyEngine = input.policyEngine ?? new PolicyEngine({ rules: input.policyRules ?? [] });
    this.memoryIndex = new MemoryIndex({ maxRecords: input.maxMemoryRecords ?? 100 });
    this.threadDeliveryPreferences = emptyDeliveryPreferences();
    this.projectDeliveryPreferences = emptyDeliveryPreferences();
    this.turnDeliveryPreferences = null;
    this.userShadow = new UserShadow({ workspacePath: this.workspacePath });
    this.configuredSkillRoots = Array.isArray(input.skillRoots) ? input.skillRoots : null;
    this.skillRegistry = new SkillRegistry({
      roots: this.configuredSkillRoots ?? defaultSkillRoots(this.workspacePath)
    });
    this.agentLoop = null;
    this.orchestrator = new MultiAgentOrchestrator({
      maxConcurrency: input.maxAgentConcurrency ?? 3,
      onEvent: (event) => {
        this.sessionMachine.events.push({
          id: makeId("agent-event"),
          type: event.type,
          timestamp: event.timestamp,
          payload: event.payload
        });
        this.refreshDelegatedTasks();
      }
    });
    this.sessionMachine = createSessionMachine({ runtimeId: input.runtimeId });
    this.sessionMachine.snapshot.session = {
      ...this.sessionMachine.snapshot.session,
      title: `Phase 1 ${this.platformLabel} local coding agent`,
      workspacePath: this.workspacePath
    };
    this.sessionMachine.snapshot.workspace = [];
    this.sessionMachine.snapshot.messages = [
      {
        id: makeId("msg"),
        role: "system",
        content: `Runtime booted and waiting for a workspace-bound task in ${this.workspacePath}.`,
        createdAt: new Date().toISOString()
      }
    ];
    this.sessionMachine.snapshot.runs = [];
    this.pendingApprovalAction = null;
    this.pendingPatchState = null;
  }

  createSystemMessage() {
    return {
      id: makeId("msg"),
      role: "system",
      content: `Runtime booted and waiting for a workspace-bound task in ${this.workspacePath}.`,
      createdAt: new Date().toISOString()
    };
  }

  resetSnapshotState() {
    this.sessionMachine.snapshot.session = {
      ...this.sessionMachine.snapshot.session,
      title: `Phase 1 ${this.platformLabel} local coding agent`,
      workspacePath: this.workspacePath,
      status: "idle"
    };
    this.sessionMachine.snapshot.pendingTool = undefined;
    this.sessionMachine.snapshot.approval = undefined;
    this.sessionMachine.snapshot.patch = undefined;
    this.sessionMachine.snapshot.runs = [];
  }

  async initialize() {
    this.resetSnapshotState();
    if (this.capabilitySystem && !this.capabilitySystemRestored) { await restoreCapabilitySystem(this.capabilitySystem); this.capabilitySystemRestored = true; }
    await this.userShadow.ensureProjectSkill();
    await this.skillRegistry.discover();
    const scan = await this.invokeTool("workspace.scan", {});
    if (!scan.ok) throw new Error(scan.output || "Workspace scan failed.");
    this.sessionMachine.snapshot.workspace = scan.workspace ?? [];
    if (!Array.isArray(this.sessionMachine.snapshot.messages) || this.sessionMachine.snapshot.messages.length === 0) {
      this.sessionMachine.snapshot.messages = [this.createSystemMessage()];
    }
  }

  recordCapabilityEvent(event) {
    if (!this.sessionMachine) return;
    this.sessionMachine.events.push({ id: makeId("capability-event"), type: event.type, timestamp: new Date().toISOString(), payload: clone(event) });
  }

  async prepareCapabilities(messages, options = {}) {
    if (!this.capabilityResolver?.resolveForIntent) return [];
    const latest = [...(messages || [])].reverse().find((message) => message?.role === "user" && String(message.content || "").trim());
    const intent = String(latest?.content || "").trim();
    if (!intent || (this.preflightedCapabilityIntents.has(intent) && options.force !== true)) return [];
    this.preflightedCapabilityIntents.add(intent);
    return this.capabilityResolver.resolveForIntent(intent, { platform: "ubuntu", runtimeVersion: "0.1.0", approved: options.approved === true });
  }

  getSnapshot() {
    return clone(this.sessionMachine.snapshot);
  }

  getToolDescriptors() {
    return this.toolRegistry.list();
  }

  registerExternalTool(definition, execute) {
    if (typeof execute !== "function") throw new Error("External tools require an execute callback.");
    this.toolRegistry.register({
      ...definition,
      title: definition.title || definition.name,
      description: definition.description || "",
      kind: definition.kind || "read",
      risk: definition.risk || "medium",
      requiresApproval: definition.requiresApproval !== false,
      inputSchema: definition.inputSchema || { type: "object", properties: {} },
      external: true,
      namespace: definition.namespace || "external",
      execute
    }, { replace: true });
    return this.toolRegistry.get(definition.name);
  }

  unregisterExternalTools(namespace) {
    return this.toolRegistry.unregisterWhere((tool) => tool.external && (!namespace || tool.namespace === namespace));
  }

  getSkillDescriptors() {
    return this.skillRegistry.list();
  }

  matchSkills(prompt) {
    const matches = this.skillRegistry.match(prompt);
    const projectSkill = this.skillRegistry.get(this.userShadow.skillName);
    if (projectSkill && !matches.some((skill) => skill.name === projectSkill.name)) {
      return [projectSkill, ...matches];
    }
    return matches;
  }

  loadSkill(name) {
    return this.skillRegistry.load(name);
  }

  async addSkillRoots(roots) {
    const nextRoots = [...new Set([...this.skillRegistry.roots, ...roots.map((root) => path.resolve(root))])];
    this.skillRegistry = new SkillRegistry({ roots: nextRoots });
    return this.skillRegistry.discover();
  }

  async removeSkillRoots(roots) {
    const removing = new Set(roots.map((root) => path.resolve(root)));
    this.skillRegistry = new SkillRegistry({
      roots: this.skillRegistry.roots.filter((root) => !removing.has(path.resolve(root)))
    });
    return this.skillRegistry.discover();
  }

  async invokeTool(name, input, options = {}) {
    let descriptor = this.toolRegistry.get(name);
    if (!descriptor && this.capabilityResolver) {
      const resolution = await this.capabilityResolver.resolve(name, { platform: this.platformLabel, approved: options.approved === true });
      if (resolution.status !== "resolved") throw new Error(resolution.reason || `Capability unavailable: ${name}`);
      descriptor = this.toolRegistry.get(name) || { name, title: name, kind: "read", risk: resolution.capability?.risk || "low", requiresApproval: false, inputSchema: resolution.capability?.inputSchema || { type: "object" } };
    }
    if (!descriptor) throw new Error(`Unknown tool: ${name}`);
    const policy = this.evaluateToolPolicy(descriptor, input, options.permissionMode ?? "full");
    if (policy.decision === "deny") {
      return {
        ok: false,
        toolName: name,
        exitCode: 1,
        output: policy.reason,
        durationMs: 0,
        policy
      };
    }
    const toolContext = {
      workspacePath: this.workspacePath,
      shellEnv: this.shellEnv,
      deliveryPreferences: {
        project: this.projectDeliveryPreferences,
        thread: this.threadDeliveryPreferences,
        turn: this.turnDeliveryPreferences || undefined
      }
    };
    this.projectDeliveryPreferences = await this.userShadow.readDeliveryPreferences().catch(() => emptyDeliveryPreferences());
    toolContext.deliveryPreferences.project = this.projectDeliveryPreferences;
    const capabilityResult = descriptor.external ? null : await this.capabilityRuntime.invoke(name, input, { ...toolContext, approved: true });
    const result = capabilityResult
      ? capabilityResult.status === "completed"
        ? capabilityResult.output
        : { ok: false, exitCode: 1, output: capabilityResult.error?.message || "Capability execution failed.", capabilityResult }
      : await this.toolRegistry.invoke(name, input, toolContext);
    return { ...result, policy };
  }

  setPolicyRules(rules) {
    this.policyEngine.setRules(rules);
    return this.policyEngine.listRules();
  }

  getPolicyRules() {
    return this.policyEngine.listRules();
  }

  evaluateToolPolicy(descriptor, argumentsValue, permissionMode = "approval") {
    const decision = this.policyEngine.evaluate({
      toolName: descriptor.name,
      arguments: argumentsValue,
      descriptor,
      workspacePath: this.workspacePath,
      permissionMode
    });
    this.sessionMachine.events.push({
      id: makeId("policy-event"),
      type: "policy_decision",
      timestamp: new Date().toISOString(),
      payload: {
        toolName: descriptor.name,
        decision: decision.decision,
        source: decision.source,
        ruleId: decision.ruleId,
        reason: decision.reason
      }
    });
    return decision;
  }

  setAgentLoopPermissionMode(mode) {
    if (mode === "full" || mode === "agent" || mode === "approval") {
      this.agentLoopPermissionMode = mode;
    }
  }

  startAgentLoop(messages, options = {}) {
    this.agentLoopPermissionMode = options.permissionMode ?? "approval";
    this.agentLoop = new AgentLoop({
      toolRegistry: this.toolRegistry,
      toolContext: {
        workspacePath: this.workspacePath,
        shellEnv: this.shellEnv,
        deliveryPreferences: {
          project: this.projectDeliveryPreferences,
          thread: this.threadDeliveryPreferences,
          turn: this.turnDeliveryPreferences || undefined
        }
      },
      maxSteps: options.maxSteps,
      authorize: (descriptor, call) => this.evaluateToolPolicy(descriptor, call.arguments, this.agentLoopPermissionMode),
      onEvent: (event) => {
        this.sessionMachine.events.push({
          id: makeId("agent-event"),
          type: event.type,
          timestamp: new Date().toISOString(),
          payload: event.payload
        });
        if (event.type === "tool_result") {
          const result = event.payload.result;
          this.pushRun({
            label: event.payload.name,
            command: result.command ?? event.payload.name,
            status: result.ok ? "completed" : "failed",
            exitCode: result.exitCode,
            output: result.output
          });
          this.pushMessage("tool", result.output || `${event.payload.name} completed.`);
        }
        options.onEvent?.(event);
      }
    });
    const snapshot = this.agentLoop.start(messages);
    this.syncAgentLoopState(snapshot);
    return snapshot;
  }

  async advanceAgentLoop(callModel) {
    if (!this.agentLoop) throw new Error("No agent loop has been started.");
    await this.prepareCapabilities(this.agentLoop.snapshot().messages);
    const snapshot = await this.agentLoop.advance(callModel);
    this.syncAgentLoopState(snapshot);
    return snapshot;
  }

  async resumeAgentApproval(approved, callModel) {
    if (!this.agentLoop) throw new Error("No agent loop has been started.");
    const snapshot = await this.agentLoop.resumeApproval(approved, callModel);
    this.syncAgentLoopState(snapshot);
    return snapshot;
  }

  getAgentLoopSnapshot() {
    return this.agentLoop?.snapshot() ?? null;
  }

  delegateAgentTask(input) {
    const task = this.orchestrator.delegate(input);
    this.refreshDelegatedTasks(input.parentThreadId);
    return task;
  }

  runDelegatedTask(taskId, runner) {
    return this.orchestrator.run(taskId, runner);
  }

  runDelegatedTasks(parentThreadId, runner) {
    return this.orchestrator.runAll(parentThreadId, runner);
  }

  mergeDelegatedResults(parentThreadId, taskIds, merger) {
    return this.orchestrator.merge(parentThreadId, taskIds, merger);
  }

  listDelegatedTasks(parentThreadId) {
    return this.orchestrator.list(parentThreadId);
  }

  restoreDelegatedTasks(tasks) {
    for (const task of tasks) this.orchestrator.restore(task);
    this.refreshDelegatedTasks();
    return this.listDelegatedTasks();
  }

  refreshDelegatedTasks(parentThreadId) {
    this.sessionMachine.snapshot.delegatedTasks = this.orchestrator.list(parentThreadId).map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      owner: task.owner,
      summary: task.summary || task.error,
      parentThreadId: task.parentThreadId,
      childThreadId: task.childThreadId,
      instruction: task.instruction,
      result: task.result
    }));
  }

  syncAgentLoopState(snapshot) {
    if (snapshot.status === "awaiting-approval" && snapshot.pending) {
      const { descriptor, call } = snapshot.pending;
      this.sessionMachine.snapshot.pendingTool = {
        id: call.id,
        kind: descriptor.kind,
        reason: descriptor.description,
        risk: descriptor.risk,
        command: call.name === "shell.exec" ? String(call.arguments.command ?? "") : undefined
      };
      this.sessionMachine.snapshot.approval = {
        id: makeId("approval"),
        toolRequestId: call.id,
        message: `Allow ${descriptor.title} inside the attached workspace?`,
        requiresConfirmation: true
      };
      this.sessionMachine.snapshot.session.status = "awaiting-approval";
      return;
    }
    this.sessionMachine.snapshot.pendingTool = undefined;
    this.sessionMachine.snapshot.approval = undefined;
    this.sessionMachine.snapshot.session.status = snapshot.status === "failed" ? "failed" : snapshot.status === "running" ? "running" : "idle";
    if (snapshot.status === "completed" && snapshot.finalContent) {
      const latest = this.sessionMachine.snapshot.messages.at(-1);
      if (latest?.role !== "assistant" || latest.content !== snapshot.finalContent) {
        this.pushMessage("assistant", snapshot.finalContent);
      }
    }
  }

  setThreadState(input = {}) {
    const nextMessages = Array.isArray(input.messages) && input.messages.length > 0
      ? input.messages
      : [this.createSystemMessage()];
    this.sessionMachine.snapshot.messages = clone(nextMessages);
    this.sessionMachine.snapshot.memories = Array.isArray(input.memories) ? clone(input.memories) : [];
    this.memoryIndex.hydrate(this.sessionMachine.snapshot.memories);
    this.sessionMachine.snapshot.runs = Array.isArray(input.runs) ? clone(input.runs) : [];
    this.sessionMachine.snapshot.timeline = Array.isArray(input.timeline) ? clone(input.timeline) : [];
    this.threadDeliveryPreferences = parseDeliveryPreferences(input.deliveryPreferences);
    this.sessionMachine.snapshot.deliveryPreferences = clone(this.threadDeliveryPreferences);
    this.turnDeliveryPreferences = null;
    this.sessionMachine.snapshot.session.status = "idle";
  }

  exportThreadState() {
    return {
      messages: clone(this.sessionMachine.snapshot.messages),
      memories: clone(this.sessionMachine.snapshot.memories ?? []),
      runs: clone(this.sessionMachine.snapshot.runs ?? []),
      timeline: clone(this.sessionMachine.snapshot.timeline ?? []),
      deliveryPreferences: clone(this.threadDeliveryPreferences)
    };
  }

  searchMemories(query, options) {
    return this.memoryIndex.search(query, options);
  }

  rememberExchange(input) {
    const memory = this.memoryIndex.rememberExchange(input);
    this.sessionMachine.snapshot.memories = this.memoryIndex.list();
    return memory;
  }

  async prepareShadowLearning(user) {
    const earlyUpdate = extractDeliveryPreferenceUpdate({ user, assistant: "" });
    if (earlyUpdate?.clear) this.turnDeliveryPreferences = null;
    else if (earlyUpdate?.values) this.turnDeliveryPreferences = earlyUpdate.values;
    this.projectDeliveryPreferences = await this.userShadow.readDeliveryPreferences().catch(() => emptyDeliveryPreferences());
    const prepared = await this.userShadow.prepareLearningTurn(user, {
      threadDeliveryPreferences: this.threadDeliveryPreferences
    });
    await this.skillRegistry.discover();
    return prepared;
  }

  async rememberExchangeWithShadow(input) {
    const memory = this.rememberExchange(input);
    const shadow = await this.userShadow.absorbExchange({
      ...input,
      threadDeliveryPreferences: this.threadDeliveryPreferences
    });
    if (shadow.threadDeliveryPreferences) {
      this.threadDeliveryPreferences = parseDeliveryPreferences(shadow.threadDeliveryPreferences);
      this.sessionMachine.snapshot.deliveryPreferences = clone(this.threadDeliveryPreferences);
    }
    if (shadow.projectDeliveryPreferences) {
      this.projectDeliveryPreferences = parseDeliveryPreferences(shadow.projectDeliveryPreferences);
    } else {
      this.projectDeliveryPreferences = await this.userShadow.readDeliveryPreferences().catch(() => emptyDeliveryPreferences());
    }
    this.turnDeliveryPreferences = null;
    await updateCompanionMemoryFromExchange(this.skillRegistry.roots, input);
    await this.skillRegistry.discover();
    this.sessionMachine.events.push({
      id: makeId("shadow-event"),
      type: "user_shadow_updated",
      timestamp: new Date().toISOString(),
      payload: shadow
    });
    return { memory, shadow };
  }

  getDeliveryPreferences() {
    return clone(this.threadDeliveryPreferences);
  }

  async getDeliveryPreferenceUiState() {
    return this.userShadow.getDeliveryPreferenceUiState(this.threadDeliveryPreferences);
  }

  async clearDeliveryPreferences(scope = "both") {
    const result = await this.userShadow.clearDocumentStyle(scope, this.threadDeliveryPreferences);
    if (result.threadDeliveryPreferences) {
      this.threadDeliveryPreferences = parseDeliveryPreferences(result.threadDeliveryPreferences);
      this.sessionMachine.snapshot.deliveryPreferences = clone(this.threadDeliveryPreferences);
    }
    if (result.projectDeliveryPreferences) {
      this.projectDeliveryPreferences = parseDeliveryPreferences(result.projectDeliveryPreferences);
    }
    this.turnDeliveryPreferences = null;
    await this.skillRegistry.discover();
    return { ...result, ui: await this.getDeliveryPreferenceUiState() };
  }

  async pinDeliveryPreferencesToProject() {
    const result = await this.userShadow.pinThreadStyleToProject(this.threadDeliveryPreferences);
    if (result.projectDeliveryPreferences) {
      this.projectDeliveryPreferences = parseDeliveryPreferences(result.projectDeliveryPreferences);
    }
    await this.skillRegistry.discover();
    return { ...result, ui: await this.getDeliveryPreferenceUiState() };
  }

  getMemories() {
    return this.memoryIndex.list();
  }

  setShellEnv(nextEnv = {}) {
    this.shellEnv = { ...(process.env ?? {}), ...nextEnv };
  }

  async switchWorkspace(nextWorkspacePath) {
    this.workspacePath = path.resolve(nextWorkspacePath);
    this.userShadow = new UserShadow({ workspacePath: this.workspacePath });
    if (!this.configuredSkillRoots) {
      this.skillRegistry = new SkillRegistry({ roots: defaultSkillRoots(this.workspacePath) });
    }
    this.pendingApprovalAction = null;
    this.pendingPatchState = null;
    this.agentLoop = null;
    this.sessionMachine.snapshot.messages = [this.createSystemMessage()];
    await this.initialize();
    return this.getSnapshot();
  }

  pushMessage(role, content) {
    this.sessionMachine.snapshot.messages.push({
      id: makeId("msg"),
      role,
      content,
      createdAt: new Date().toISOString()
    });
  }

  pushRun(input) {
    const run = {
      id: makeId("run"),
      label: input.label,
      command: input.command,
      status: input.status,
      startedAt: new Date().toISOString(),
      completedAt: input.status === "completed" || input.status === "failed" ? new Date().toISOString() : undefined,
      exitCode: input.exitCode,
      output: input.output
    };
    this.sessionMachine.snapshot.runs = [run, ...this.sessionMachine.snapshot.runs].slice(0, 8);
    return run;
  }

  async queueTool(name, input = {}, options = {}) {
    const descriptor = this.toolRegistry.get(name);
    if (!descriptor) throw new Error(`Unknown tool: ${name}`);
    const command = name === "shell.exec" ? String(input.command ?? "").trim() : undefined;
    if (name === "shell.exec" && !command) throw new Error("Shell command cannot be empty.");

    const permissionMode = options.permissionMode ?? "approval";
    const policy = this.evaluateToolPolicy(descriptor, input, permissionMode);
    const action = async () => {
      const result = await this.invokeTool(name, input, { permissionMode: "full" });
      if (Array.isArray(result.workspace)) this.sessionMachine.snapshot.workspace = result.workspace;
      this.pushRun({
        label: descriptor.title,
        command: result.command ?? command ?? descriptor.name,
        status: result.ok ? "completed" : "failed",
        exitCode: result.exitCode,
        output: result.output
      });
      this.pushMessage(
        "tool",
        result.ok
          ? `${descriptor.title} completed:\n\n${result.output || "Tool finished with no output."}`
          : `${descriptor.title} failed with exit code ${result.exitCode}:\n\n${result.output || "Tool finished with no output."}`
      );
      if (!result.ok) {
        const error = new Error(result.output || `${descriptor.title} failed.`);
        error.toolRunRecorded = true;
        throw error;
      }
    };
    if (policy.decision === "deny") {
      this.sessionMachine.snapshot.session.status = "failed";
      this.pushRun({
        label: descriptor.title,
        command: command ?? descriptor.name,
        status: "failed",
        exitCode: 1,
        output: policy.reason
      });
      this.pushMessage("tool", `Policy denied ${descriptor.title}: ${policy.reason}`);
      return this.getSnapshot();
    }
    if (policy.decision === "allow") {
      this.sessionMachine.snapshot.session.status = "running";
      await action();
      this.sessionMachine.snapshot.session.status = "idle";
      return this.getSnapshot();
    }
    this.pendingApprovalAction = action;

    this.sessionMachine.snapshot.pendingTool = {
      id: makeId("tool"),
      kind: descriptor.kind,
      reason: descriptor.description,
      risk: descriptor.risk,
      command
    };
    this.sessionMachine.snapshot.approval = {
      id: makeId("approval"),
      toolRequestId: this.sessionMachine.snapshot.pendingTool.id,
      message: `Allow ${descriptor.title} inside the attached workspace?`,
      requiresConfirmation: descriptor.requiresApproval !== false
    };
    this.sessionMachine.snapshot.session.status = "awaiting-approval";
    return this.getSnapshot();
  }

  queueWorkspaceScan(options) {
    return this.queueTool("workspace.scan", {}, options);
  }

  queueGitStatus(options) {
    return this.queueTool("git.status", {}, options);
  }

  queueShellCommand(command, options) {
    return this.queueTool("shell.exec", { command }, options);
  }

  async respondToApproval(approved) {
    const action = this.pendingApprovalAction;
    const pendingTool = this.sessionMachine.snapshot.pendingTool;

    this.pendingApprovalAction = null;
    this.sessionMachine.snapshot.pendingTool = undefined;
    this.sessionMachine.snapshot.approval = undefined;

    if (!approved) {
      this.sessionMachine.snapshot.session.status = "idle";
      if (pendingTool) {
        this.pushMessage("tool", `Denied ${pendingTool.kind} request: ${pendingTool.reason}`);
      }
      return this.getSnapshot();
    }

    try {
      this.sessionMachine.snapshot.session.status = "running";
      if (action) {
        await action();
      }
      this.sessionMachine.snapshot.session.status = "idle";
    } catch (error) {
      this.sessionMachine.snapshot.session.status = "failed";
      this.pushMessage(
        "tool",
        `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`
      );
      if (!error?.toolRunRecorded) {
        this.pushRun({
          label: "Tool execution",
          command: pendingTool?.command ?? pendingTool?.kind ?? "unknown",
          status: "failed",
          exitCode: 1
        });
      }
    }

    return this.getSnapshot();
  }

  async generatePatch(input) {
    const relativePath = input.filePath.trim().replaceAll("\\", "/");
    if (!relativePath) {
      throw new Error("File path is required.");
    }

    const absolutePath = path.resolve(this.workspacePath, relativePath);
    if (!withinWorkspace(this.workspacePath, absolutePath)) {
      throw new Error("Target file must stay inside the attached workspace.");
    }
    const [workspaceRealPath, targetRealPath] = await Promise.all([
      fs.realpath(this.workspacePath),
      fs.realpath(absolutePath)
    ]);
    if (!withinWorkspace(workspaceRealPath, targetRealPath)) {
      throw new Error("Target file resolves outside the attached workspace.");
    }

    const originalContent = await fs.readFile(targetRealPath, "utf8");
    if (!originalContent.includes(input.searchText)) {
      throw new Error("Search text was not found in the target file.");
    }

    const nextContent = originalContent.replace(input.searchText, input.replaceText);
    if (nextContent === originalContent) {
      throw new Error("Patch would not change the file contents.");
    }

    const preview = buildPatchPreview(originalContent, nextContent);
    const additionCount = preview.filter((line) => line.startsWith("+ ")).length;
    const deletionCount = preview.filter((line) => line.startsWith("- ")).length;

    this.pendingPatchState = {
      absolutePath: targetRealPath,
      relativePath,
      nextContent
    };

    this.sessionMachine.snapshot.patch = {
      id: makeId("patch"),
      filePath: relativePath,
      summary: `Replace selected text in ${relativePath}`,
      hunks: [
        {
          header: "@@ generated patch @@",
          additions: additionCount,
          deletions: deletionCount,
          preview
        }
      ]
    };
    this.pushMessage("tool", `Generated a patch proposal for ${relativePath}.`);

    return this.getSnapshot();
  }

  async applyPatch() {
    if (!this.pendingPatchState || !this.sessionMachine.snapshot.patch) {
      throw new Error("No patch proposal is waiting to be applied.");
    }

    await fs.writeFile(this.pendingPatchState.absolutePath, this.pendingPatchState.nextContent, "utf8");
    this.pushMessage("tool", `Applied patch to ${this.pendingPatchState.relativePath}.`);
    this.pushRun({
      label: "Apply patch",
      command: this.pendingPatchState.relativePath,
      status: "completed",
      exitCode: 0
    });

    this.pendingPatchState = null;
    this.sessionMachine.snapshot.patch = undefined;
    const scan = await this.invokeTool("workspace.scan", {});
    if (scan.ok) this.sessionMachine.snapshot.workspace = scan.workspace ?? [];
    this.sessionMachine.snapshot.session.status = "idle";

    return this.getSnapshot();
  }
}

export async function createLocalRuntime(input) {
  const runtime = new LocalAgentRuntime(input);
  await runtime.initialize();
  return runtime;
}
