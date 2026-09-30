import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");
const authIpcSource = await readFile(new URL("./auth-ipc.ts", import.meta.url), "utf8");
const terminalIpcSource = await readFile(new URL("./terminal-ipc.ts", import.meta.url), "utf8");
const modelConfigIpcSource = await readFile(new URL("./model-config-ipc.ts", import.meta.url), "utf8");
const mobileIpcSource = await readFile(new URL("./mobile-ipc.ts", import.meta.url), "utf8");
const browserIpcSource = await readFile(new URL("./browser-ipc.ts", import.meta.url), "utf8");
const systemIpcSource = await readFile(new URL("./system-ipc.ts", import.meta.url), "utf8");
const workspaceGitIpcSource = await readFile(new URL("./workspace-git-ipc.ts", import.meta.url), "utf8");
const windowIpcSource = await readFile(new URL("./window-ipc.ts", import.meta.url), "utf8");
const featuresIpcSource = await readFile(new URL("./features-ipc.ts", import.meta.url), "utf8");
const desktopIntegrationCompositionSource = await readFile(new URL("./desktop-integration-ipc-composition.ts", import.meta.url), "utf8");
const desktopSessionCompositionSource = await readFile(new URL("./desktop-session-runtime-composition.ts", import.meta.url), "utf8");
const workspaceIpcSource = await readFile(new URL("./workspace-ipc.ts", import.meta.url), "utf8");
const workspaceModulesSource = await readFile(new URL("../renderer/app/WorkspaceModules.tsx", import.meta.url), "utf8");
const composerContractSource = await readFile(new URL("./composer-contract.ts", import.meta.url), "utf8");
const boundedExtractorSource = await readFile(new URL("./bounded-extractor.ts", import.meta.url), "utf8");
const appMenuServiceSource = await readFile(new URL("./app-menu-service.ts", import.meta.url), "utf8");
const modelConfigServiceSource = await readFile(new URL("./model-config-service.ts", import.meta.url), "utf8");
const modelChatSkillPolicySource = await readFile(new URL("./model-chat-skill-policy.ts", import.meta.url), "utf8");
const modelChatSkillServiceSource = await readFile(new URL("./model-chat-skill-service.ts", import.meta.url), "utf8");
const modelChatPromptPolicySource = await readFile(new URL("./model-chat-prompt-policy.ts", import.meta.url), "utf8");
const modelChatContextServiceSource = await readFile(new URL("./model-chat-context-service.ts", import.meta.url), "utf8");
const governmentOutlineServiceSource = await readFile(new URL("./government-outline-service.ts", import.meta.url), "utf8");
const governmentFinalizationServiceSource = await readFile(new URL("./government-finalization-service.ts", import.meta.url), "utf8");
const modelChatResultPolicySource = await readFile(new URL("./model-chat-result-policy.ts", import.meta.url), "utf8");
const modelChatFailureServiceSource = await readFile(new URL("./model-chat-failure-service.ts", import.meta.url), "utf8");
const modelChatSuccessServiceSource = await readFile(new URL("./model-chat-success-service.ts", import.meta.url), "utf8");
const modelChatGoalServiceSource = await readFile(new URL("./model-chat-goal-service.ts", import.meta.url), "utf8");
const modelChatAgentLoopServiceSource = await readFile(new URL("./model-chat-agent-loop-service.ts", import.meta.url), "utf8");
const modelChatServiceSource = await readFile(new URL("./model-chat-service.ts", import.meta.url), "utf8");
const skillPolicySource = await readFile(new URL("./application-skill-policy.ts", import.meta.url), "utf8");
const packageJson = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
const packageScript = await readFile(new URL("../../../../scripts/package-win-msi.ps1", import.meta.url), "utf8");
const windowsWorkflow = await readFile(
  new URL("../../../../../../.github/workflows/build-windows-installer.yml", import.meta.url),
  "utf8"
);

