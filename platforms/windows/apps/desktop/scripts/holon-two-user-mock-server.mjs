import { createHash } from "node:crypto";
import { createServer } from "node:http";

const port = Number(process.env.NEWBRAIN_HOLON_TWO_USER_PORT || 18893);
const now = () => new Date().toISOString();
const users = {
  "mock-user-a": createUser("a"),
  "mock-user-b": createUser("b")
};

function createUser(suffix) {
  return {
    suffix,
    claimIndex: 0,
    events: [],
    candidates: [],
    versions: [],
    snapshots: [],
    feedback: [],
    activeVersionId: null
  };
}

const state = { users, crossUserDenials: 0, cleanupRuns: 0 };

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
  const body = await readBody(request);
  if (url.pathname === "/__state") return json(response, publicState());
  if (url.pathname === "/__cleanup" && request.method === "POST") {
    for (const user of Object.values(users)) Object.assign(user, createUser(user.suffix));
    state.cleanupRuns += 1;
    return json(response, { ok: true, residue: residueCount() });
  }
  if (url.pathname === "/v1/models") return json(response, {
    data: [{ id: "newbrain-holon-two-user", name: "Holon two-user mock", owned_by: "newbrain", config_id: "mock" }]
  });
  if (url.pathname === "/v1/responses") return json(response, modelResponse());

  const token = bearer(request);
  const user = users[token];
  if (!user) return json(response, { message: "MOCK_AUTH_REQUIRED" }, 401);
  if (url.searchParams.has("owner_user_id") || body?.owner_user_id || body?.ownerUserId) {
    state.crossUserDenials += 1;
    return json(response, { message: "MOCK_OWNER_FIELD_FORBIDDEN" }, 403);
  }

  if (url.pathname.endsWith("/holon/work-items/next")) {
    if (user.suffix === "b") return json(response, { item: {} });
    const item = nextWorkItem(user, url.searchParams.get("device_id") ?? "");
    return json(response, { item: item ?? {} });
  }
  const workMatch = url.pathname.match(/\/holon\/work-items\/([^/]+)\/(heartbeat|control|cancel)$/);
  if (workMatch) {
    if (!workMatch[1].includes(`_${user.suffix}_`)) return denied(response);
    if (workMatch[2] === "heartbeat") return json(response, {
      work_item_id: workMatch[1], lease_until: new Date(Date.now() + 120_000).toISOString()
    });
    if (workMatch[2] === "control") return json(response, { control: { status: "RUNNING", cancel_requested: false } });
    return json(response, { ok: true, work_item_id: workMatch[1], cancel_requested: true });
  }
  if (url.pathname.endsWith("/holon/events:batch")) {
    const events = Array.isArray(body?.events) ? body.events : [];
    if (events.some((event) => !String(event.work_item_id).includes(`_${user.suffix}_`))) return denied(response);
    user.events.push(...events);
    for (const event of events) {
      if (event.event_type === "work_item.completed") createCandidate(user, event.work_item_id);
    }
    return json(response, { ok: true, accepted: events.length, duplicate: 0, total: events.length });
  }
  const snapshotMatch = url.pathname.match(/\/knowledge\/snapshots\/([^/]+)$/);
  if (snapshotMatch) {
    const snapshot = user.snapshots.find((item) => item.id === snapshotMatch[1]);
    return snapshot ? json(response, { snapshot }) : denied(response, 404);
  }
  if (url.pathname.endsWith("/learning/candidates")) return json(response, { items: user.candidates });
  if (url.pathname.endsWith("/learning/knowledge/search")) return json(response, {
    items: user.versions.filter((item) => item.id === user.activeVersionId).map((item) => ({
      skill_key: item.skill_key,
      version_id: item.id,
      content: item.content_json,
      content_hash: item.content_hash,
      created_at: item.created_at,
      score: 1
    }))
  });
  const candidateMatch = url.pathname.match(/\/learning\/candidates\/([^/]+)\/(approve|reject)$/);
  if (candidateMatch) {
    const candidate = user.candidates.find((item) => item.id === candidateMatch[1]);
    if (!candidate) return denied(response, 404);
    if (candidateMatch[2] === "reject") {
      user.candidates = user.candidates.filter((item) => item.id !== candidate.id);
      return json(response, { ok: true, status: "REJECTED" });
    }
    user.candidates = user.candidates.filter((item) => item.id !== candidate.id);
    const version = { ...candidate, status: "ACTIVE", activated_at: now() };
    user.versions.push(version);
    user.activeVersionId = version.id;
    const snapshot = createSnapshot(user, version);
    return json(response, { ok: true, status: "ACTIVE", version_id: version.id, snapshot_id: snapshot.id });
  }
  const rollbackMatch = url.pathname.match(/\/learning\/skills\/([^/]+)\/rollback$/);
  if (rollbackMatch) {
    const version = user.versions.find((item) => item.skill_key === decodeURIComponent(rollbackMatch[1])
      && item.id === body?.target_version_id);
    if (!version) return denied(response, 404);
    user.activeVersionId = version.id;
    createSnapshot(user, version);
    return json(response, { ok: true, status: "ACTIVE", version_id: version.id });
  }
  if (url.pathname.endsWith("/holon/feedback")) {
    const version = user.versions.find((item) => item.id === body?.version_id);
    if (!version || !String(body?.work_item_id).includes(`_${user.suffix}_`)) return denied(response, 404);
    user.feedback.push(body);
    if (body.safety_violation === true && version.parent_version_id) user.activeVersionId = version.parent_version_id;
    return json(response, { ok: true, rollback_version_id: user.activeVersionId });
  }
  return json(response, { message: "MOCK_NOT_FOUND", path: url.pathname }, 404);
});

