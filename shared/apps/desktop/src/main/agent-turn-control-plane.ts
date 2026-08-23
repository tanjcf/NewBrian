/**
 * Hybrid Mode A: desktop HTTP client for spring-app Agent Turn v1 APIs.
 * Offline/errors degrade gracefully — local cancel/approval remain authoritative for execution.
 */

import {
  collectSpringCorrelationMismatches,
  formatSpringCorrelationDiagnostics,
  withSpringCorrelationBody,
  type SpringCorrelationMismatch
} from "./spring-correlation.ts";

export type AgentTurnConnection = {
  gatewayOrigin: string;
  headers: Record<string, string>;
};

export type AgentTurnStartResult = {
  turnId: string;
  sessionId: string;
  status: string;
  offline?: boolean;
  /** Diagnostic only — local TurnScope remains authoritative. */
  correlationMismatches?: SpringCorrelationMismatch[];
};

export type AgentApprovalResolveResult = {
  sideEffectAllowed: boolean;
  status: string;
  offline?: boolean;
};

export type AgentToolProposeResult = {
  toolCallId: string;
  approvalId?: string;
  sideEffectAllowed: boolean;
  offline?: boolean;
};

type AgentTurnControlPlaneInput = {
  getConnection: () => Promise<AgentTurnConnection>;
  fetchImpl?: typeof fetch;
  /** When false, all calls no-op as offline degrade. */
  isEnabled?: () => boolean | Promise<boolean>;
  onCorrelationMismatch?: (message: string, mismatches: SpringCorrelationMismatch[]) => void;
};

/** Best-effort spring turn coordination; never blocks local stop. */
export class AgentTurnControlPlaneService {
  private readonly getConnection: AgentTurnControlPlaneInput["getConnection"];
  private readonly fetchImpl: typeof fetch;
  private readonly isEnabled: () => boolean | Promise<boolean>;
  private readonly onCorrelationMismatch?: AgentTurnControlPlaneInput["onCorrelationMismatch"];

  constructor(input: AgentTurnControlPlaneInput) {
    this.getConnection = input.getConnection;
    this.fetchImpl = input.fetchImpl ?? fetch;
    this.isEnabled = input.isEnabled ?? (() => true);
    this.onCorrelationMismatch = input.onCorrelationMismatch;
  }

  async startTurn(input: {
    sessionId: string;
    idempotencyKey: string;
    clientMessageId?: string;
    content?: string;
    modelHint?: string;
    workspaceId?: string;
    requestId?: string;
  }): Promise<AgentTurnStartResult> {
    if (!(await this.isEnabled())) {
      return { turnId: "", sessionId: input.sessionId, status: "offline", offline: true };
    }
    try {
      const correlation = {
        workspaceId: input.workspaceId,
        threadId: input.sessionId,
        requestId: input.requestId || input.idempotencyKey || input.clientMessageId
      };
      const envelope = await this.request(
        "POST",
        `/api/desktop/v1/sessions/${encodeURIComponent(input.sessionId)}/turns`,
        withSpringCorrelationBody({
          clientMessageId: input.clientMessageId,
          content: input.content,
          modelHint: input.modelHint,
          idempotencyKey: input.idempotencyKey
        }, correlation),
        { "Idempotency-Key": input.idempotencyKey }
      );
      const turnId = stringField(envelope, "turnId") || stringField(objectField(envelope, "turn"), "turnId");
      if (!turnId) return { turnId: "", sessionId: input.sessionId, status: "offline", offline: true };
      const sessionId = stringField(envelope, "sessionId") || input.sessionId;
      const correlationMismatches = collectSpringCorrelationMismatches(correlation, {
        ...envelope,
        sessionId,
        session_id: sessionId
      });
      if (correlationMismatches.length) {
        const message = formatSpringCorrelationDiagnostics("agent-turn/start", correlationMismatches);
        this.onCorrelationMismatch?.(message, correlationMismatches);
      }
      return {
        turnId,
        sessionId,
        status: stringField(envelope, "status") || "running",
        correlationMismatches: correlationMismatches.length ? correlationMismatches : undefined
      };
    } catch {
      return { turnId: "", sessionId: input.sessionId, status: "offline", offline: true };
    }
  }

  async cancelTurn(input: {
    sessionId: string;
    turnId: string;
    reason?: string;
  }): Promise<{ ok: boolean; offline?: boolean; status?: string }> {
    if (!input.turnId || !(await this.isEnabled())) {
      return { ok: false, offline: true };
    }
    try {
      const envelope = await this.request(
        "POST",
        `/api/desktop/v1/sessions/${encodeURIComponent(input.sessionId)}/turns/${encodeURIComponent(input.turnId)}/cancel`,
        { reason: input.reason || "user_stop" }
      );
      return { ok: true, status: stringField(envelope, "status") || "cancelled" };
    } catch {
      return { ok: false, offline: true };
    }
  }

