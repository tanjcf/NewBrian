import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GrowthControlPlaneService } from "../src/main/growth-control-plane-service.ts";

const origin = process.env.GROWTH_ORIGIN?.trim() || "http://127.0.0.1:8790";
const email = process.env.GROWTH_EMAIL?.trim() || "931124915@qq.com";
const password = process.env.GROWTH_PASSWORD?.trim() || "admin12345611";
const evidenceDir = process.env.GROWTH_EVIDENCE_DIR?.trim()
  || join(dirname(fileURLToPath(import.meta.url)), "../../../integration-artifacts/growth/local-g1");

const hash = (value) => createHash("sha256").update(value).digest("hex").slice(0, 48);
const device = {
  device_id: hash("newbrain-growth-g1-device"),
  device_name: "NewBrain Growth G1",
  device_type: "desktop",
  os_name: "win32",
  os_version: "g1-test",
  app_version: "0.1.61",
  mac_id: hash("newbrain-growth-g1-mac"),
  motherboard_id: hash("newbrain-growth-g1-board"),
  disk_id: hash("newbrain-growth-g1-disk")
};

function deviceHeaders(token = "") {
  return {
    Accept: "application/json",
    "Content-Type": "application/json; charset=utf-8",
    "User-Agent": "NewBrain-Growth-G1/0.1.61",
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
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(join(evidenceDir, "result.json"), JSON.stringify({ ...evidence, status: "FAIL" }, null, 2));
  throw new Error(`Desktop login failed: status=${loginResponse.status}`);
}

const capsResponse = await fetch(`${origin}/api/desktop/v1/capabilities`, {
  headers: deviceHeaders(accessToken)
});
const caps = await readJson(capsResponse);
const fleet = caps.fleet ?? caps.data?.fleet ?? {};
record("capabilities_fleet", Boolean(capsResponse.ok && fleet.growth_enabled === true), {
  status: capsResponse.status,
  growth_enabled: fleet.growth_enabled,
  has_growth_read: Array.isArray(scopes) && scopes.includes("growth.read")
});

const service = new GrowthControlPlaneService({
  getConnection: async () => ({
    gatewayOrigin: origin,
    headers: deviceHeaders(accessToken)
  })
});

let demo;
try {
  demo = await service.runTwoAutoNodeDemo(`gw1-local-${Date.now()}`);
  record("gw1_two_auto_nodes", demo.finalStatus === "completed", demo);
} catch (error) {
  record("gw1_two_auto_nodes", false, { error: String(error?.message || error) });
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(join(evidenceDir, "result.json"), JSON.stringify({ ...evidence, status: "FAIL" }, null, 2));
  throw error;
}

const final = await service.getInstance(demo.instanceId);
record("get_instance", final.status === "completed" && Array.isArray(final.executions) && final.executions.length >= 2, {
  status: final.status,
  executions: final.executions?.length,
  cursor_node_id: final.cursor_node_id
});

const failed = evidence.steps.some((s) => !s.ok);
evidence.finished_at = new Date().toISOString();
evidence.status = failed ? "FAIL" : "PASS";
evidence.demo = demo;
await mkdir(evidenceDir, { recursive: true });
await writeFile(join(evidenceDir, "result.json"), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify({ status: evidence.status, demo, evidenceDir }, null, 2));
if (failed) process.exit(1);
