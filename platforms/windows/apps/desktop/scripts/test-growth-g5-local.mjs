import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GrowthControlPlaneService } from "../src/main/growth-control-plane-service.ts";

const origin = process.env.GROWTH_ORIGIN?.trim() || "http://127.0.0.1:8790";
const email = process.env.GROWTH_EMAIL?.trim() || "931124915@qq.com";
const password = process.env.GROWTH_PASSWORD?.trim() || "admin12345611";
const evidenceDir = process.env.GROWTH_EVIDENCE_DIR?.trim()
  || join(dirname(fileURLToPath(import.meta.url)), "../../../../integration-artifacts/growth/local-g5");

const hash = (value) => createHash("sha256").update(value).digest("hex").slice(0, 48);
const device = {
  device_id: hash("newbrain-growth-g5-device"),
  device_name: "NewBrain Growth G5",
  device_type: "desktop",
  os_name: "win32",
  os_version: "g5-test",
  app_version: "0.1.61",
  mac_id: hash("newbrain-growth-g5-mac"),
  motherboard_id: hash("newbrain-growth-g5-board"),
  disk_id: hash("newbrain-growth-g5-disk")
};

function deviceHeaders(token = "") {
  return {
    Accept: "application/json",
    "Content-Type": "application/json; charset=utf-8",
    "User-Agent": "NewBrain-Growth-G5/0.1.61",
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

const templates = await service.listTemplates();
const templateIds = templates.map((item) => String(item.id || "")).filter(Boolean);
const expected = ["case01-influencer", "case02-restaurant", "case03-retail"];
const gw3 = expected.every((id) => templateIds.includes(id)) && templateIds.length >= 3;
record("gw3_templates_listed", gw3, { templateIds });

for (const templateId of expected) {
  try {
    const imported = await service.importTemplate(templateId);
    record(`gw3_import_${templateId}`, Boolean(imported.id), {
      processId: imported.id,
      status: imported.status
    });
  } catch (error) {
    record(`gw3_import_${templateId}`, false, { error: String(error?.message || error) });
    await failAndExit(error);
  }
}

let case01;
try {
  case01 = await service.runCaseAsyncHumanDemo("case01-influencer");
  record("gw10_case01_async_human_completed", case01.finalStatus === "completed" && case01.sawAsync && case01.sawHuman, case01);
} catch (error) {
  record("gw10_case01_async_human_completed", false, { error: String(error?.message || error) });
  await failAndExit(error);
}

let case02;
try {
  case02 = await service.runCaseAsyncHumanDemo("case02-restaurant");
  record("gw11_case02_async_human_completed", case02.finalStatus === "completed" && case02.sawAsync, case02);
} catch (error) {
  record("gw11_case02_async_human_completed", false, { error: String(error?.message || error) });
  await failAndExit(error);
}

let case03;
try {
  case03 = await service.runCaseAsyncHumanDemo("case03-retail");
  record("gw12_case03_human_completed", case03.finalStatus === "completed" && case03.sawHuman, case03);
} catch (error) {
  record("gw12_case03_human_completed", false, { error: String(error?.message || error) });
  await failAndExit(error);
}

const failed = evidence.steps.some((s) => !s.ok);
evidence.finished_at = new Date().toISOString();
evidence.status = failed ? "FAIL" : "PASS";
evidence.demos = { case01, case02, case03 };
await mkdir(evidenceDir, { recursive: true });
await writeFile(join(evidenceDir, "result.json"), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify({ status: evidence.status, demos: evidence.demos, evidenceDir }, null, 2));
if (failed) {
  globalThis.process.exit(1);
}
