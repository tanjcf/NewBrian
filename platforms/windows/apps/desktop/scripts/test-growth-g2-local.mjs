import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GrowthControlPlaneService } from "../src/main/growth-control-plane-service.ts";

const origin = process.env.GROWTH_ORIGIN?.trim() || "http://127.0.0.1:8790";
const email = process.env.GROWTH_EMAIL?.trim() || "931124915@qq.com";
const password = process.env.GROWTH_PASSWORD?.trim() || "admin12345611";
const evidenceDir = process.env.GROWTH_EVIDENCE_DIR?.trim()
  || join(dirname(fileURLToPath(import.meta.url)), "../../../../integration-artifacts/growth/local-g2");

const hash = (value) => createHash("sha256").update(value).digest("hex").slice(0, 48);
const device = {
  device_id: hash("newbrain-growth-g2-device"),
  device_name: "NewBrain Growth G2",
  device_type: "desktop",
  os_name: "win32",
  os_version: "g2-test",
  app_version: "0.1.61",
  mac_id: hash("newbrain-growth-g2-mac"),
  motherboard_id: hash("newbrain-growth-g2-board"),
  disk_id: hash("newbrain-growth-g2-disk")
};

function deviceHeaders(token = "") {
  return {
    Accept: "application/json",
    "Content-Type": "application/json; charset=utf-8",
    "User-Agent": "NewBrain-Growth-G2/0.1.61",
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
  steps: []
};

function record(step, ok, detail) {
  evidence.steps.push({ step, ok, detail, at: new Date().toISOString() });
}

async function failAndExit(error) {
  evidence.finished_at = new Date().toISOString();
  evidence.status = "FAIL";
  evidence.error = String(error?.message || error);
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(join(evidenceDir, "result.json"), JSON.stringify(evidence, null, 2));
  throw error;
}

const loginResponse = await fetch(`${origin}/api/desktop/auth/login/password`, {
  method: "POST",
  headers: deviceHeaders(),
  body: JSON.stringify({ identifier: email, password, agreement_accepted: true, device })
});
const login = await readJson(loginResponse);
const accessToken = login.accessToken ?? login.data?.tokens?.access_token ?? "";
const scopes = login.data?.tokens?.scopes ?? login.data?.session?.scopes ?? [];
record("login", Boolean(loginResponse.ok && accessToken), {
  status: loginResponse.status,
  scopes
});
if (!loginResponse.ok || !accessToken) {
  await failAndExit(new Error(`Desktop login failed: status=${loginResponse.status}`));
}

const capsResponse = await fetch(`${origin}/api/desktop/v1/capabilities`, {
  headers: deviceHeaders(accessToken)
});
const caps = await readJson(capsResponse);
const fleet = caps.fleet ?? caps.data?.fleet ?? {};
record("capabilities_fleet", Boolean(capsResponse.ok && fleet.growth_enabled === true), {
  status: capsResponse.status,
  growth_enabled: fleet.growth_enabled,
  has_growth_host: Array.isArray(scopes) && scopes.includes("growth.host")
});

const service = new GrowthControlPlaneService({
  getConnection: async () => ({
    gatewayOrigin: origin,
    headers: deviceHeaders(accessToken)
  })
});

let demo;
try {
  demo = await service.runAutoThenHumanDemo(`gw2-local-${Date.now()}`);
  record("gw2_human_callback_resume", demo.finalStatus === "completed", demo);
} catch (error) {
  record("gw2_human_callback_resume", false, { error: String(error?.message || error) });
  await failAndExit(error);
}

const tasks = await service.listHumanTasks("completed", 20);
const taskItems = Array.isArray(tasks.items) ? tasks.items : [];
record("list_human_tasks_completed", taskItems.some((t) => t?.id === demo.humanTaskId), {
  count: taskItems.length,
  humanTaskId: demo.humanTaskId
});

// GW-4 subset: second host lease must conflict while first lease is held.
const leaseProbe = await service.createProcess({
  name: `gw2-lease-${Date.now()}`,
  nodes: [
    { node_id: "n1", type: "auto", name: "a" },
    { node_id: "n2", type: "auto", name: "b" }
  ],
  edges: [{ from: "n1", to: "n2" }]
});
await service.publishProcess(String(leaseProbe.id));
const leaseStarted = await service.startInstance({ process_id: String(leaseProbe.id) });
const leaseInstanceId = String(leaseStarted.id || "");
await service.lease(leaseInstanceId, "host-a", 120);
let leaseConflict = false;
try {
  await service.lease(leaseInstanceId, "host-b", 120);
} catch (error) {
  leaseConflict = String(error?.message || error).toLowerCase().includes("lease");
}
record("gw4_lease_conflict", leaseConflict, { instanceId: leaseInstanceId });

const due = await service.listDueInstances(20);
const dueItems = Array.isArray(due.items) ? due.items : [];
record("list_due_instances", dueItems.some((item) => item?.id === leaseInstanceId), {
  due_count: dueItems.length,
  leaseInstanceId
});

const failed = evidence.steps.some((s) => !s.ok);
evidence.finished_at = new Date().toISOString();
evidence.status = failed ? "FAIL" : "PASS";
evidence.demo = demo;
await mkdir(evidenceDir, { recursive: true });
await writeFile(join(evidenceDir, "result.json"), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify({ status: evidence.status, demo, evidenceDir }, null, 2));
if (failed) process.exit(1);