function nextWorkItem(user, deviceId) {
  const episode = user.claimIndex + 1;
  if (episode > 2) return null;
  user.claimIndex += 1;
  const snapshot = episode === 2 ? user.snapshots.at(-1) : null;
  return {
    id: `wi_${user.suffix}_${episode}`, source: "two-user-mock",
    objective: `Complete learning episode ${episode} and return HOLON_USER_${user.suffix.toUpperCase()}_EPISODE_${episode}.`,
    status: "DISPATCHED", target_device_id: deviceId,
    knowledge_snapshot_id: snapshot?.id ?? null,
    execution_policy_version: "execution-v1", learning_policy_version: "learning-v1",
    version_no: 1, dispatch_attempt_count: 1,
    lease_until: new Date(Date.now() + 120_000).toISOString(), cancel_requested: false,
    created_at: now(), updated_at: now()
  };
}

function createCandidate(user, workItemId) {
  if (user.candidates.some((item) => item.source_work_item_id === workItemId)
    || user.versions.some((item) => item.source_work_item_id === workItemId)) return;
  const generation = user.versions.length + user.candidates.length + 1;
  const id = `version-${user.suffix}-v${generation}`;
  const contentJson = JSON.stringify({ rule: `private-${user.suffix}-rule-v${generation}` });
  user.candidates.push({
    id, skill_key: `private-${user.suffix}-skill`, parent_version_id: user.activeVersionId,
    status: "REVIEW_REQUIRED", content_json: contentJson,
    content_hash: hash(contentJson), source_work_item_id: workItemId,
    evaluation_run_id: `eval-${user.suffix}-${generation}`, index_status: "PENDING",
    created_at: now(), activated_at: null
  });
}

function createSnapshot(user, version) {
  const generation = user.snapshots.length + 1;
  const snapshot = {
    id: `snapshot-${user.suffix}-${generation}`, generation, status: "READY", item_count: 1,
    content_hash: hash(version.content_json), created_at: now(),
    items: [{ skill_key: version.skill_key, version_id: version.id, ordinal_no: 0,
      content_json: version.content_json, content_hash: version.content_hash }]
  };
  user.snapshots.push(snapshot);
  return snapshot;
}

function modelResponse() {
  return {
    id: `response-${Date.now()}`, object: "response", status: "completed", output_text: "HOLON_MOCK_COMPLETED",
    output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "HOLON_MOCK_COMPLETED" }] }],
    usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 }
  };
}

function publicState() {
  return {
    users: Object.fromEntries(Object.entries(users).map(([token, user]) => [token, {
      claimIndex: user.claimIndex,
      eventTypes: user.events.map((event) => event.event_type),
      candidates: user.candidates.map((item) => item.id),
      versions: user.versions.map((item) => item.id),
      snapshots: user.snapshots.map((item) => item.id),
      feedbackCount: user.feedback.length,
      activeVersionId: user.activeVersionId
    }])),
    crossUserDenials: state.crossUserDenials,
    cleanupRuns: state.cleanupRuns,
    residue: residueCount()
  };
}

function residueCount() {
  return Object.values(users).reduce((total, user) => total + user.events.length + user.candidates.length
    + user.versions.length + user.snapshots.length + user.feedback.length + user.claimIndex, 0);
}
function bearer(request) { return String(request.headers.authorization ?? "").replace(/^Bearer\s+/i, "").trim(); }
function denied(response, status = 403) { state.crossUserDenials += 1; return json(response, { message: "MOCK_OWNERSHIP_DENIED" }, status); }
function hash(value) { return `sha256:${createHash("sha256").update(value).digest("hex")}`; }
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
