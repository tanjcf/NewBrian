import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GrowthControlPlaneService } from "../src/main/growth-control-plane-service.ts";

const origin = process.env.GROWTH_ORIGIN?.trim() || "http://127.0.0.1:8790";
const email = process.env.GROWTH_EMAIL?.trim() || "931124915@qq.com";
const password = process.env.GROWTH_PASSWORD?.trim() || "admin12345611";
const evidenceDir = process.env.GROWTH_EVIDENCE_DIR?.trim()
  || join(dirname(fileURLToPath(import.meta.url)), "../../../../integration-artifacts/growth/local-g4");

const hash = (value) => createHash("sha256").update(value).digest("hex").slice(0, 48);
const device = {
  device_id: hash("newbrain-growth-g4-device"),
  device_name: "NewBrain Growth G4",
  device_type: "desktop",
  os_name: "win32",
  os_version: "g4-test",
  app_version: "0.1.61",
  mac_id: hash("newbrain-growth-g4-mac"),
  motherboard_id: hash("newbrain-growth-g4-board"),
  disk_id: hash("newbrain-growth-g4-disk")
};

function deviceHeaders(token = "") {
  return {
    Accept: "application/json",
    "Content-Type": "application/json; charset=utf-8",
    "User-Agent": "NewBrain-Growth-G4/0.1.61",
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

const secret = `gw8-secret-${Date.now()}-do-not-leak`;
let demo;
try {
  demo = await service.runHttpConnectorSolidifyDemo(secret);
  record("gw8_connector_solidify_no_secret_leak", demo.probeOk && !demo.secretLeaked, demo);
} catch (error) {
  record("gw8_connector_solidify_no_secret_leak", false, { error: String(error?.message || error) });
  await failAndExit(error);
}

const listed = await service.listConnectors(50);
const items = Array.isArray(listed.items) ? listed.items : [];
const listedOk = items.some((item) => item?.id === demo.connectorId)
  && !JSON.stringify(listed).includes(secret);
record("list_connectors_redacted", listedOk, {
  count: items.length,
  connectorId: demo.connectorId
});

const skills = await service.listSkills("company", 100);
const skillItems = Array.isArray(skills.items) ? skills.items : [];
const reusable = skillItems.some((item) => item?.skill_id === demo.skillId);
record("connector_skill_reusable", reusable, {
  skillId: demo.skillId,
  company_count: skillItems.length
});

// Attach probe into auto node result to mimic rollout audit surface.
const processDef = await service.createProcess({ name: `gw8-proc-${Date.now()}` });
await service.publishProcess(String(processDef.id));
const started = await service.startInstance({ process_id: String(processDef.id) });
const instanceId = String(started.id || "");
await service.lease(instanceId, "newbrain-g4-host");
const probe = await service.probeConnector(demo.connectorId);
const advanced = await service.advance(instanceId, { result: { connector_probe: probe } });
const advanceBlob = JSON.stringify(advanced);
record("gw8_advance_audit_no_secret", !advanceBlob.includes(secret) && probe.ok === true, {
  instanceId,
  status: advanced.status
});

const failed = evidence.steps.some((s) => !s.ok);
evidence.finished_at = new Date().toISOString();
evidence.status = failed ? "FAIL" : "PASS";
evidence.demo = demo;
await mkdir(evidenceDir, { recursive: true });
await writeFile(join(evidenceDir, "result.json"), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify({ status: evidence.status, demo, evidenceDir }, null, 2));
if (failed) {
  globalThis.process.exit(1);
}
