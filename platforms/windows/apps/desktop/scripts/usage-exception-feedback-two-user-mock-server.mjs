import { createHash } from "node:crypto";
import { createServer } from "node:http";

const port = Number(process.env.NEWBRAIN_USAGE_FEEDBACK_TWO_USER_PORT || 18951);
const tickets = new Map();
const state = { uploads: [], tickets: [], adminReads: 0, chatRequests: 0, modelRequests: 0 };
const analysis = JSON.stringify({
  title: "文档生成任务无法完成",
  symptomSummary: "文档生成后任务持续运行且没有完成结果。",
  possibleCause: "生成流程的完成事件可能未正确投影。",
  category: "document_generation_stuck",
  stableFeatures: ["document_generation", "completion_event_missing"],
  contextSummary: "用户触发文档生成后长时间无完成状态。"
});

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://127.0.0.1:${port}`);
  const body = await readBody(request);
  if (url.pathname === "/__state") return json(response, {
    ...state,
    tickets: [...tickets.values()],
    aggregate: aggregate()
  });
  if (url.pathname === "/v1/models") return json(response, { data: [{ id: "newbrain-e2e-model" }] });
  if (url.pathname === "/v1/responses") {
    state.modelRequests += 1;
    const prompt = JSON.stringify(body || {});
    if (!prompt.includes("用户主动报告的使用异常")) state.chatRequests += 1;
    return json(response, {
      id: `response-${state.modelRequests}`,
      object: "response",
      status: "completed",
      output_text: analysis,
      output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: analysis }] }],
      usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 }
    });
  }
  if (url.pathname === "/api/desktop/v1/error-reports" && request.method === "POST") {
    const owner = ownerFromAuth(request.headers.authorization || "");
    const fingerprint = fingerprintFor(body);
    const key = `${owner}:${fingerprint}`;
    const existing = tickets.get(key);
    const now = new Date().toISOString();
    if (existing) {
      existing.occurrences += 1;
      existing.lastSeenAt = now;
      existing.appVersion = String(body?.appVersion || existing.appVersion || "0.1.60");
    } else {
      tickets.set(key, {
        id: `ticket-${tickets.size + 1}`,
        ownerUserId: owner,
        userEmail: `${owner}@example.test`,
        deviceId: String(body?.deviceId || "device"),
        appVersion: String(body?.appVersion || "0.1.60"),
        kind: String(body?.kind || ""),
        message: String(body?.message || ""),
        contextJson: JSON.stringify(body?.context || {}),
        fingerprint,
        status: "OPEN",
        occurrences: 1,
        firstSeenAt: now,
        lastSeenAt: now
      });
    }
    state.uploads.push({ owner, fingerprint, authorization: request.headers.authorization || "" });
    return json(response, { id: tickets.get(key).id, fingerprint, status: "OPEN", created: !existing });
  }
  if (url.pathname === "/api/admin/desktop-error-reports" && request.method === "GET") {
    state.adminReads += 1;
    const impacts = aggregate();
    const rows = [...tickets.values()].map((ticket) => {
      const impact = impacts.byFingerprint[ticket.fingerprint];
      return {
        id: ticket.id,
        userEmail: ticket.userEmail,
        deviceId: ticket.deviceId,
        appVersion: ticket.appVersion,
        kind: ticket.kind,
        message: ticket.message,
        stackTrace: "",
        contextJson: ticket.contextJson,
        fingerprint: ticket.fingerprint,
        status: ticket.status,
        occurrences: ticket.occurrences,
        firstSeenAt: ticket.firstSeenAt,
        lastSeenAt: ticket.lastSeenAt,
        fixedAt: "",
        fixReference: "",
        totalOccurrences: impact.totalOccurrences,
        affectedUsers: impact.affectedUsers,
        aggregateFirstSeenAt: impact.firstSeenAt,
        aggregateLastSeenAt: impact.lastSeenAt,
        versionDistribution: impact.versionDistribution
      };
    });
    return json(response, rows);
  }
  if (url.pathname === "/api/agreements/public") return json(response, { items: [] });
  return json(response, { message: "not found", path: url.pathname }, 404);
});

function fingerprintFor(body) {
  const context = body?.context && typeof body.context === "object" ? body.context : {};
  const category = String(context.category || "").trim().toLowerCase();
  const features = Array.isArray(context.stableFeatures)
    ? [...new Set(context.stableFeatures.map((item) => String(item).trim().toLowerCase()).filter(Boolean))].sort()
    : [];
  const versionOk = context.feedbackSchemaVersion === 1 || context.feedbackSchemaVersion === "1";
  const material = versionOk && category && features.length
    ? ["user_reported_usage_exception", category, ...features].join("\n")
    : `${body?.kind || ""}\n${body?.message || ""}`;
  return createHash("sha256").update(material).digest("hex");
}

function ownerFromAuth(authorization) {
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  if (token.startsWith("plain:")) {
    try { return Buffer.from(token.slice("plain:".length), "base64").toString("utf8") || "anonymous"; }
    catch { return "anonymous"; }
  }
  return token || "anonymous";
}

function aggregate() {
  const byFingerprint = {};
  for (const ticket of tickets.values()) {
    const bucket = byFingerprint[ticket.fingerprint] || {
      totalOccurrences: 0,
      affectedUsers: 0,
      owners: new Set(),
      firstSeenAt: ticket.firstSeenAt,
      lastSeenAt: ticket.lastSeenAt,
      versionDistribution: {}
    };
    bucket.totalOccurrences += ticket.occurrences;
    bucket.owners.add(ticket.ownerUserId);
    bucket.affectedUsers = bucket.owners.size;
    if (ticket.firstSeenAt < bucket.firstSeenAt) bucket.firstSeenAt = ticket.firstSeenAt;
    if (ticket.lastSeenAt > bucket.lastSeenAt) bucket.lastSeenAt = ticket.lastSeenAt;
    bucket.versionDistribution[ticket.appVersion] = (bucket.versionDistribution[ticket.appVersion] || 0) + ticket.occurrences;
    byFingerprint[ticket.fingerprint] = bucket;
  }
  const shared = Object.values(byFingerprint)[0] || null;
  return {
    byFingerprint: Object.fromEntries(Object.entries(byFingerprint).map(([fingerprint, value]) => [fingerprint, {
      totalOccurrences: value.totalOccurrences,
      affectedUsers: value.affectedUsers,
      firstSeenAt: value.firstSeenAt,
      lastSeenAt: value.lastSeenAt,
      versionDistribution: value.versionDistribution
    }])),
    sharedFingerprintCount: Object.keys(byFingerprint).length,
    shared
  };
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (!chunks.length) return null;
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return null; }
}

function json(response, value, status = 200) {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify(value));
}

server.listen(port, "127.0.0.1", () => process.stdout.write(`READY ${port}\n`));
process.on("SIGTERM", () => server.close());
