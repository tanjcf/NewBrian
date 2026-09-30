import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DRIVER = join(SCRIPT_DIR, "windows-installed-ui-driver.ps1");
const FORBIDDEN_ACTIONS = new Set(["evaluate", "cdp", "dom", "internalapi", "window.newbrain"]);
const ACTIONS = new Set([
  "maximize", "click", "clickpoint", "clickrelative", "type", "typepoint", "typerelative",
  "keys", "rawkeys", "screenshot", "assertvisible", "waitfile", "assertfile", "waitwindow",
  "closewindow", "launchapplication"
]);

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function requireString(value, field) {
  const result = text(value);
  if (!result) throw new Error(`${field} is required`);
  return result;
}

function workspaceRelativePath(value, field) {
  const result = requireString(value, field);
  if (isAbsolute(result)) throw new Error(`${field} must be workspace-relative`);
  const normalized = resolve("C:\\workspace", result);
  if (relative("C:\\workspace", normalized).startsWith("..")) {
    throw new Error(`${field} must be workspace-relative`);
  }
  return result;
}

function validateStep(step, index) {
  if (!step || typeof step !== "object" || Array.isArray(step)) throw new Error(`step ${index} must be an object`);
  const action = text(step.action).toLowerCase();
  if (FORBIDDEN_ACTIONS.has(action) || !ACTIONS.has(action)) throw new Error(`unsupported native UI action: ${step.action}`);
  if (["clickrelative", "typerelative"].includes(action)) {
    if (!Number.isFinite(step.x) || !Number.isFinite(step.y)) throw new Error(`step ${index} requires numeric x/y`);
  }
  if (["clickpoint", "typepoint"].includes(action)) {
    if (!Number.isFinite(step.x) || !Number.isFinite(step.y)) throw new Error(`step ${index} requires numeric x/y`);
  }
  if (["type", "typepoint", "typerelative", "keys", "rawkeys"].includes(action)) requireString(step.text, `step ${index}.text`);
  const hasRegion = step.region && typeof step.region === "object"
    && [step.region.x, step.region.y, step.region.width, step.region.height].every(Number.isFinite);
  if (["click", "type"].includes(action) && !text(step.name) && !text(step.automationId)) {
    throw new Error(`step ${index} requires name or automationId`);
  }
  if (action === "assertvisible" && !text(step.name) && !text(step.automationId) && !hasRegion) {
    throw new Error(`step ${index} requires name, automationId, or a screen region`);
  }
  if (hasRegion && (step.region.width <= 0 || step.region.height <= 0 || step.region.x < 0 || step.region.y < 0)) {
    throw new Error(`step ${index}.region must have non-negative x/y and positive width/height`);
  }
  if (["screenshot"].includes(action)) workspaceRelativePath(step.output, `step ${index}.output`);
  if (["waitfile", "assertfile"].includes(action)) workspaceRelativePath(step.path, `step ${index}.path`);
  if (action === "assertfile" && !Array.isArray(step.contains) && !text(step.sha256)) {
    throw new Error(`step ${index} requires contains or sha256`);
  }
  if (action === "waitwindow") requireString(step.title, `step ${index}.title`);
  return { ...step, action };
}

export function validateScenario(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("scenario must be an object");
  if (input.version !== 1) throw new Error("scenario.version must be 1");
  requireString(input.id, "scenario.id");
  const application = input.application;
  if (!application || typeof application !== "object") throw new Error("scenario.application is required");
  requireString(application.windowTitle, "application.windowTitle");
  if (!Array.isArray(application.processNames) || application.processNames.length === 0) {
    throw new Error("application.processNames is required");
  }
  const steps = Array.isArray(input.steps) ? input.steps.map(validateStep) : [];
  if (!steps.some((step) => step.action === "assertfile")) throw new Error("artifact assertion is required");
  if (!steps.some((step) => ["closewindow", "launchapplication", "waitwindow"].includes(step.action))) {
    throw new Error("restart recovery evidence is required");
  }
  if (steps.some((step) => step.action === "launchapplication")) requireString(application.executable, "application.executable");
  return { ...input, application: { ...application, processNames: [...application.processNames].map((item) => requireString(item, "application.processNames[]")) }, steps };
}

