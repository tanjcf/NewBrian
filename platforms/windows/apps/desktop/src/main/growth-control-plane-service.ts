export type GrowthConnection = {
  gatewayOrigin: string;
  headers: Record<string, string>;
};

type GrowthControlPlaneServiceInput = {
  getConnection: () => Promise<GrowthConnection>;
  refreshConnection?: () => Promise<GrowthConnection>;
  fetchImpl?: typeof fetch;
};

/**
 * Desktop client for spring-app Growth Worker APIs (`/api/growth/v1`).
 */
export class GrowthControlPlaneService {
  private readonly getConnection: GrowthControlPlaneServiceInput["getConnection"];
  private readonly refreshConnection?: GrowthControlPlaneServiceInput["refreshConnection"];
  private readonly fetchImpl: typeof fetch;

  constructor(input: GrowthControlPlaneServiceInput) {
    this.getConnection = input.getConnection;
    this.refreshConnection = input.refreshConnection;
    this.fetchImpl = input.fetchImpl ?? fetch;
  }

  async createProcess(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.request("POST", "/api/growth/v1/processes", payload);
  }

  async listProcesses(limit = 50): Promise<Record<string, unknown>> {
    return this.request("GET", `/api/growth/v1/processes?limit=${Math.max(1, Math.min(200, limit))}`);
  }

  async publishProcess(processId: string): Promise<Record<string, unknown>> {
    return this.request("POST", `/api/growth/v1/processes/${encodeURIComponent(processId)}/publish`);
  }

  async startInstance(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.request("POST", "/api/growth/v1/instances", payload);
  }

  async getInstance(instanceId: string): Promise<Record<string, unknown>> {
    return this.request("GET", `/api/growth/v1/instances/${encodeURIComponent(instanceId)}`);
  }

  async listInstances(limit = 50): Promise<Record<string, unknown>> {
    return this.request("GET", `/api/growth/v1/instances?limit=${Math.max(1, Math.min(200, limit))}`);
  }

  async advance(instanceId: string, payload: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    return this.request(
      "POST",
      `/api/growth/v1/instances/${encodeURIComponent(instanceId)}/advance`,
      payload
    );
  }

  async lease(instanceId: string, leaseOwner: string, ttlSec = 60): Promise<Record<string, unknown>> {
    return this.request(
      "POST",
      `/api/growth/v1/instances/${encodeURIComponent(instanceId)}/lease`,
      { lease_owner: leaseOwner, ttl_sec: ttlSec }
    );
  }

  async listDueInstances(limit = 50): Promise<Record<string, unknown>> {
    return this.request("GET", `/api/growth/v1/instances/due?limit=${Math.max(1, Math.min(200, limit))}`);
  }

  async listHumanTasks(status?: string, limit = 50): Promise<Record<string, unknown>> {
    const params = new URLSearchParams({
      limit: String(Math.max(1, Math.min(200, limit)))
    });
    if (status?.trim()) params.set("status", status.trim());
    return this.request("GET", `/api/growth/v1/human-tasks?${params.toString()}`);
  }

  async completeHumanCallback(token: string, result: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    return this.request("POST", "/api/growth/v1/human-callbacks", { token, result });
  }

  async listSkills(tier?: string, limit = 50): Promise<Record<string, unknown>> {
    const params = new URLSearchParams({
      limit: String(Math.max(1, Math.min(200, limit)))
    });
    if (tier?.trim()) params.set("tier", tier.trim());
    return this.request("GET", `/api/growth/v1/skills?${params.toString()}`);
  }

  async createSkill(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.request("POST", "/api/growth/v1/skills", payload);
  }

  async publishSkill(skillId: string): Promise<Record<string, unknown>> {
    return this.request("POST", `/api/growth/v1/skills/${encodeURIComponent(skillId)}/publish`);
  }

  async listMemories(scope?: string, limit = 50): Promise<Record<string, unknown>> {
    const params = new URLSearchParams({
      limit: String(Math.max(1, Math.min(200, limit)))
    });
    if (scope?.trim()) params.set("scope", scope.trim());
    return this.request("GET", `/api/growth/v1/memories?${params.toString()}`);
  }

  async upsertMemory(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.request("PUT", "/api/growth/v1/memories", payload);
  }

  async listConnectors(limit = 50): Promise<Record<string, unknown>> {
    return this.request("GET", `/api/growth/v1/connectors?limit=${Math.max(1, Math.min(200, limit))}`);
  }

  async createConnector(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.request("POST", "/api/growth/v1/connectors", payload);
  }

  async getConnector(connectorId: string): Promise<Record<string, unknown>> {
    return this.request("GET", `/api/growth/v1/connectors/${encodeURIComponent(connectorId)}`);
  }

