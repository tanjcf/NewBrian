import type { BrainFlowDefinition, BrainFlowNode } from "@codex-forge/protocol";
export type FlowNode = BrainFlowNode;
export type FlowDefinition = BrainFlowDefinition;
export interface FlowAuditEvent {
  nodeId: string;
  nodeType: FlowNode["type"];
  attempt: number;
  status: "STARTED" | "SUCCEEDED" | "FAILED" | "WAITING" | "DECLINED";
  detail?: string;
}
export interface FlowContext { values: Record<string, unknown>; audit: FlowAuditEvent[]; signal?: AbortSignal }
export interface FlowRuntimeOptions {
  tools?: Record<string, (input: unknown, context: FlowContext) => Promise<unknown> | unknown>;
  approve?: (node: Extract<FlowNode, { type: "approval" }>, context: FlowContext) => Promise<boolean> | boolean;
  onAudit?: (event: FlowAuditEvent, context: FlowContext) => Promise<void> | void;
  signal?: AbortSignal;
}

const ID = /^[A-Za-z0-9._:-]{1,120}$/u;
const CONDITION_OPERATORS = new Set(["truthy", "equals", "notEquals", "exists", "greaterThan", "lessThan", "contains"]);

export function validateFlowDefinition(definition: FlowDefinition): void {
  if (definition?.schemaVersion !== 1 || !Array.isArray(definition.nodes) || !definition.nodes.length) throw new Error("FLOW_DEFINITION_INVALID");
  const ids = new Set<string>();
  for (const node of definition.nodes) {
    if (!ID.test(node.id) || ids.has(node.id)) throw new Error("FLOW_NODE_ID_INVALID");
    ids.add(node.id);
    if (node.type === "tool") {
      if (!ID.test(node.tool)) throw new Error("FLOW_TOOL_INVALID");
      if (node.maxAttempts !== undefined && (!Number.isInteger(node.maxAttempts) || node.maxAttempts < 1 || node.maxAttempts > 5)) throw new Error("FLOW_RETRY_LIMIT_INVALID");
    }
    if (node.type === "condition") {
      const operator = node.operator ?? "truthy";
      if (!ID.test(node.valueKey) || !CONDITION_OPERATORS.has(operator)) throw new Error("FLOW_CONDITION_INVALID");
      if (!["truthy", "exists"].includes(operator) && node.expected === undefined) throw new Error("FLOW_CONDITION_EXPECTED_REQUIRED");
      if (["greaterThan", "lessThan"].includes(operator) && (typeof node.expected !== "number" || !Number.isFinite(node.expected))) throw new Error("FLOW_CONDITION_NUMBER_REQUIRED");
    }
    if (node.type === "assign") {
      if (!ID.test(node.targetKey) || (node.valueKey !== undefined && !ID.test(node.valueKey))) throw new Error("FLOW_ASSIGN_INVALID");
      if (node.valueKey === undefined && node.value === undefined) throw new Error("FLOW_ASSIGN_VALUE_REQUIRED");
    }
    if (node.type === "aggregate") {
      if (!ID.test(node.targetKey) || !node.sources || typeof node.sources !== "object" || Array.isArray(node.sources) || Object.keys(node.sources).length === 0 || Object.keys(node.sources).length > 100) throw new Error("FLOW_AGGREGATE_INVALID");
      for (const [target, source] of Object.entries(node.sources)) if (!ID.test(target) || !ID.test(source)) throw new Error("FLOW_AGGREGATE_INVALID");
    }
  }
  if (definition.nodes.filter((node) => node.type === "start").length !== 1) throw new Error("FLOW_START_INVALID");
  const targets = definition.nodes.flatMap((node) => node.type === "condition" ? [node.onTrue, node.onFalse] : node.next ? [node.next] : []);
  if (targets.some((target) => !ids.has(target))) throw new Error("FLOW_EDGE_TARGET_NOT_FOUND");
}

