import { promises as fs } from "node:fs";
import { extname, join, relative } from "node:path";
import process from "node:process";

const root = process.cwd();
const sourceExtensions = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx"]);
const violations = [];

async function sourceFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return sourceExtensions.has(extname(entry.name)) ? [path] : [];
  }));
  return nested.flat();
}

function addViolation(file, rule, detail) {
  violations.push(`${relative(root, file)}: ${rule}: ${detail}`);
}

function importedSpecifiers(source) {
  const matches = source.matchAll(/(?:from\s+|import\s*\(|require\s*\()\s*["']([^"']+)["']/g);
  return [...matches].map((match) => match[1]);
}

const rendererRoot = join(root, "apps", "desktop", "src", "renderer");
for (const file of await sourceFiles(rendererRoot)) {
  if (/\.test\.(?:[cm]?js|tsx?)$/.test(file)) continue;
  const source = await fs.readFile(file, "utf8");
  for (const specifier of importedSpecifiers(source)) {
    if (specifier === "electron" || specifier.startsWith("node:")) {
      addViolation(file, "renderer-privilege-boundary", `forbidden import ${specifier}`);
    }
    if (/src\/(?:main|preload)(?:\/|$)|apps\/agentd(?:\/|$)/.test(specifier.replaceAll("\\", "/"))) {
      addViolation(file, "renderer-layer-boundary", `forbidden cross-layer import ${specifier}`);
    }
  }
}

for (const directory of [join(root, "apps"), join(root, "packages")]) {
  for (const file of await sourceFiles(directory)) {
    const source = await fs.readFile(file, "utf8");
    for (const specifier of importedSpecifiers(source)) {
      const isExportedProtocolSubpath = specifier === "@codex-forge/protocol/session-machine";
      if (/^@codex-forge\/(?:protocol|ui)\//.test(specifier) && !isExportedProtocolSubpath) {
        addViolation(file, "package-public-api", `deep package import ${specifier}`);
      }
    }
  }
}

const preloadPath = join(root, "apps", "desktop", "src", "preload", "index.ts");
const preloadSource = await fs.readFile(preloadPath, "utf8");
if (/\b(?:send|invoke|on):\s*ipcRenderer\./.test(preloadSource)) {
  addViolation(preloadPath, "preload-capability-boundary", "raw ipcRenderer method exposed through contextBridge");
}

function capturedValues(source, pattern) {
  return new Set([...source.matchAll(pattern)].map((match) => match[1]));
}

const mainPath = join(root, "apps", "desktop", "src", "main", "index.ts");
const mainSource = await fs.readFile(mainPath, "utf8");
const mainLines = mainSource.split(/\r?\n/).length;
if (mainLines > 7_100) {
  addViolation(mainPath, "main-composition-size", `desktop entry point has ${mainLines} lines; maximum is 7100`);
}
const registerIpcStart = mainSource.indexOf("function registerIpc()");
const registerIpcEnd = mainSource.indexOf("\napp.whenReady()", registerIpcStart);
if (registerIpcStart < 0 || registerIpcEnd < 0) {
  addViolation(mainPath, "ipc-composition-root", "registerIpc composition root was not found");
} else {
  const registerIpcSource = mainSource.slice(registerIpcStart, registerIpcEnd);
  const registerIpcLines = registerIpcSource.split(/\r?\n/).length;
  if (registerIpcLines > 520) {
    addViolation(mainPath, "ipc-composition-size", `registerIpc has ${registerIpcLines} lines; maximum is 520`);
  }
  const nestedBody = registerIpcSource.slice(registerIpcSource.indexOf("{") + 1);
  if (/\b(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(/.test(nestedBody)) {
    addViolation(mainPath, "ipc-nested-business-function", "registerIpc must not declare nested named functions");
  }
  for (const [pattern, detail] of [
    [/\bstartAgentLoop\s*\(/, "agent-loop startup"],
    [/\badvanceAgentLoop\s*\(/, "agent-loop advancement"],
    [/\bappendRolloutRecords\s*\(/, "rollout persistence"],
    [/\bbuildModelChatResult\s*\(\s*\{/, "model result construction"],
    [/\bselectModelChatSkills\s*\(\s*\{/, "model skill selection"]
  ]) {
    if (pattern.test(registerIpcSource)) {
      addViolation(mainPath, "ipc-model-business-boundary", `${detail} must live outside registerIpc`);
    }
  }
  if (!/registerModelChatIpcHandlers\(\{\s*chat:\s*\(event, input\)\s*=>\s*modelChatService\.chat\(event\.sender, input\)/.test(registerIpcSource)) {
    addViolation(mainPath, "ipc-model-service-boundary", "model chat IPC must delegate to ModelChatService");
  }
}
for (const serviceImport of [
  "BootstrapStateService",
  "EnvironmentDiscoveryService",
  "ManagedCondaInstallerService",
  "runBoundedEnvironmentCommand"
]) {
  if (!mainSource.includes(serviceImport)) {
    addViolation(mainPath, "environment-service-boundary", `missing ${serviceImport} composition`);
  }
}
for (const forbiddenDefinition of [
  "getSystemCondaCandidatePaths",
  "getSystemNodeCandidatePaths",
  "detectCommandPath",
  "resolvePreferredCondaExecutable",
  "getManagedCondaInstallerSpec",
  "readBootstrapConfig",
  "readDesktopBootstrapState",
  "writeDesktopBootstrapState",
  "ensureManagedCondaInstalled"
]) {
  if (new RegExp(`(?:async\\s+)?function\\s+${forbiddenDefinition}\\s*\\(`).test(mainSource)) {
    addViolation(mainPath, "environment-service-boundary", `${forbiddenDefinition} must live outside index.ts`);
  }
}
const bootstrapRuntimeStart = mainSource.indexOf("async function ensureDesktopCondaInitialized()");
const bootstrapRuntimeEnd = mainSource.indexOf("async function ensureWorkspaceThreads(", bootstrapRuntimeStart);
if (bootstrapRuntimeStart < 0 || bootstrapRuntimeEnd < 0) {
  addViolation(mainPath, "environment-process-boundary", "bootstrap runtime region was not found");
} else if (/\bspawnSync\s*\(/.test(mainSource.slice(bootstrapRuntimeStart, bootstrapRuntimeEnd))) {
  addViolation(mainPath, "environment-process-boundary", "bootstrap runtime must use bounded asynchronous commands");
}
const managedCondaInstallerPath = join(root, "apps", "desktop", "src", "main", "managed-conda-installer-service.ts");
const managedCondaInstallerSource = await fs.readFile(managedCondaInstallerPath, "utf8");
for (const [pattern, detail] of [
  [/input\.signal\?\.addEventListener\("abort"/, "abort listener"],
  [/setTimeout\(\(\) => stop\(/, "bounded timeout"],
  [/MAX_CAPTURED_OUTPUT/, "bounded output"],
  [/windowsHide:\s*true/, "hidden child window"]
]) {
  if (!pattern.test(managedCondaInstallerSource)) {
    addViolation(managedCondaInstallerPath, "environment-process-safety", `missing ${detail}`);
  }
}
for (const serviceImport of [
  "ThreadStateService",
  "WorkspaceThreadLifecycleService",
  "WorkspaceWorktreeService",
  "ThreadRolloutLifecycleService",
  "ThreadRolloutRecoveryService"
]) {
  if (!mainSource.includes(serviceImport)) {
    addViolation(mainPath, "workspace-thread-service-boundary", `missing ${serviceImport} composition`);
  }
}
for (const forbiddenDefinition of ["readWorktreeBindings", "writeWorktreeBindings"]) {
  if (new RegExp(`(?:async\\s+)?function\\s+${forbiddenDefinition}\\s*\\(`).test(mainSource)) {
    addViolation(mainPath, "worktree-service-boundary", `${forbiddenDefinition} must live outside index.ts`);
  }
}
if (/spawnSync\(\s*["']git["']\s*,\s*\[\s*["']worktree["']/.test(mainSource)) {
  addViolation(mainPath, "worktree-process-boundary", "Git worktree commands must use bounded asynchronous execution");
}
for (const delegation of [
  /return\s+threadStateService\.read\(workspace, thread\)/,
  /return\s+workspaceThreadLifecycleService\.add\(input\)/,
  /return\s+workspaceThreadLifecycleService\.fork\(input\)/,
  /return\s+threadRolloutLifecycleService\.setArchived\(input\)/
]) {
  if (!delegation.test(mainSource)) {
    addViolation(mainPath, "workspace-thread-service-boundary", `missing required service delegation ${delegation}`);
  }
}
for (const serviceImport of [
  "DelegatedAgentControlService",
  "DelegatedAgentIpcService",
  "runDelegatedAgentLoop",
  "DelegatedAgentRunService"
]) {
  if (!mainSource.includes(serviceImport)) {
    addViolation(mainPath, "delegated-agent-service-boundary", `missing ${serviceImport} composition`);
  }
}
for (const method of [
  "startAgentLoop",
  "advanceAgentLoop",
  "restoreAgentLoop",
  "resumeAgentApproval"
]) {
  if (new RegExp(`\\.${method}\\s*\\(`).test(mainSource)) {
    addViolation(
      mainPath,
      "agent-loop-host-ownership",
      `${method} must be invoked by a bounded service through the Agent Host runtime adapter`
    );
  }
}
for (const forbiddenState of [
  "delegatedAgentRuns",
  "delegatedAgentFollowups",
  "delegatedAgentAbortControllers",
  "delegatedAgentApprovalWaiters",
  "delegatedAgentApprovalDecisions"
]) {
  if (new RegExp(`\\b${forbiddenState}\\b`).test(mainSource)) {
    addViolation(mainPath, "delegated-agent-control-boundary", `${forbiddenState} must live in DelegatedAgentControlService`);
  }
}
if (!/list:\s*\(input\)\s*=>\s*delegatedAgentIpcService\.list\(input\)/.test(mainSource)
  || !/respondApproval:\s*\(input\)\s*=>\s*delegatedAgentIpcService\.respondApproval\(input\)/.test(mainSource)) {
  addViolation(mainPath, "delegated-agent-ipc-boundary", "collaboration IPC must delegate to DelegatedAgentIpcService");
}
for (const serviceImport of [
  "ComposerAttachmentService",
  "DesktopArtifactPreviewService",
  "BrowserPreviewService"
]) {
  if (!mainSource.includes(serviceImport)) {
    addViolation(mainPath, "desktop-capability-service-boundary", `missing ${serviceImport} composition`);
  }
}
for (const forbiddenDefinition of [
  "selectComposerImages",
  "storeComposerAttachment",
  "openComposerAttachment",
  "makeComposerAttachmentUrl",
  "makeComposerPreviewUrl"
]) {
  if (new RegExp(`(?:async\\s+)?function\\s+${forbiddenDefinition}\\s*\\(`).test(mainSource)) {
    addViolation(mainPath, "composer-attachment-boundary", `${forbiddenDefinition} must live outside index.ts`);
  }
}
if (!/selectAttachments:\s*\(\)\s*=>\s*composerAttachmentService\.select\(\)/.test(mainSource)
  || !/openAttachment:\s*\(input\)\s*=>\s*composerAttachmentService\.open\(input\)/.test(mainSource)
  || !/saveClipboardFile:\s*\(input\)\s*=>\s*composerAttachmentService\.saveClipboard\(input\)/.test(mainSource)) {
  addViolation(mainPath, "composer-attachment-boundary", "composer IPC must delegate to ComposerAttachmentService");
}
if (/\(targetRuntime\s+as\s+any\)\.artifacts/.test(mainSource)) {
  addViolation(mainPath, "artifact-runtime-contract", "artifact rendering must use the typed runtime contract");
}
if (!/return\s+previewService\.render\(input\)/.test(mainSource)) {
  addViolation(mainPath, "artifact-preview-boundary", "artifact.render must delegate to DesktopArtifactPreviewService");
}
if (!/return\s+normalizeBrowserPreviewUrl\(value\)/.test(mainSource)) {
  addViolation(mainPath, "browser-preview-boundary", "browser navigation must use canonical URL validation");
}
for (const serviceImport of ["DesktopNativeCapabilityService", "WorkspaceFileService"]) {
  if (!mainSource.includes(serviceImport)) {
    addViolation(mainPath, "desktop-native-service-boundary", `missing ${serviceImport} composition`);
  }
}
for (const forbiddenDefinition of [
  "openWorkspaceLocation",
  "openSkillLocation",
  "openLogLocation",
  "openSystemTool",
  "searchWorkspaceFiles",
  "readWorkspaceFile",
  "openWorkspaceFile"
]) {
  if (new RegExp(`(?:async\\s+)?function\\s+${forbiddenDefinition}\\s*\\(`).test(mainSource)) {
    addViolation(mainPath, "desktop-native-service-boundary", `${forbiddenDefinition} must live outside index.ts`);
  }
}
for (const [pattern, detail] of [
  [/openLocation:\s*\(input\)\s*=>\s*desktopNativeCapabilityService\.openWorkspace\(input\)/, "workspace opening"],
  [/openTool:\s*\(input\)\s*=>\s*desktopNativeCapabilityService\.openTool\(input\)/, "system tool opening"],
  [/readFile:\s*\(input\)\s*=>\s*workspaceFileService\.read\(input\)/, "workspace file reading"],
  [/openFile:\s*\(input\)\s*=>\s*workspaceFileService\.open\(input\)/, "workspace file opening"]
]) {
  if (!pattern.test(mainSource)) {
    addViolation(mainPath, "desktop-native-service-boundary", `missing ${detail} service delegation`);
  }
}
const protocolPath = join(root, "packages", "protocol", "src", "index.ts");
const protocolSource = await fs.readFile(protocolPath, "utf8");
const registeredChannels = capturedValues(protocolSource, /:\s*["'](phase1:[a-z0-9-]+)["']/g);
for (const [file, source] of [[mainPath, mainSource], [preloadPath, preloadSource]]) {
  const literalChannels = capturedValues(source, /["'](phase1:[a-z0-9-]+)["']/g);
  for (const channel of literalChannels) {
    if (registeredChannels.has(channel)) {
      addViolation(file, "ipc-channel-registry", `${channel} must use desktopIpcChannels`);
    }
  }
}
const invokedChannels = capturedValues(preloadSource, /ipcRenderer\.invoke\(\s*["'](phase1:[a-z0-9-]+)["']/g);
const handledChannels = capturedValues(mainSource, /ipcMain\.handle\(\s*["'](phase1:[a-z0-9-]+)["']/g);
const subscribedChannels = capturedValues(preloadSource, /ipcRenderer\.on\(\s*["'](phase1:[a-z0-9-]+)["']/g);
const sentChannels = capturedValues(mainSource, /\.send\(\s*["'](phase1:[a-z0-9-]+)["']/g);

for (const channel of invokedChannels) {
  if (!handledChannels.has(channel)) {
    addViolation(preloadPath, "ipc-request-contract", `${channel} has no main-process handler`);
  }
}
for (const channel of subscribedChannels) {
  if (!sentChannels.has(channel)) {
    addViolation(preloadPath, "ipc-event-contract", `${channel} has no main-process sender`);
  }
}

const desktopMainRoot = join(root, "apps", "desktop", "src", "main");
for (const file of await sourceFiles(desktopMainRoot)) {
  if (file.endsWith(`${join("main", "agent-runtime-adapter.ts")}`)) continue;
  const source = await fs.readFile(file, "utf8");
  for (const specifier of importedSpecifiers(source)) {
    if (/agentd\/src\//.test(specifier.replaceAll("\\", "/"))) {
      addViolation(file, "agent-runtime-adapter", `direct agentd implementation import ${specifier}`);
    }
  }
}

if (violations.length > 0) {
  console.error(`Architecture check failed with ${violations.length} violation(s):`);
  for (const violation of violations) console.error(`- ${violation}`);
  process.exitCode = 1;
} else {
  console.log("Architecture check passed.");
}
