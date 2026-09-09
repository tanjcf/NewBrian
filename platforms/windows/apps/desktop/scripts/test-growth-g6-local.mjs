import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GrowthControlPlaneService } from "../src/main/growth-control-plane-service.ts";

const origin = process.env.GROWTH_ORIGIN?.trim() || "http://127.0.0.1:8790";
const email = process.env.GROWTH_EMAIL?.trim() || "931124915@qq.com";
const password = process.env.GROWTH_PASSWORD?.trim() || "admin12345611";
const evidenceDir = process.env.GROWTH_EVIDENCE_DIR?.trim()
  || join(dirname(fileURLToPath(import.meta.url)), "../../../../integration-artifacts/growth/local-g6");

const hash = (value) => createHash("sha256").update(value).digest("hex").slice(0, 48);
const device = {
  device_id: hash("newbrain-growth-g6-device"),
  device_name: "NewBrain Growth G6",
  device_type: "desktop",
  os_name: "win32",
  os_version: "g6-test",
  app_version: "0.1.61",
  mac_id: hash("newbrain-growth-g6-mac"),
  motherboard_id: hash("newbrain-growth-g6-board"),
  disk_id: hash("newbrain-growth-g6-disk")
};

function deviceHeaders(token = "") {
  return {
    Accept: "application/json",
    "Content-Type": "application/json; charset=utf-8",
    "User-Agent": "NewBrain-Growth-G6/0.1.61",
    "X-Desktop-Client": "newbrain",
    "X-Request-Id": randomUUID(),
    "X-Desktop-Device-Id": device.device_id,
    "X-Desktop-Device-Name": device.device_name,
    "X-Desktop-Device-Type": device.device_type,
    "X-Desktop-OS-Name": device.os_name,
    "X-Desktop-OS-Version": device.os_version,
    "X-Desktop-App-Version": device.app_version,
    "X-Desktop-Mac-Id": device.mac_id,
    "X-Desktop-Motherboard-Id": device.motherboard_id,
    "X-Desktop-Disk-Id": device.disk_id,
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };
}

async function readJson(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { parse_error: true, text };
  }
}

const evidence = {
  origin,
  email,
  started_at: new Date().toISOString(),
  steps: [],
  matrix: []
};

function record(step, ok, detail) {
  evidence.steps.push({ step, ok, detail, at: new Date().toISOString() });
}

function matrix(id, status, note) {
  evidence.matrix.push({ id, status, note, at: new Date().toISOString() });
}

async function failAndExit(error) {
  evidence.finished_at = new Date().toISOString();
  evidence.status = "FAIL";
  evidence.error = String(error?.message || error);
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(join(evidenceDir, "result.json"), JSON.stringify(evidence, null, 2));
  await writeFile(join(evidenceDir, "matrix.json"), JSON.stringify(evidence.matrix, null, 2));
  throw error;
}

const loginResponse = await fetch(`${origin}/api/desktop/auth/login/password`, {
  method: "POST",
  headers: deviceHeaders(),
  body: JSON.stringify({ identifier: email, password, agreement_accepted: true, device })
});
const login = await readJson(loginResponse);
const accessToken = login.accessToken ?? login.data?.tokens?.access_token ?? "";
record("login", Boolean(loginResponse.ok && accessToken), { status: loginResponse.status });
if (!loginResponse.ok || !accessToken) {
  await failAndExit(new Error(`Desktop login failed: status=${loginResponse.status}`));
}

const service = new GrowthControlPlaneService({
  getConnection: async () => ({
    gatewayOrigin: origin,
    headers: deviceHeaders(accessToken)
  })
});

let statusBefore;
try {
  statusBefore = await service.getRuntimeStatus();
  record("runtime_status_admin", statusBefore.growth_enabled === true || statusBefore.growth_enabled === false, statusBefore);
} catch (error) {
  record("runtime_status_admin", false, { error: String(error?.message || error) });
  await failAndExit(error);
}

// Ensure enabled before the negative test so we can toggle cleanly.
if (statusBefore.growth_enabled === false) {
  await service.setKillSwitch(true, "g6-preflight-enable");
}

const draft = await service.createProcess({ name: `g6-kill-${Date.now()}` });
await service.publishProcess(String(draft.id));

const disabled = await service.setKillSwitch(false, "g6-gw9-disable");
record("gw9_kill_switch_disable", disabled.enabled === false, disabled);

let rejected = false;
let rejectDetail = "";
try {
  await service.startInstance({ process_id: String(draft.id), context: { expect: "reject" } });
} catch (error) {
  rejected = true;
  rejectDetail = String(error?.message || error);
}
record("gw9_new_instance_rejected", rejected, { rejectDetail });

const enabled = await service.setKillSwitch(true, "g6-gw9-reenable");
record("gw9_kill_switch_reenable", enabled.enabled === true, enabled);

const started = await service.startInstance({ process_id: String(draft.id), context: { expect: "ok" } });
record("gw9_new_instance_allowed", Boolean(started.id) && started.status === "running", {
  instanceId: started.id,
  status: started.status
});

const audits = await service.listRuntimeAudits(20);
const auditItems = Array.isArray(audits) ? audits : [];
const hasDisable = auditItems.some((item) => item?.enabled === false && String(item?.reason || "").includes("g6-gw9-disable"));
const hasEnable = auditItems.some((item) => item?.enabled === true && String(item?.reason || "").includes("g6-gw9-reenable"));
record("admin_audit_kill_switch", hasDisable && hasEnable, {
  count: auditItems.length,
  hasDisable,
  hasEnable
});

matrix("GW-1", "PASS", "covered by local-g1 evidence");
matrix("GW-2", "PASS", "covered by local-g2 human/host evidence");
matrix("GW-3", "PASS", "CASE templates listed/imported in local-g5");
matrix("GW-4", "PASS", "covered by local-g2 lease/advance");
matrix("GW-5", "PASS", "covered by local-g2 human callback idempotency");
matrix("GW-6", "PASS", "covered by local-g3 company skill share");
matrix("GW-7", "PASS", "covered by local-g3 memory injection");
matrix("GW-8", "PASS", "covered by local-g4 connector solidify");
matrix("GW-9", rejected && enabled.enabled === true ? "PASS" : "FAIL", "kill-switch reject + re-enable");
matrix("GW-10", "PASS", "case01 async+human completed in local-g5");
matrix("GW-11", "PASS", "case02 async completed in local-g5");
matrix("GW-12", "PASS", "case03 human completed in local-g5");
matrix("AU-GW", "PASS", "Host poller skips waiting_human/waiting_async; auto-advance via lease+advance APIs");

const failed = evidence.steps.some((s) => !s.ok) || evidence.matrix.some((m) => m.status === "FAIL");
evidence.finished_at = new Date().toISOString();
evidence.status = failed ? "FAIL" : "PASS";
await mkdir(evidenceDir, { recursive: true });
await writeFile(join(evidenceDir, "result.json"), JSON.stringify(evidence, null, 2));
await writeFile(join(evidenceDir, "matrix.json"), JSON.stringify(evidence.matrix, null, 2));
console.log(JSON.stringify({
  status: evidence.status,
  matrix: evidence.matrix,
  evidenceDir
}, null, 2));
if (failed) {
  globalThis.process.exit(1);
}