function invokeDriver({ processId, windowTitle, processName, action, step, evidenceDir }) {
  const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", DRIVER, "-Action", action, "-WindowTitle", windowTitle, "-ProcessName", processName || ""];
  if (processId) args.push("-ProcessId", String(processId));
  if (step.name) args.push("-Name", step.name);
  if (step.automationId) args.push("-AutomationId", step.automationId);
  if (step.text) args.push("-Text", step.text);
  if (Number.isFinite(step.x)) args.push("-X", String(step.x));
  if (Number.isFinite(step.y)) args.push("-Y", String(step.y));
  if (step.region) {
    args.push("-X", String(step.region.x), "-Y", String(step.region.y));
    args.push("-Width", String(step.region.width), "-Height", String(step.region.height));
    args.push("-MinForegroundRatio", String(step.minForegroundRatio ?? 0.002));
  }
  if (step.output) args.push("-OutputPath", resolve(evidenceDir, step.output));
  const result = spawnSync("powershell.exe", args, { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw new Error(`native UI driver failed for ${action}: ${(result.stderr || result.stdout || "").trim()}`);
  return result.stdout.trim();
}

async function waitUntil(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function findProcess(application) {
  const names = application.processNames.map((name) => `'${name.replaceAll("'", "''")}'`).join(",");
  const command = `$names=@(${names}); Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and ($names -contains $_.ProcessName -or $names -contains $_.ProcessName.Replace('.exe','')) } | Select-Object -First 1 Id,ProcessName,MainWindowTitle`;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", command], { encoding: "utf8", windowsHide: true });
  const line = result.stdout.trim().split(/\r?\n/).filter(Boolean).pop();
  if (!line) return null;
  const match = line.match(/^\s*(\d+)\s+(\S+)\s+(.*)$/);
  return match ? { id: Number(match[1]), processName: match[2], title: match[3].trim() } : null;
}

function processExists(processId) {
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-Command", `if (Get-Process -Id ${Number(processId)} -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }`],
    { encoding: "utf8", windowsHide: true }
  );
  return result.status === 0;
}

async function assertFile(workspacePath, step) {
  const path = resolve(workspacePath, step.path);
  const info = await stat(path);
  if (!info.isFile()) throw new Error(`artifact is not a file: ${step.path}`);
  const content = await readFile(path);
  for (const required of step.contains ?? []) {
    if (!content.toString("utf8").includes(String(required))) throw new Error(`artifact missing required text: ${required}`);
  }
  if (step.sha256) {
    const actual = createHash("sha256").update(content).digest("hex");
    if (actual.toLowerCase() !== String(step.sha256).toLowerCase()) throw new Error(`artifact sha256 mismatch for ${step.path}`);
  }
}

async function runStep(step, context) {
  const { scenario, workspacePath, evidenceDir } = context;
  const application = scenario.application;
  if (step.action === "assertvisible") {
    invokeDriver({ ...context, action: step.region ? "assertregion" : "assertvisible", step });
    return;
  }
  if (step.action === "waitfile") {
    await waitUntil(() => stat(resolve(workspacePath, step.path)).then((item) => item.isFile()).catch(() => false), step.timeoutMs ?? 60_000, `artifact ${step.path}`);
    return;
  }
  if (step.action === "assertfile") return assertFile(workspacePath, step);
  if (step.action === "waitwindow") {
    await waitUntil(async () => {
      const process = await findProcess(application);
      return Boolean(process && process.title.includes(step.title));
    }, step.timeoutMs ?? 30_000, `window ${step.title}`);
    context.process = await findProcess(application);
    return;
  }
  if (step.action === "closewindow") {
    if (!context.process?.id) throw new Error("cannot close window before a process is selected");
    const closingProcessId = context.process.id;
    invokeDriver({
      ...context,
      processId: closingProcessId,
      action: "rawkeys",
      step: { text: "ALT+F4" }
    });
    await waitUntil(
      () => !processExists(closingProcessId),
      step.timeoutMs ?? 10_000,
      `application process ${closingProcessId} to close after Alt+F4`
    );
    context.process = null;
    return;
  }
  if (step.action === "launchapplication") {
    const executable = resolve(process.cwd(), application.executable);
    const result = spawn(executable, application.arguments ?? [], { cwd: dirname(executable), detached: true, stdio: "ignore", windowsHide: false });
    result.unref();
    return;
  }
  const action = step.action === "clickrelative" ? "clickrelative"
    : step.action === "clickpoint" ? "clickpoint"
      : step.action === "typerelative" ? "typerelative"
        : step.action === "typepoint" ? "typepoint"
          : step.action === "rawkeys" ? "rawkeys"
            : step.action;
  invokeDriver({ ...context, processId: context.process?.id, windowTitle: application.windowTitle, processName: application.processNames[0], action, step, evidenceDir });
}

export async function runScenario(input, options = {}) {
  const scenario = validateScenario(input);
  const workspacePath = resolve(options.workspacePath ?? process.cwd());
  const evidenceDir = resolve(options.evidenceDir ?? join(workspacePath, "integration-artifacts", scenario.id));
  await mkdir(evidenceDir, { recursive: true });
  const context = { scenario, workspacePath, evidenceDir, process: options.processId ? { id: Number(options.processId) } : await findProcess(scenario.application) };
  if (!context.process) throw new Error("visible NewBrain window not found");
  const evidence = { status: "RUNNING", id: scenario.id, startedAt: new Date().toISOString(), steps: [] };
  try {
    for (let index = 0; index < scenario.steps.length; index += 1) {
      const step = scenario.steps[index];
      const startedAt = Date.now();
      await runStep(step, context);
      evidence.steps.push({ index, action: step.action, durationMs: Date.now() - startedAt });
      if (step.afterMs) await new Promise((resolvePromise) => setTimeout(resolvePromise, step.afterMs));
    }
    evidence.status = "PASS";
  } catch (error) {
    evidence.status = "FAIL";
    evidence.failure = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    evidence.finishedAt = new Date().toISOString();
    await import("node:fs/promises").then(({ writeFile }) => writeFile(join(evidenceDir, "result.json"), `${JSON.stringify(evidence, null, 2)}\n`, "utf8"));
  }
  return evidence;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const scenarioPath = process.argv[2];
  if (!scenarioPath) throw new Error("usage: node native-ui-scenario.mjs <scenario.json> [workspacePath] [evidenceDir]");
  const scenario = JSON.parse(await readFile(resolve(scenarioPath), "utf8"));
  await runScenario(scenario, { workspacePath: process.argv[3], evidenceDir: process.argv[4], processId: process.env.NEWBRAIN_NATIVE_UI_PROCESS_ID });
}
