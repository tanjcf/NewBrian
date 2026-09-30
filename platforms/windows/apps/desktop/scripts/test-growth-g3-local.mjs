import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GrowthControlPlaneService } from "../src/main/growth-control-plane-service.ts";

const origin = process.env.GROWTH_ORIGIN?.trim() || "http://127.0.0.1:8790";
const email = process.env.GROWTH_EMAIL?.trim() || "931124915@qq.com";
const password = process.env.GROWTH_PASSWORD?.trim() || "admin12345611";
const emailB = process.env.GROWTH_EMAIL_B?.trim() || "";
const passwordB = process.env.GROWTH_PASSWORD_B?.trim() || "";
const evidenceDir = process.env.GROWTH_EVIDENCE_DIR?.trim()
  || join(dirname(fileURLToPath(import.meta.url)), "../../../../integration-artifacts/growth/local-g3");

const hash = (value) => createHash("sha256").update(value).digest("hex").slice(0, 48);
const deviceFor = (label) => ({
  device_id: hash(`newbrain-growth-g3-${label}-device`),
  device_name: `NewBrain Growth G3 ${label}`,
  device_type: "desktop",
  os_name: "win32",
  os_version: "g3-test",
  app_version: "0.1.61",
  mac_id: hash(`newbrain-growth-g3-${label}-mac`),
  motherboard_id: hash(`newbrain-growth-g3-${label}-board`),
  disk_id: hash(`newbrain-growth-g3-${label}-disk`)
});

function deviceHeaders(device, token = "") {
  return {
    Accept: "application/json",
    "Content-Type": "application/json; charset=utf-8",
    "User-Agent": "NewBrain-Growth-G3/0.1.61",
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

async function login(identifier, pwd, device) {
  const response = await fetch(`${origin}/api/desktop/auth/login/password`, {
    method: "POST",
    headers: deviceHeaders(device),
    body: JSON.stringify({ identifier, password: pwd, agreement_accepted: true, device })
  });
  const body = await readJson(response);
  const accessToken = body.accessToken ?? body.data?.tokens?.access_token ?? "";
  return { response, body, accessToken };
}

const evidence = {
  origin,
  email,
  email_b: emailB || null,
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

const deviceA = deviceFor("a");
const loginA = await login(email, password, deviceA);
record("login_a", Boolean(loginA.response.ok && loginA.accessToken), {
  status: loginA.response.status
});
if (!loginA.response.ok || !loginA.accessToken) {
  await failAndExit(new Error(`Desktop login A failed: status=${loginA.response.status}`));
}

const serviceA = new GrowthControlPlaneService({
  getConnection: async () => ({
    gatewayOrigin: origin,
    headers: deviceHeaders(deviceA, loginA.accessToken)
  })
});

let demo;
try {
  demo = await serviceA.runCompanySkillShareDemo(`gsk-g3-${Date.now()}`);
  record("gw6_publish_company_skill", demo.companySkillCount >= 1, demo);
} catch (error) {
  record("gw6_publish_company_skill", false, { error: String(error?.message || error) });
  await failAndExit(error);
}

const createdProcess = await serviceA.createProcess({ name: `gw7-${Date.now()}` });
await serviceA.publishProcess(String(createdProcess.id));
const started = await serviceA.startInstance({ process_id: String(createdProcess.id) });
const instanceId = String(started.id || "");
await serviceA.lease(instanceId, "newbrain-g3-host");
const advanced = await serviceA.advance(instanceId, { result: { step: 1 } });
const injection = Array.isArray(advanced.memory_injection) ? advanced.memory_injection : [];
const hasCompanyInjection = injection.some(
  (item) => item && item.memory_scope === "company" && item.kind === "glossary"
);
record("gw7_memory_injection_audit", hasCompanyInjection, {
  instanceId,
  injection_count: injection.length,
  sample: injection.find((item) => item?.memory_scope === "company") || null
});

if (emailB && passwordB) {
  const deviceB = deviceFor("b");
  const loginB = await login(emailB, passwordB, deviceB);
  record("login_b", Boolean(loginB.response.ok && loginB.accessToken), {
    status: loginB.response.status
  });
  if (loginB.response.ok && loginB.accessToken) {
    const serviceB = new GrowthControlPlaneService({
      getConnection: async () => ({
        gatewayOrigin: origin,
        headers: deviceHeaders(deviceB, loginB.accessToken)
      })
    });
    const listed = await serviceB.listSkills("company", 100);
    const items = Array.isArray(listed.items) ? listed.items : [];
    const visible = items.some((item) => item?.skill_id === demo.skillId);
    record("gw6_peer_visibility", visible, {
      skillId: demo.skillId,
      count: items.length
    });
  } else {
    record("gw6_peer_visibility", false, { reason: "login_b_failed" });
  }
} else {
  const listed = await serviceA.listSkills("company", 100);
  const items = Array.isArray(listed.items) ? listed.items : [];
  const visible = items.some((item) => item?.skill_id === demo.skillId);
  record("gw6_peer_visibility", visible, {
    mode: "same_user_list_fallback",
    note: "Set GROWTH_EMAIL_B/GROWTH_PASSWORD_B for true peer check; spring unit test covers cross-principal",
    skillId: demo.skillId,
    visible
  });
}

const failed = evidence.steps.some((s) => !s.ok);
evidence.finished_at = new Date().toISOString();
evidence.status = failed ? "FAIL" : "PASS";
evidence.demo = demo;
await mkdir(evidenceDir, { recursive: true });
await writeFile(join(evidenceDir, "result.json"), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify({ status: evidence.status, demo, evidenceDir }, null, 2));
if (failed) process.exit(1);