  async solidifyConnector(
    connectorId: string,
    publishCompany = true
  ): Promise<Record<string, unknown>> {
    return this.request(
      "POST",
      `/api/growth/v1/connectors/${encodeURIComponent(connectorId)}/solidify`,
      { publish_company: publishCompany }
    );
  }

  async probeConnector(connectorId: string): Promise<Record<string, unknown>> {
    return this.request(
      "POST",
      `/api/growth/v1/connectors/${encodeURIComponent(connectorId)}/probe`
    );
  }

  /**
   * GW-8 demo: HTTP connector → solidify skill; assert secret never appears in API payloads.
   */
  async runHttpConnectorSolidifyDemo(secret = `g4-secret-${Date.now()}`): Promise<{
    connectorId: string;
    skillId: string;
    secretLeaked: boolean;
    probeOk: boolean;
  }> {
    const created = await this.createConnector({
      name: `http-demo-${Date.now()}`,
      type: "http",
      secret,
      config: {
        base_url: "https://example.com/api",
        method: "GET",
        api_key: secret
      }
    });
    const connectorId = String(created.id || "");
    if (!connectorId) throw new Error("GROWTH_CONNECTOR_ID_MISSING");
    const serializedCreate = JSON.stringify(created);
    if (serializedCreate.includes(secret)) {
      throw new Error("GROWTH_SECRET_LEAKED_ON_CREATE");
    }
    const solidified = await this.solidifyConnector(connectorId, true);
    const skill = solidified.skill && typeof solidified.skill === "object"
      ? solidified.skill as Record<string, unknown>
      : {};
    const skillId = String(skill.skill_id || "");
    if (!skillId) throw new Error("GROWTH_CONNECTOR_SKILL_MISSING");
    const probe = await this.probeConnector(connectorId);
    const blob = JSON.stringify({ created, solidified, probe });
    const secretLeaked = blob.includes(secret);
    if (secretLeaked) throw new Error("GROWTH_SECRET_LEAKED_IN_FLOW");
    return {
      connectorId,
      skillId,
      secretLeaked,
      probeOk: probe.ok === true
    };
  }

  /**
   * GW-6/GW-7 demo: company glossary + personal→company skill publish.
   */
  async runCompanySkillShareDemo(skillId = `gsk-g3-${Date.now()}`): Promise<{
    skillId: string;
    publicationId: string;
    memoryId: string;
    memoryEtag: string;
    companySkillCount: number;
  }> {
    const memory = await this.upsertMemory({
      scope: "company",
      kind: "glossary",
      content: { brand: "NewBrain", rule: "prefer-app-channel" }
    });
    const memoryId = String(memory.id || "");
    const memoryEtag = String(memory.etag || "");
    if (!memoryId) throw new Error("GROWTH_MEMORY_ID_MISSING");
    const personal = await this.createSkill({
      skill_id: skillId,
      body: { name: "company-glossary-skill", instructions: "Use company glossary" }
    });
    if (String(personal.skill_id || "") !== skillId) {
      throw new Error(`GROWTH_SKILL_ID_MISMATCH:${personal.skill_id}`);
    }
    const published = await this.publishSkill(skillId);
    if (String(published.tier || "") !== "company" || String(published.status || "") !== "published") {
      throw new Error(`GROWTH_PUBLISH_FAILED:${published.tier}:${published.status}`);
    }
    const listed = await this.listSkills("company", 100);
    const items = Array.isArray(listed.items) ? listed.items as Array<Record<string, unknown>> : [];
    const companySkillCount = items.filter((item) => String(item.skill_id || "") === skillId).length;
    if (companySkillCount < 1) throw new Error("GROWTH_COMPANY_SKILL_NOT_LISTED");
    return {
      skillId,
      publicationId: String(published.id || ""),
      memoryId,
      memoryEtag,
      companySkillCount
    };
  }

  /**
   * Run GW-1 style happy path: draft → publish → start → advance ×2 → completed.
   */
  async runTwoAutoNodeDemo(name = `gw1-${Date.now()}`): Promise<{
    processId: string;
    instanceId: string;
    finalStatus: string;
  }> {
    const created = await this.createProcess({ name });
    const processId = String(created.id || "");
    if (!processId) throw new Error("GROWTH_PROCESS_ID_MISSING");
    await this.publishProcess(processId);
    const started = await this.startInstance({ process_id: processId, context: { demo: true } });
    const instanceId = String(started.id || "");
    if (!instanceId) throw new Error("GROWTH_INSTANCE_ID_MISSING");
    await this.lease(instanceId, "newbrain-desktop-host");
    await this.advance(instanceId, { result: { step: 1 } });
    const done = await this.advance(instanceId, { result: { step: 2 } });
    return {
      processId,
      instanceId,
      finalStatus: String(done.status || "")
    };
  }