export async function runFlow(definition: FlowDefinition, options: FlowRuntimeOptions = {}, initialValues: Record<string, unknown> = {}) {
  validateFlowDefinition(definition);
  const nodes = new Map(definition.nodes.map((node) => [node.id, node]));
  const context: FlowContext = { values: { ...initialValues }, audit: [], signal: options.signal };
  const maxSteps = Math.min(1_000, Math.max(1, Math.floor(definition.maxSteps ?? 100)));
  let current: FlowNode | undefined = definition.nodes.find((node) => node.type === "start");
  const record = async (auditEvent: FlowAuditEvent) => { context.audit.push(auditEvent); await options.onAudit?.(auditEvent, context); };
  for (let step = 0; current; step += 1) {
    if (options.signal?.aborted) throw new Error(options.signal.reason instanceof Error ? options.signal.reason.message : String(options.signal.reason || "BRAIN_FLOW_CANCELLED"));
    if (step >= maxSteps) throw new Error("FLOW_STEP_LIMIT_EXCEEDED");
    if (current.type === "end") { await record(event(current, 1, "SUCCEEDED")); return { status: "SUCCEEDED" as const, context }; }
    if (current.type === "start") { await record(event(current, 1, "SUCCEEDED")); current = current.next ? nodes.get(current.next) : undefined; continue; }
    if (current.type === "condition") {
      const result = evaluateCondition(context.values, current);
      await record(event(current, 1, "SUCCEEDED", String(result)));
      current = nodes.get(result ? current.onTrue : current.onFalse);
      continue;
    }
    if (current.type === "assign") {
      context.values[current.targetKey] = current.valueKey !== undefined ? context.values[current.valueKey] : current.value;
      await record(event(current, 1, "SUCCEEDED", current.targetKey));
      current = current.next ? nodes.get(current.next) : undefined;
      continue;
    }
    if (current.type === "aggregate") {
      context.values[current.targetKey] = Object.fromEntries(Object.entries(current.sources).map(([target, source]) => [target, context.values[source]]));
      await record(event(current, 1, "SUCCEEDED", current.targetKey));
      current = current.next ? nodes.get(current.next) : undefined;
      continue;
    }
    if (current.type === "approval") {
      await record(event(current, 1, "WAITING"));
      if (!options.approve || !(await options.approve(current, context))) {
        await record(event(current, 1, "DECLINED", "FLOW_APPROVAL_DECLINED"));
        return { status: "DECLINED" as const, context };
      }
      await record(event(current, 1, "SUCCEEDED"));
      current = nodes.get(current.next);
      continue;
    }
    const tool = options.tools?.[current.tool];
    if (!tool) throw new Error("FLOW_TOOL_NOT_REGISTERED");
    const attempts = current.maxAttempts ?? 1;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      await record(event(current, attempt, "STARTED"));
      try {
        context.values[current.id] = await tool(current.input, context);
        await record(event(current, attempt, "SUCCEEDED"));
        break;
      } catch (error) {
        await record(event(current, attempt, "FAILED", error instanceof Error ? error.message : String(error)));
        if (attempt === attempts) throw error;
      }
    }
    current = current.next ? nodes.get(current.next) : undefined;
  }
  return { status: "SUCCEEDED" as const, context };
}

function evaluateCondition(values: Record<string, unknown>, node: Extract<FlowNode, { type: "condition" }>): boolean {
  const actual = values[node.valueKey];
  switch (node.operator ?? "truthy") {
    case "equals": return Object.is(actual, node.expected);
    case "notEquals": return !Object.is(actual, node.expected);
    case "exists": return Object.prototype.hasOwnProperty.call(values, node.valueKey) && actual !== undefined;
    case "greaterThan": return typeof actual === "number" && Number.isFinite(actual) && actual > (node.expected as number);
    case "lessThan": return typeof actual === "number" && Number.isFinite(actual) && actual < (node.expected as number);
    case "contains": return typeof actual === "string" && typeof node.expected === "string"
      ? actual.includes(node.expected)
      : Array.isArray(actual) && actual.some((item) => Object.is(item, node.expected));
    default: return Boolean(actual);
  }
}

function event(node: FlowNode, attempt: number, status: FlowAuditEvent["status"], detail?: string): FlowAuditEvent {
  return { nodeId: node.id, nodeType: node.type, attempt, status, ...(detail ? { detail } : {}) };
}
