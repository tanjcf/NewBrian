import type { FlowAuditEvent, FlowContext, FlowNode } from "./flow-runtime.ts";
import { runFlow, validateFlowDefinition } from "./flow-runtime.ts";
import type { BrainFlowRunRecord, BrainWorkspaceStorage } from "./brain-workspace-storage.ts";

export interface RegisteredFlowTool {
  execute(input: unknown, context: FlowContext, binding: { ownerId: string; projectId: string; flowId: string; runId: string; signal: AbortSignal }): Promise<unknown> | unknown;
}

export class FlowExecutionService {
  private readonly controllers = new Map<string, AbortController>();
  private readonly options: {
    storage: BrainWorkspaceStorage;
    tools: Record<string, RegisteredFlowTool>;
    confirmApproval: (input: { ownerId: string; projectId: string; flowId: string; runId: string; node: Extract<FlowNode, { type: "approval" }> }) => Promise<boolean> | boolean;
  };

  constructor(options: FlowExecutionService["options"]) { this.options = options; }

  async start(ownerId: string, input: { flowId: string; values?: Record<string, unknown> }): Promise<BrainFlowRunRecord> {
    const flow = this.options.storage.getFlow(ownerId, input.flowId);
    validateFlowDefinition(flow.definition);
    const run = this.options.storage.createFlowRun({ ownerId, flowId: flow.id, values: input.values });
    this.options.storage.checkpointFlowRun({ ownerId, runId: run.id, status: "RUNNING" });
    const controller = new AbortController();
    this.controllers.set(run.id, controller);
    const binding = { ownerId, projectId: flow.projectId, flowId: flow.id, runId: run.id, signal: controller.signal };
    const tools = Object.fromEntries(Object.entries(this.options.tools).map(([name, tool]) => [name, (value: unknown, context: FlowContext) => tool.execute(value, context, binding)]));
    try {
      const result = await runFlow(flow.definition, {
        tools,
        approve: (node) => this.options.confirmApproval({ ownerId, projectId: flow.projectId, flowId: flow.id, runId: run.id, node }),
        onAudit: (event, context) => this.checkpoint(ownerId, run.id, event, context)
        ,signal: controller.signal
      }, input.values);
      return this.options.storage.checkpointFlowRun({ ownerId, runId: run.id, status: result.status === "DECLINED" ? "DECLINED" : "SUCCEEDED", values: result.context.values, audit: result.context.audit, errorCode: result.status === "DECLINED" ? "BRAIN_FLOW_APPROVAL_DECLINED" : "" });
    } catch (error) {
      const current = this.options.storage.getFlowRun(ownerId, run.id);
      const errorCode = error instanceof Error ? error.message : "BRAIN_FLOW_FAILED";
      return this.options.storage.checkpointFlowRun({ ownerId, runId: run.id, status: "FAILED", values: current.values, audit: current.audit, errorCode });
    } finally {
      this.controllers.delete(run.id);
    }
  }

  get(ownerId: string, runId: string) { return this.options.storage.getFlowRun(ownerId, runId); }

  cancel(ownerId: string, runId: string) {
    const run = this.options.storage.getFlowRun(ownerId, runId);
    const controller = this.controllers.get(run.id);
    if (controller) controller.abort(new Error("BRAIN_FLOW_CANCELLED"));
    return controller ? this.options.storage.checkpointFlowRun({ ownerId, runId, status: "RUNNING", errorCode: "BRAIN_FLOW_CANCEL_REQUESTED" }) : run;
  }

  private checkpoint(ownerId: string, runId: string, event: FlowAuditEvent, context: FlowContext) {
    const status = event.status === "WAITING" ? "WAITING_APPROVAL" : event.status === "DECLINED" ? "DECLINED" : "RUNNING";
    this.options.storage.checkpointFlowRun({ ownerId, runId, status, currentNodeId: event.nodeId, values: context.values, audit: context.audit, errorCode: event.status === "FAILED" ? event.detail || "BRAIN_FLOW_NODE_FAILED" : "" });
  }
}