  /**
   * Run GW-2 path: auto → human (callback, idempotent) → auto → completed.
   */
  async runAutoThenHumanDemo(name = `gw2-${Date.now()}`): Promise<{
    processId: string;
    instanceId: string;
    humanTaskId: string;
    finalStatus: string;
    duplicateCallbackStatus: string;
  }> {
    const created = await this.createProcess({
      name,
      nodes: [
        { node_id: "n1", type: "auto", name: "prep" },
        { node_id: "h1", type: "human", name: "approve", human_role: "" },
        { node_id: "n2", type: "auto", name: "finish" }
      ],
      edges: [
        { from: "n1", to: "h1" },
        { from: "h1", to: "n2" }
      ]
    });
    const processId = String(created.id || "");
    if (!processId) throw new Error("GROWTH_PROCESS_ID_MISSING");
    await this.publishProcess(processId);
    const started = await this.startInstance({ process_id: processId, context: { demo: "g2" } });
    const instanceId = String(started.id || "");
    if (!instanceId) throw new Error("GROWTH_INSTANCE_ID_MISSING");
    await this.lease(instanceId, "newbrain-desktop-host");
    const parked = await this.advance(instanceId, { result: { step: 1 } });
    const pending = parked.pending_human_task && typeof parked.pending_human_task === "object"
      ? parked.pending_human_task as Record<string, unknown>
      : null;
    const token = String(pending?.token || "");
    const humanTaskId = String(pending?.id || "");
    if (!token || !humanTaskId) throw new Error("GROWTH_HUMAN_TOKEN_MISSING");
    if (String(parked.status || "") !== "waiting_human") {
      throw new Error(`GROWTH_EXPECTED_WAITING_HUMAN:${parked.status}`);
    }
    const resumed = await this.completeHumanCallback(token, { approved: true });
    if (String(resumed.status || "") !== "running" || String(resumed.cursor_node_id || "") !== "n2") {
      throw new Error(`GROWTH_RESUME_FAILED:${resumed.status}:${resumed.cursor_node_id}`);
    }
    const duplicate = await this.completeHumanCallback(token, { approved: true, again: true });
    const duplicateCallbackStatus = String(duplicate.status || "");
    if (duplicateCallbackStatus !== "running" && duplicateCallbackStatus !== "completed") {
      throw new Error(`GROWTH_IDEMPOTENT_CALLBACK_FAILED:${duplicateCallbackStatus}`);
    }
    if (String(duplicate.cursor_node_id || "") !== "n2" && duplicateCallbackStatus !== "completed") {
      throw new Error(`GROWTH_DOUBLE_ADVANCE:${duplicate.cursor_node_id}`);
    }
    await this.lease(instanceId, "newbrain-desktop-host");
    const done = await this.advance(instanceId, { result: { step: 2 } });
    return {
      processId,
      instanceId,
      humanTaskId,
      finalStatus: String(done.status || ""),
      duplicateCallbackStatus
    };
  }

  async listTemplates(): Promise<Array<Record<string, unknown>>> {
    const payload = await this.request("GET", "/api/growth/v1/templates");
    return Array.isArray(payload.items) ? payload.items as Array<Record<string, unknown>> : [];
  }

  async importTemplate(templateId: string, name?: string): Promise<Record<string, unknown>> {
    return this.request("POST", `/api/growth/v1/templates/${encodeURIComponent(templateId)}/import`, {
      name: name || undefined
    });
  }

  async completeAsyncWebhook(
    connectorId: string,
    body: Record<string, unknown> = {}
  ): Promise<Record<string, unknown>> {
    return this.request("POST", `/api/growth/v1/webhooks/${encodeURIComponent(connectorId)}`, body);
  }

  async getRuntimeStatus(): Promise<Record<string, unknown>> {
    return this.request("GET", "/api/growth/v1/runtime/status");
  }

  async setKillSwitch(enabled: boolean, reason?: string): Promise<Record<string, unknown>> {
    return this.request("POST", "/api/growth/v1/runtime/kill-switch", {
      enabled,
      reason: reason || undefined
    });
  }

  async listRuntimeAudits(limit = 50): Promise<Array<Record<string, unknown>>> {
    const payload = await this.request("GET", `/api/growth/v1/runtime/audits?limit=${Math.max(1, Math.min(200, limit))}`);
    return Array.isArray(payload.items) ? payload.items as Array<Record<string, unknown>> : [];
  }