test("keeps Chromium sandbox enabled and external navigation approved", () => {
  assert.doesNotMatch(source, /appendSwitch\(["']no-sandbox["']\)/);
  assert.doesNotMatch(source, /sandbox:\s*false/);
  assert.match(source, /["']persist:newbrain-browser["']/);
  assert.match(source, /name:\s*["']browser\.open["'][\s\S]{0,300}requiresApproval:\s*true/);
  assert.match(source, /!app\.isPackaged && e2eRemoteDebugPort && process\.env\.NEWBRAIN_E2E_AUTH_BYPASS === "1"/);
  assert.doesNotMatch(source, /if \(process\.env\.NEWBRAIN_E2E_AUTH_BYPASS === "1"\) \{/);
});

test("keeps application menu composition outside the desktop entry point", () => {
  assert.doesNotMatch(source, /function setupAppMenu/);
  assert.match(source, /import \{ AppMenuService, setupAppMenu \} from "\.\/app-menu-service\.js"/);
  assert.match(appMenuServiceSource, /export function setupAppMenu/);
  assert.match(appMenuServiceSource, /export class AppMenuService/);
  assert.doesNotMatch(source, /Menu\.buildFromTemplate/);
});

test("enforces a single desktop instance before touching shared user state", () => {
  assert.match(source, /app\.requestSingleInstanceLock\(\)/);
  assert.match(source, /app\.on\(["']second-instance["']/);
  assert.match(source, /window\.restore\(\)/);
  assert.match(source, /window\.focus\(\)/);
  assert.match(source, /if \(!singleInstanceLockAcquired\) return;/);
});

test("validates terminal input at the privileged IPC boundary", () => {
  assert.match(terminalIpcSource, /typeof input !== ["']string["']/);
  assert.match(terminalIpcSource, /throw new TypeError\(["']Terminal input must be a string\.["']\)/);
  assert.match(desktopSessionCompositionSource, /registerTerminalIpcHandlers\(\{/);
  assert.match(source, /registerDesktopSessionRuntimeComposition\(\{/);
});

test("validates model configuration before authorization and persistence", () => {
  assert.match(modelConfigIpcSource, /desktopIpcChannels\.model\.saveConfig/);
  assert.match(modelConfigIpcSource, /services\.saveConfig\(parseModelConfig\(input\)\)/);
  assert.match(modelConfigIpcSource, /Model configuration payload is invalid\./);
  assert.match(desktopIntegrationCompositionSource, /new ModelConfigService\(\{/);
  assert.match(desktopIntegrationCompositionSource, /registerModelConfigIpcHandlers\(\{[\s\S]{0,200}modelConfigService\.saveConfig/);
  assert.match(modelConfigServiceSource, /current subscription does not allow the selected model/);
});

test("keeps the mobile bridge server behind a narrow IPC service boundary", () => {
  assert.match(mobileIpcSource, /desktopIpcChannels\.mobile\.startPairing/);
  assert.match(mobileIpcSource, /desktopIpcChannels\.mobile\.getPairingStatus/);
  assert.match(mobileIpcSource, /desktopIpcChannels\.mobile\.stopPairing/);
  assert.doesNotMatch(mobileIpcSource, /createServer|HttpServer|mobileBridgeServer/);
  assert.match(desktopIntegrationCompositionSource, /registerMobileIpcHandlers\(\{/);
});

test("keeps BrowserWindow capabilities behind validated browser IPC", () => {
  assert.match(browserIpcSource, /Browser preview URL must be a string\./);
  assert.match(browserIpcSource, /services\.openPreview\(url\)/);
  assert.doesNotMatch(browserIpcSource, /BrowserWindow|previewWindowRef|webContents/);
  assert.match(desktopIntegrationCompositionSource, /registerBrowserIpcHandlers\(\{/);
});

test("validates native system capability inputs at one IPC boundary", () => {
  assert.match(systemIpcSource, /System tool input is invalid\./);
  assert.match(systemIpcSource, /Skill location input is invalid\./);
  assert.doesNotMatch(systemIpcSource, /electronShell|spawn|readWorkspaceCatalog/);
  assert.match(source, /registerSystemIpcHandlers\(\{/);
});

test("validates workspace Git inputs before filesystem and process access", () => {
  assert.match(workspaceGitIpcSource, /Workspace id must be a string\./);
  assert.match(workspaceGitIpcSource, /Workspace branch input is invalid\./);
  assert.match(workspaceGitIpcSource, /Message feedback input is invalid\./);
  assert.doesNotMatch(workspaceGitIpcSource, /spawn|runGitUtf8|electronShell/);
  assert.match(source, /registerWorkspaceGitIpcHandlers\(\{/);
});

test("restricts native window IPC to finite actions and the invoking web contents", () => {
  assert.match(windowIpcSource, /Window control action is invalid\./);
  assert.match(windowIpcSource, /services\.showInputContextMenu\(event\.sender\)/);
  assert.doesNotMatch(windowIpcSource, /BrowserWindow|Menu\.buildFromTemplate/);
  assert.match(source, /registerWindowIpcHandlers\(\{/);
});

test("validates feature catalog mutations before configuration side effects", () => {
  assert.match(featuresIpcSource, /Feature item payload is invalid\./);
  assert.match(featuresIpcSource, /Update feature input is invalid\./);
  assert.match(featuresIpcSource, /Delete feature input is invalid\./);
  assert.doesNotMatch(featuresIpcSource, /writeFeatureConfig|activateConfiguredPlugins|fs\./);
  assert.match(desktopIntegrationCompositionSource, /registerFeaturesIpcHandlers\(\{/);
  assert.match(source, /registerDesktopIntegrationIpcComposition\(\{/);
});

test("validates every workspace and file command before service access", () => {
  assert.match(workspaceIpcSource, /requireRecord\(input, "Workspace file"\)/);
  assert.match(workspaceIpcSource, /Workspace search query must be a string\./);
  assert.match(workspaceIpcSource, /workspace\.add[\s\S]{0,100}input: unknown/);
  assert.match(workspaceIpcSource, /workspaceFiles\.read[\s\S]{0,100}input: unknown/);
  assert.match(source, /search:\s*searchWorkspaceThreads/);
  assert.match(source, /readFile:\s*\(input\)\s*=>\s*workspaceFileService\.read\(input\)/);
  assert.match(source, /openFile:\s*\(input\)\s*=>\s*workspaceFileService\.open\(input\)/);
  assert.doesNotMatch(source, /function\s+(?:read|open)WorkspaceFile\s*\(/);
});

test("omits an empty model request id from direct shell approvals", () => {
  assert.match(workspaceModulesSource, /\.\.\.\(requestId \? \{ requestId \} : \{\}\)/);
  assert.match(workspaceModulesSource, /\.\.\.\(approvalId \? \{ approvalId \} : \{\}\)/);
  assert.doesNotMatch(workspaceModulesSource, /respondApproval\(\{ approved, requestId \}\)/);
});

test("validates persisted authentication online without accepting server gateway credentials", () => {
  assert.match(authIpcSource, /desktopIpcChannels\.auth\.getStatus[\s\S]{0,120}services\.getStatus\(\)/);
  assert.match(source, /registerAuthIpcHandlers\(\{[\s\S]{0,120}getStatus:\s*resolveDesktopAuthStatus/);
  assert.doesNotMatch(source, /getStatus:\s*resolveLocalDesktopAuthStatus/);
  assert.doesNotMatch(source, /gatewayApiKeyCredential|gateway_credential|desktop_gateway_key|session_gateway_key/);
  assert.match(source, /hasOwnProperty\.call\(parsed, "gateway_api_key"\)/);
  const accessIndex = source.indexOf("accessTokenCredential ?");
  const configIndex = source.indexOf("apiKeyCredential ?", accessIndex);
  assert.ok(accessIndex > 0 && configIndex > accessIndex);
});

test("removes vulnerable xlsx parsing and stale manual-required early exits", () => {
  assert.equal(packageJson.dependencies.xlsx, undefined);
  assert.equal(packageJson.dependencies.exceljs, "4.4.0");
  assert.doesNotMatch(source, /import\(["']xlsx["']\)/);
  assert.doesNotMatch(source, /status === ["']manual_required["']\)\s*&&\s*bootstrapState\.overall/);
});

test("builds release configuration from a credential-free allowlist", () => {
  assert.match(packageScript, /fixed credential-free allowlist/);
  assert.match(packageScript, /apiKey\s*=\s*["']["']/);
  assert.match(packageScript, /extraEnv\s*=\s*@\{\}/);
  assert.match(packageScript, /NEWBRAIN_REQUIRE_SIGNATURE/);
  assert.match(packageScript, /-unsigned\.msi/);
  assert.match(windowsWorkflow, /NEWBRAIN_REQUIRE_SIGNATURE:\s*["']true["']/);
  assert.match(windowsWorkflow, /secrets\.WINDOWS_CSC_LINK/);
  assert.match(windowsWorkflow, /secrets\.WINDOWS_CSC_KEY_PASSWORD/);
});

test("keeps isolated MSI build paths below the legacy WiX path limit", () => {
  assert.match(packageScript, /\$builderRunId\s*=\s*"\{0\}-\{1\}"\s*-f\s*\$PID,\s*\$attempt/);
  assert.match(packageScript, /Join-Path\s+"release"\s+"_p"/);
  assert.match(packageScript, /MSI packaging path exceeds the legacy Windows limit/);
  assert.doesNotMatch(packageScript, /msi-build-\{0\}-\{1\}/);
});

test("selects, discloses, and fully injects skills for every model turn", () => {
  assert.doesNotMatch(source, /selectModelChatSkills\(\{/);
  assert.match(modelChatGoalServiceSource, /this\.dependencies\.selectSkills\(\{/);
  assert.match(modelChatSkillPolicySource, /validateExplicitSkillNames\(/);
  assert.match(modelChatSkillPolicySource, /shouldRunAutomaticSkillSelection\(centralSkillNames\)/);
  assert.match(modelChatSkillPolicySource, /selectAutomaticSkillNames\(heuristicSkills\)/);
  assert.doesNotMatch(source, /buildSkillSelectionRequest\(latestUserRequest, skillDescriptors\)/);
  assert.match(modelChatServiceSource, /this\.dependencies\.loadSkills\(\{/);
  assert.match(modelChatSkillServiceSource, /title: "本轮使用 Skill"/);
  assert.match(modelChatResultPolicySource, /`本轮使用 Skill：\$\{formatSkillDisclosure\(input\.disclosedSkills\)\}。`/);
  assert.doesNotMatch(modelChatResultPolicySource, /\[skillDisclosure, generatedContent, artifactSummary\]/);
  assert.match(modelChatPromptPolicySource, /"Complete SKILL\.md:"[\s\S]*skill\.instructions/);
  assert.match(modelChatPromptPolicySource, /所有用户可见的 Skill 调用说明、目标、计划步骤标题/);
  assert.match(modelChatPromptPolicySource, /不得输出完整思维链、英文草稿或内部自言自语/);
  assert.match(modelChatPromptPolicySource, /buildUserSkillPlatformInheritanceInstruction/);
  assert.match(modelChatPromptPolicySource, /buildAutoModeRoleInstruction/);
  assert.match(modelChatServiceSource, /appendAutoDelegateTurnConstraint/);
  assert.match(modelChatPromptPolicySource, /music_generate/);
  assert.doesNotMatch(workspaceModulesSource, /RESEARCH_WRITING_PRODUCT_ENABLED\s*=\s*true/);
  assert.match(workspaceModulesSource, /GOVERNMENT_RESEARCH_WRITING_PRODUCT_ENABLED/);
  assert.match(modelChatAgentLoopServiceSource, /systemPrompt: input\.effectiveSystemPrompt/);
  assert.match(modelChatAgentLoopServiceSource, /permissionMode: input\.modelInput\.permissionMode === "full" \? "full" : "agent"/);
  assert.match(modelChatAgentLoopServiceSource, /allowedToolNames: governmentRevisionPreview \? \[\] : remoteAllowedToolNames/);
  assert.doesNotMatch(source, /allowedToolNames: centralSkillNames\.includes\("government-research-writing"\)/);
  assert.doesNotMatch(source, /goalRuntimeEnabled \? \[\.\.\.GOAL_TOOL_NAMES,\s*"shell\.exec"/);
});

test("persists reconciled model context before exposing it to the task runtime", () => {
  assert.match(modelChatServiceSource, /this\.dependencies\.prepareContext\(\{/);
  assert.doesNotMatch(source, /reconcileThreadMessages\(/);
  assert.match(modelChatContextServiceSource, /reconcileThreadMessages\(/);
  assert.match(modelChatContextServiceSource, /compactThreadMessages\(/);
  assert.match(
    modelChatContextServiceSource,
    /writeThreadState\([\s\S]*appendRolloutRecords\([\s\S]*setRuntimeState\(input\.state\)/
  );
});

test("keeps government outline repair and goal persistence outside model chat assembly", () => {
  assert.match(modelChatAgentLoopServiceSource, /this\.dependencies\.runOutline\(\{/);
  assert.doesNotMatch(source, /parseGovernmentOutlineDecision\(/);
  assert.match(governmentOutlineServiceSource, /for \(let attempt = 1; attempt <= 2/);
  assert.match(governmentOutlineServiceSource, /signal: input\.abortSignal/);
  assert.match(governmentOutlineServiceSource, /const visibleDelta = stream\.push\(delta\)/);
  assert.match(governmentOutlineServiceSource, /createGoalQuestion\(/);
  assert.match(governmentOutlineServiceSource, /markGovernmentOutlineReady\(/);
});

test("keeps government finalization, length acceptance, and goal completion in one service", () => {
  assert.match(modelChatAgentLoopServiceSource, /this\.dependencies\.runFinalization\(\{/);
  assert.doesNotMatch(source, /parseGovernmentWritingFinalization\(/);
  assert.match(governmentFinalizationServiceSource, /parseGovernmentWritingFinalization\(/);
  assert.match(governmentFinalizationServiceSource, /enforceGovernmentWritingLength\(/);
  assert.match(governmentFinalizationServiceSource, /sanitizeGovernmentDraftForDelivery\(/);
  assert.match(governmentFinalizationServiceSource, /updateGoal\(threadId, "complete"\)/);
});

test("centralizes canonical model results and failure persistence", () => {
  assert.match(modelChatAgentLoopServiceSource, /this\.dependencies\.buildResult\(\{/);
  assert.match(modelChatResultPolicySource, /sanitizeVisibleModelContent\(/);
  assert.match(modelChatResultPolicySource, /formatWrittenArtifactSummary\(/);
  assert.match(modelChatServiceSource, /this\.dependencies\.persistFailure\(\{/);
  assert.doesNotMatch(source, /existingPartial\.excludeFromModelContext/);
  assert.match(modelChatFailureServiceSource, /excludeFromModelContext = true/);
  assert.match(modelChatFailureServiceSource, /cancelled_by_user/);
});

test("commits successful model turns through one persistence service", () => {
  assert.match(modelChatServiceSource, /this\.dependencies\.persistSuccess\(\{/);
  assert.doesNotMatch(source, /rememberExchangeWithShadow\(\{/);
  assert.match(modelChatSuccessServiceSource, /rememberExchange\(\{/);
  assert.match(modelChatSuccessServiceSource, /appendRolloutRecords\(/);
  assert.match(modelChatSuccessServiceSource, /memory_created/);
  assert.match(modelChatSuccessServiceSource, /lastEventSummary: "模型回复已完成"/);
});

test("does not reorder threads merely because the user navigated between them", () => {
  const activation = source.slice(
    source.indexOf("async function activateWorkspaceThread"),
    source.indexOf("function buildApiEndpoint")
  );
  assert.match(activation, /saveActiveThreadState\(undefined, \{ touchUpdatedAt: false \}\)/);
  assert.doesNotMatch(activation, /saveActiveThreadState\(\);/);
});

test("bounds attachment size, extractor memory, output, and clipboard IPC payloads without a fixed execution deadline", () => {
  assert.match(source, /assertAttachmentSize\(extension, stat\.size\)/);
  assert.match(composerContractSource, /assertClipboardPayloadSize\(input\.data,\s*name\)/);
  assert.match(source, /runBoundedExtractor/);
  assert.match(source, /MAX_EXTRACTOR_OUTPUT_BYTES/);
  assert.doesNotMatch(source, /timeoutMs: 30_000/);
  assert.match(boundedExtractorSource, /--max-old-space-size=256/);
  assert.match(boundedExtractorSource, /input\.signal\?\.addEventListener\("abort", abort/);
  assert.match(boundedExtractorSource, /nextSize > input\.maxOutputBytes/);
  assert.doesNotMatch(source, /mammoth\.extractRawText/);
});

test("propagates global and disabled Skill policy into every runtime", () => {
  assert.match(source, /applySkillPolicy\(targetRuntime, userSkillRoot/);
  assert.match(skillPolicySource, /skill\.status === "disabled"/);
  assert.match(source, /applyApplicationSkillPolicy\(automationRuntime\)/);
  assert.match(source, /applyApplicationSkillPolicy\(targetRuntime\)/);
  assert.match(source, /applyApplicationSkillPolicy\(runtime\)/);
});

test("uses unquoted UTF-8 Git paths for status and review flows", () => {
  assert.match(source, /runGitUtf8\(workspace\.path, args\)/);
  assert.match(source, /runGitUtf8\(workspace\.path, \["status", "--porcelain"\]\)/);
  assert.doesNotMatch(source, /spawnSync\("git", \["status", "--porcelain"\]/);
});