  async bindGateway(input: {
    sessionId: string;
    turnId: string;
    gatewayRequestId: string;
  }): Promise<{ ok: boolean; offline?: boolean }> {
    if (!input.turnId || !input.gatewayRequestId || !(await this.isEnabled())) {
      return { ok: false, offline: true };
    }
    try {
      await this.request(
        "POST",
        `/api/desktop/v1/sessions/${encodeURIComponent(input.sessionId)}/turns/${encodeURIComponent(input.turnId)}/bind-gateway`,
        { gatewayRequestId: input.gatewayRequestId }
      );
      return { ok: true };
    } catch {
      return { ok: false, offline: true };
    }
  }

  async proposeTool(input: {
    sessionId: string;
    turnId: string;
    toolCallId?: string;
    name: string;
    arguments?: Record<string, unknown>;
    risk?: string;
    sideEffectClass?: string;
    requiresApproval?: boolean;
    approvalMessage?: string;
  }): Promise<AgentToolProposeResult> {
    if (!input.turnId || !(await this.isEnabled())) {
      return { toolCallId: input.toolCallId || "", sideEffectAllowed: false, offline: true };
    }
    try {
      const envelope = await this.request(
        "POST",
        `/api/desktop/v1/sessions/${encodeURIComponent(input.sessionId)}/turns/${encodeURIComponent(input.turnId)}/tools/propose`,
        {
          toolCallId: input.toolCallId,
          name: input.name,
          arguments: input.arguments || {},
          risk: input.risk,
          sideEffectClass: input.sideEffectClass,
          requiresApproval: input.requiresApproval,
          approvalMessage: input.approvalMessage
        }
      );
      const toolCall = objectField(envelope, "toolCall");
      const approval = objectField(envelope, "approval");
      return {
        toolCallId: stringField(toolCall, "toolCallId") || input.toolCallId || "",
        approvalId: stringField(approval, "approvalId") || undefined,
        sideEffectAllowed: envelope.sideEffectAllowed === true
      };
    } catch {
      return { toolCallId: input.toolCallId || "", sideEffectAllowed: false, offline: true };
    }
  }

  /**
   * Resolve approval on spring before local tool side effects when online.
   * On offline/error for deny: still returns sideEffectAllowed=false.
   * On offline/error for approve: returns offline so caller may degrade to local-only.
   */
  async resolveApproval(input: {
    approvalId: string;
    decision: "approve" | "deny";
    note?: string;
  }): Promise<AgentApprovalResolveResult> {
    if (!input.approvalId || !(await this.isEnabled())) {
      return {
        sideEffectAllowed: input.decision === "approve",
        status: input.decision === "approve" ? "approved" : "denied",
        offline: true
      };
    }
    try {
      const envelope = await this.request(
        "POST",
        `/api/desktop/v1/approvals/${encodeURIComponent(input.approvalId)}/resolve`,
        { decision: input.decision, note: input.note }
      );
      const approval = objectField(envelope, "approval");
      return {
        sideEffectAllowed: envelope.sideEffectAllowed === true,
        status: stringField(approval, "status")
          || (input.decision === "approve" ? "approved" : "denied")
      };
    } catch {
      // Offline degrade: deny never allows side effects; approve falls back to local user decision.
      return {
        sideEffectAllowed: input.decision === "approve",
        status: input.decision === "approve" ? "approved" : "denied",
        offline: true
      };
    }
  }

  async completeTurn(input: { sessionId: string; turnId: string }): Promise<{ ok: boolean; offline?: boolean }> {
    if (!input.turnId || !(await this.isEnabled())) return { ok: false, offline: true };
    try {
      await this.request(
        "POST",
        `/api/desktop/v1/sessions/${encodeURIComponent(input.sessionId)}/turns/${encodeURIComponent(input.turnId)}/complete`,
        {}
      );
      return { ok: true };
    } catch {
      return { ok: false, offline: true };
    }
  }

  private async request(
    method: "GET" | "POST",
    path: string,
    body?: Record<string, unknown>,
    extraHeaders?: Record<string, string>
  ): Promise<Record<string, unknown>> {
    const connection = await this.getConnection();
    const origin = new URL(connection.gatewayOrigin).origin;
    let response: Response;
    try {
      response = await this.fetchImpl(`${origin}${path}`, {
        method,
        headers: {
          Accept: "application/json",
          ...connection.headers,
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...extraHeaders
        },
        body: body ? JSON.stringify(body) : undefined
      });
    } catch (error) {
      throw new Error("AGENT_TURN_HTTP_UNAVAILABLE");
    }
    if (!response.ok) {
      throw new Error(`AGENT_TURN_HTTP_${response.status}`);
    }
    const json = await response.json() as unknown;
    return asObject(json);
  }
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function objectField(source: Record<string, unknown>, key: string): Record<string, unknown> {
  return asObject(source[key]);
}

function stringField(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  return typeof value === "string" ? value.trim() : "";
}