  /**
   * G5 demo: import CASE template and drive to completed through auto / async_wait / human.
   */
  async runCaseAsyncHumanDemo(templateId = "case01-influencer"): Promise<{
    templateId: string;
    processId: string;
    instanceId: string;
    sawAsync: boolean;
    sawHuman: boolean;
    webhookStatus: string;
    finalStatus: string;
  }> {
    const imported = await this.importTemplate(templateId);
    const processId = String(imported.id || "");
    if (!processId) throw new Error("GROWTH_TEMPLATE_IMPORT_ID_MISSING");
    await this.publishProcess(processId);
    const started = await this.startInstance({
      process_id: processId,
      context: { demo: "g5-case", template_id: templateId }
    });
    const instanceId = String(started.id || "");
    if (!instanceId) throw new Error("GROWTH_INSTANCE_ID_MISSING");

    let sawAsync = false;
    let sawHuman = false;
    let webhookStatus = "";
    let status = String(started.status || "running");
    for (let step = 0; step < 20 && status !== "completed" && status !== "failed"; step += 1) {
      if (status === "waiting_async") {
        throw new Error("GROWTH_ASYNC_WITHOUT_TOKEN");
      }
      if (status === "waiting_human") {
        throw new Error("GROWTH_HUMAN_WITHOUT_TOKEN");
      }
      await this.lease(instanceId, "newbrain-desktop-host");
      const advanced = await this.advance(instanceId, { result: { step } });
      status = String(advanced.status || "");

      if (status === "waiting_async") {
        sawAsync = true;
        const pendingAsync = advanced.pending_async_ticket && typeof advanced.pending_async_ticket === "object"
          ? advanced.pending_async_ticket as Record<string, unknown>
          : null;
        const connectorId = String(pendingAsync?.connector_id || "async");
        const token = String(pendingAsync?.token || "");
        if (!token) throw new Error("GROWTH_ASYNC_TOKEN_MISSING");
        const resumed = await this.completeAsyncWebhook(connectorId, {
          token,
          external_ref: `ext-${Date.now()}`,
          ok: true
        });
        webhookStatus = String(resumed.status || "");
        status = webhookStatus;
        continue;
      }

      if (status === "waiting_human") {
        sawHuman = true;
        const pendingHuman = advanced.pending_human_task && typeof advanced.pending_human_task === "object"
          ? advanced.pending_human_task as Record<string, unknown>
          : null;
        const token = String(pendingHuman?.token || "");
        if (!token) throw new Error("GROWTH_HUMAN_TOKEN_MISSING");
        const resumed = await this.completeHumanCallback(token, { approved: true, source: "g5" });
        status = String(resumed.status || "");
      }
    }
    if (status !== "completed") {
      throw new Error(`GROWTH_CASE_NOT_COMPLETED:${status}`);
    }
    return {
      templateId,
      processId,
      instanceId,
      sawAsync,
      sawHuman,
      webhookStatus,
      finalStatus: status
    };
  }

  private async request(
    method: "GET" | "POST" | "PUT",
    path: string,
    body?: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    if (!path.startsWith("/api/growth/v1/")) {
      throw new Error("GROWTH_PATH_FORBIDDEN");
    }
    let connection = await this.getConnection();
    let refreshed = false;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await this.fetchImpl(`${connection.gatewayOrigin}${path}`, {
          method,
          headers: {
            Accept: "application/json",
            ...(body ? { "Content-Type": "application/json" } : {}),
            ...connection.headers
          },
          body: body ? JSON.stringify(body) : undefined
        });
        const raw = await response.text();
        let payload: unknown = null;
        try {
          payload = raw ? JSON.parse(raw) : null;
        } catch {
          throw new Error(`GROWTH_INVALID_JSON:${response.status}`);
        }
        if ((response.status === 401 || response.status === 403) && !refreshed && this.refreshConnection) {
          connection = await this.refreshConnection();
          refreshed = true;
          continue;
        }
        if (!response.ok) {
          const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
          const detail = String(
            record.message
            || record.detail
            || record.error
            || (typeof record.path === "string" ? JSON.stringify(record) : "")
            || `GROWTH_HTTP_${response.status}`
          );
          throw new Error(`${detail} [status=${response.status} path=${path}]`);
        }
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
          throw new Error("GROWTH_INVALID_OBJECT");
        }
      return payload as Record<string, unknown>;
    }
    throw new Error("GROWTH_REQUEST_FAILED");
  }
}

export function readGrowthEnabledFromCapabilities(capabilities: Record<string, unknown> | null | undefined): boolean {
  const fleet = capabilities && typeof capabilities.fleet === "object" && capabilities.fleet
    ? capabilities.fleet as Record<string, unknown>
    : null;
  if (!fleet) return true;
  return fleet.growth_enabled !== false;
}
