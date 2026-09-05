import { mkdir, writeFile, readFile, copyFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";

const execFileAsync = promisify(execFile);
const repo = resolve("I:/G盘迁移备份/workrpase/BRAIN");
const sourceRun = resolve(repo, "evidence/EXPLORE-E2E/2026-08-25T04-40-45-488Z");
const raw = JSON.parse(await readFile(resolve(sourceRun, "evidence.json"), "utf8"));

const chatText = raw.steps?.afterChat?.text || "";
const globalNav = raw.steps?.afterChat?.globalNav || [];
const fileCount = Number((globalNav.find((t) => t.startsWith("文件")) || "文件 0").replace(/[^\d]/gu, "") || "0");
const artifactCount = Number((globalNav.find((t) => t.startsWith("产物")) || "产物 0").replace(/[^\d]/gu, "") || "0");
const taskCount = Number((globalNav.find((t) => t.startsWith("任务")) || "任务 0").replace(/[^\d]/gu, "") || "0");
const chatClaimsCreate = /文件已创建成功/.test(chatText);
const hasFakeTabs = Boolean(raw.finalState?.hasFakeTabs);
const selectedExplore = raw.finalState?.selected === "explore";
const noSceneNav = !(raw.finalState?.sceneNav || []).length;
const diskHits = [];
for (const root of [resolve(process.env.USERPROFILE || "", ".codecn"), repo]) {
  // shallow check only via powershell limited depth already returned none; record explicit miss
}
const noteExists = existsSync(resolve(process.env.USERPROFILE || "", ".codecn", "explore-e2e-note.txt"));

const assertions = [
  { name: "selected-explore", passed: selectedExplore, actual: raw.finalState?.selected },
  { name: "no-fake-scene-tools", passed: !hasFakeTabs },
  { name: "global-nav-files-artifacts-tasks", passed: ["文件", "产物", "任务"].every((l) => (raw.finalState?.globalNav || []).some((t) => t.startsWith(l))), actual: raw.finalState?.globalNav },
  { name: "no-scene-capability-nav", passed: noSceneNav, actual: raw.finalState?.sceneNav },
  { name: "persist-selected-explore-after-reload", passed: raw.steps?.afterReload?.selected === "explore", actual: raw.steps?.afterReload?.selected },
  { name: "native-panel-after-reload", passed: !raw.steps?.afterReload?.hasFakeTabs && !(raw.steps?.afterReload?.sceneNav || []).length },
  { name: "right-panel-file-count-gt-0", passed: fileCount > 0, actual: fileCount },
  { name: "right-panel-artifact-or-task-gt-0", passed: artifactCount > 0 || taskCount > 0, actual: { artifactCount, taskCount } },
  { name: "chat-claim-matches-panel", passed: !(chatClaimsCreate && fileCount === 0), detail: chatClaimsCreate ? "chat claimed file create but panel files=0" : "no create claim" },
  { name: "disk-explore-e2e-note", passed: noteExists, actual: noteExists ? "found" : "not found under ~/.codecn/explore-e2e-note.txt" },
  { name: "full-process-restart", passed: false, detail: "Electron process kill blocked by policy; only Page.reload performed" }
];

const layoutOk = assertions.filter((a) => [
  "selected-explore", "no-fake-scene-tools", "global-nav-files-artifacts-tasks", "no-scene-capability-nav", "native-panel-after-reload"
].includes(a.name)).every((a) => a.passed);

const sideEffectOk = assertions.filter((a) => [
  "right-panel-file-count-gt-0", "chat-claim-matches-panel", "disk-explore-e2e-note"
].includes(a.name)).every((a) => a.passed);

let result = "FAIL";
if (layoutOk && sideEffectOk && assertions.find((a) => a.name === "right-panel-artifact-or-task-gt-0")?.passed) result = "PASS";
else if (layoutOk) result = "PARTIAL";

const firstFailure = assertions.filter((a) => !a.passed).map((a) => `${a.name}:${a.detail || JSON.stringify(a.actual)}`).join(" | ");

const outDir = resolve(repo, "evidence/EXPLORE-E2E", `${new Date().toISOString().replace(/[:.]/gu, "-")}-verdict`);
await mkdir(outDir, { recursive: true });
for (const shot of raw.screenshots || []) {
  const src = resolve(sourceRun, shot);
  if (existsSync(src)) await copyFile(src, resolve(outDir, shot));
}

const evidence = {
  caseId: "EXPLORE-E2E",
  timestamp: new Date().toISOString(),
  environment: {
    repository: repo,
    platform: process.platform,
    port: 9356,
    mode: "explore-formal-e2e-verdict",
    runtime: ".materialized/windows/apps/desktop",
    sourceEvidence: sourceRun
  },
  summary: {
    layout: layoutOk ? "PASS" : "FAIL",
    sideEffects: sideEffectOk ? "PASS" : "FAIL",
    chatClaimedFileCreate: chatClaimsCreate,
    rightPanel: { fileCount, artifactCount, taskCount },
    restart: "reload-only"
  },
  actions: raw.actions,
  assertions,
  result,
  firstFailure,
  screenshots: raw.screenshots,
  steps: raw.steps,
  finalState: raw.finalState,
  verdictNotes: [
    "场景切换与原生右侧面板（文件/产物/任务、无场景知识/可用工具）已用真实键鼠验证通过。",
    "对话声称已创建 explore-e2e-note.txt，但右侧文件计数仍为 0，且未在 ~/.codecn 浅层找到该文件。",
    "产物/任务均未产生可见记录。",
    "完整进程重启因策略阻止未能执行，仅验证 Page.reload 后仍保持 explore + 原生面板。",
    "按正式提示词：布局正确但闭环不完整 => PARTIAL。"
  ]
};

const evidencePath = resolve(outDir, "evidence.json");
await writeFile(evidencePath, JSON.stringify(evidence, null, 2), "utf8");

// validate if available
const validator = "C:/Users/Administrator/.codex/skills/codecn-electron-e2e-operator/scripts/validate-evidence.mjs";
let validation = null;
if (existsSync(validator)) {
  try {
    const { stdout, stderr } = await execFileAsync("node", [validator, evidencePath], { windowsHide: true });
    validation = { stdout: String(stdout), stderr: String(stderr) };
  } catch (error) {
    validation = { error: error instanceof Error ? error.message : String(error), stdout: error.stdout?.toString?.(), stderr: error.stderr?.toString?.() };
  }
}

console.log(JSON.stringify({ evidencePath, result, firstFailure, validation }, null, 2));
