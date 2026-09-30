import type { ModelConfig } from "@codex-forge/protocol";
import type { CodexStorage } from "./codex-storage.js";
import { registerMcpIpcHandlers } from "./mcp-ipc.js";
import { McpCallTimelineService } from "./mcp-call-timeline-service.js";
import { registerFeaturesIpcHandlers } from "./features-ipc.js";
import { registerOpenClawSkillIpcHandlers } from "./openclaw-skill-ipc.js";
import { registerMobileIpcHandlers } from "./mobile-ipc.js";
import { registerModelConfigIpcHandlers } from "./model-config-ipc.js";
import { ModelConfigService } from "./model-config-service.js";
import { registerBrowserIpcHandlers } from "./browser-ipc.js";
import { BrowserPreviewService } from "./browser-preview-service.js";
import { registerPolicyIpcHandlers } from "./policy-ipc.js";

interface DesktopIntegrationIpcCompositionDeps {
  getActiveWorkspaceId: () => string;
  getActiveThreadId: () => string;
  readWorkspaceCatalog: () => Promise<any>;
  appendThreadEvents: (...args: any[]) => Promise<any>;
  callMcpTool: (...args: any[]) => Promise<any>;
  readMcpServers: () => Promise<any>;
  writeMcpServers: (servers: any) => Promise<any>;
  testMcpServer: (server: any) => Promise<any>;
  startMcpServer: (server: any) => Promise<any>;
  stopMcpServer: (server: any) => Promise<any>;
  getMcpLogs: (serverId: string) => any;
  clearMcpLogs: (serverId: string) => any;
  normalizeMcpServer: (server: any) => any;
  inspectMcpServer: (server: any) => Promise<any>;
  persistMcpInspection: (server: any, inspection: any) => Promise<any>;
  readMcpDiscoveredTools: () => Promise<any>;
  readFeatureConfig: () => Promise<any>;
  addFeatureItem: (kind: any, item: any) => Promise<any>;
  updateFeatureItem: (kind: any, id: string, item: any) => Promise<any>;
  deleteFeatureItem: (kind: any, id: string) => Promise<any>;
  openClawSkillService?: {
    search: (query: string, limit?: number) => unknown;
    installFromClawHub: (input: any) => unknown;
    installFromPath: (input: any) => unknown;
    selectAndInstall: (input?: any) => unknown;
    inspectLocal: (path: string) => unknown;
    exportAsZip: (input: any) => unknown;
    uninstallWritingSkills: (input?: any) => unknown;
  };
  mobileBridgeService: {
    start: () => any;
    getStatus: () => any;
    stop: () => any;
  };
  readAuthorizedDesktopModelConfig: () => Promise<ModelConfig>;
  writeRootConfig: (config: any) => Promise<any>;
  isPrivateModelCredentialConfigured: () => Promise<boolean>;
  getActiveDesktopPreferences: () => Promise<any>;
  ensurePreviewWindow: (url: string) => any;
  closePreviewWindow: () => void;
  capturePreviewWindow: () => Promise<any>;
  clearBrowserBrowsingData: () => Promise<{ ok: boolean; detail: string }>;
  listBrowserHistory: () => Promise<Array<{ id: string; url: string; title: string; visitedAt: string }>>;
  removeBrowserHistoryEntry: (id: string) => Promise<Array<{ id: string; url: string; title: string; visitedAt: string }>>;
  clearBrowserHistory: () => Promise<{ ok: boolean }>;
  selectBrowserDownloadDir: () => Promise<{ path: string } | null>;
  listBrowserCredentials: () => Promise<Array<{ id: string; origin: string; username: string; hasPassword: boolean; updatedAt: string }>>;
  upsertBrowserCredential: (input: {
    origin: string;
    username: string;
    password: string;
    id?: string;
  }) => Promise<Array<{ id: string; origin: string; username: string; hasPassword: boolean; updatedAt: string }>>;
  removeBrowserCredential: (
    id: string
  ) => Promise<Array<{ id: string; origin: string; username: string; hasPassword: boolean; updatedAt: string }>>;
  listBrowserContacts: () => Promise<Array<{ id: string; name: string; email: string; phone: string; updatedAt: string }>>;
  upsertBrowserContact: (input: {
    name: string;
    email?: string;
    phone?: string;
    id?: string;
  }) => Promise<Array<{ id: string; name: string; email: string; phone: string; updatedAt: string }>>;
  removeBrowserContact: (
    id: string
  ) => Promise<Array<{ id: string; name: string; email: string; phone: string; updatedAt: string }>>;
  getBrowserCdpAccess: () => Promise<{ enabled: boolean; partition: string; detail: string }>;
  probeBrowserSiteTools: () => Promise<{ origin: string; enabled: boolean; endpoints: string[]; detail: string }>;
  saveActiveThreadState: (summary?: string) => Promise<any>;
  appendDiagnosticsLog: (line: string) => Promise<any>;
  readPolicyRules: () => Promise<any>;
  writePolicyRules: (rules: any) => Promise<any>;
  codexStorage: CodexStorage;
  processUuid: string;
}

export function registerDesktopIntegrationIpcComposition(deps: DesktopIntegrationIpcCompositionDeps) {
  const mcpCallTimelineService = new McpCallTimelineService({
    getActiveWorkspaceId: deps.getActiveWorkspaceId,
    getActiveThreadId: deps.getActiveThreadId,
    readCatalog: deps.readWorkspaceCatalog,
    appendEvents: deps.appendThreadEvents,
    callTool: deps.callMcpTool
  });
  registerMcpIpcHandlers({
    getServers: deps.readMcpServers,
    saveServers: deps.writeMcpServers,
    testServer: (server) => deps.testMcpServer(deps.normalizeMcpServer(server)),
    startServer: (server) => deps.startMcpServer(deps.normalizeMcpServer(server)),
    stopServer: (server) => deps.stopMcpServer(deps.normalizeMcpServer(server)),
    getLogs: deps.getMcpLogs,
    clearLogs: deps.clearMcpLogs,
    inspectServer: async (server) => {
      const normalized = deps.normalizeMcpServer(server);
      const inspection = await deps.inspectMcpServer(normalized);
      if (inspection.ok) await deps.persistMcpInspection(normalized, inspection);
      return inspection;
    },
    getDiscoveredTools: deps.readMcpDiscoveredTools,
    callTool: (input) => mcpCallTimelineService.call(input)
  });
  registerFeaturesIpcHandlers({
    getConfig: deps.readFeatureConfig,
    addItem: (input) => deps.addFeatureItem(input.kind, input.item),
    updateItem: (input) => deps.updateFeatureItem(input.kind, input.id, input.item),
    deleteItem: (input) => deps.deleteFeatureItem(input.kind, input.id)
  });
  if (deps.openClawSkillService) {
    registerOpenClawSkillIpcHandlers({
      search: (query, limit) => deps.openClawSkillService!.search(query, limit),
      installClawHub: async (input) => {
        const result = await deps.openClawSkillService!.installFromClawHub(input);
        return {
          skill: result.skill,
          targetDir: result.targetDir,
          warnings: result.origin.warnings,
          source: result.origin.source,
          acknowledgedRisk: result.origin.acknowledgedRisk
        };
      },
      installPath: async (input) => {
        const result = await deps.openClawSkillService!.installFromPath(input);
        return {
          skill: result.skill,
          targetDir: result.targetDir,
          warnings: result.origin.warnings,
          source: result.origin.source,
          acknowledgedRisk: result.origin.acknowledgedRisk
        };
      },
      selectAndInstall: async (input) => {
        const result = await deps.openClawSkillService!.selectAndInstall(input);
        if (!result) return null;
        return {
          skill: result.skill,
          targetDir: result.targetDir,
          warnings: result.origin.warnings,
          source: result.origin.source,
          acknowledgedRisk: result.origin.acknowledgedRisk
        };
      },
      inspectPath: (path) => deps.openClawSkillService!.inspectLocal(path),
      exportZip: (input) => deps.openClawSkillService!.exportAsZip(input),
      uninstallWritingSkills: (input) => deps.openClawSkillService!.uninstallWritingSkills(input || {})
    });
  }
  registerMobileIpcHandlers({
    startPairing: () => deps.mobileBridgeService.start(),
    getPairingStatus: () => deps.mobileBridgeService.getStatus(),
    stopPairing: () => deps.mobileBridgeService.stop()
  });
  const modelConfigService = new ModelConfigService({
    readAuthorized: deps.readAuthorizedDesktopModelConfig,
    writeRootConfig: deps.writeRootConfig,
    isCredentialConfigured: deps.isPrivateModelCredentialConfigured
  });
  registerModelConfigIpcHandlers({
    getConfig: () => modelConfigService.getConfig(),
    saveConfig: (config) => modelConfigService.saveConfig(config)
  });
  const browserPreviewService = new BrowserPreviewService({
    getPreferences: deps.getActiveDesktopPreferences,
    openWindow: deps.ensurePreviewWindow,
    closeWindow: deps.closePreviewWindow,
    captureWindow: deps.capturePreviewWindow,
    saveThreadState: deps.saveActiveThreadState,
    appendDiagnostics: deps.appendDiagnosticsLog,
    openExternal: async (url) => {
      const { shell } = await import("electron");
      await shell.openExternal(url);
    }
  });
  registerBrowserIpcHandlers({
    openPreview: (url) => browserPreviewService.open(url),
    closePreview: () => browserPreviewService.close(),
    capturePreview: () => browserPreviewService.capture(),
    clearBrowsingData: () => deps.clearBrowserBrowsingData(),
    listHistory: () => deps.listBrowserHistory(),
    removeHistoryEntry: (id) => deps.removeBrowserHistoryEntry(id),
    clearHistory: () => deps.clearBrowserHistory(),
    selectDownloadDir: () => deps.selectBrowserDownloadDir(),
    listCredentials: () => deps.listBrowserCredentials(),
    upsertCredential: (input) => deps.upsertBrowserCredential(input),
    removeCredential: (id) => deps.removeBrowserCredential(id),
    listContacts: () => deps.listBrowserContacts(),
    upsertContact: (input) => deps.upsertBrowserContact(input),
    removeContact: (id) => deps.removeBrowserContact(id),
    getCdpAccess: () => deps.getBrowserCdpAccess(),
    probeSiteTools: () => deps.probeBrowserSiteTools()
  });
  registerPolicyIpcHandlers({
    getRules: deps.readPolicyRules,
    saveRules: deps.writePolicyRules,
    onRulesSaved: (rules) => {
      deps.codexStorage.appendLog({
        level: "info",
        target: "policy.rules.updated",
        body: `Saved ${rules.length} policy rules.`,
        threadId: deps.getActiveThreadId() || undefined,
        processUuid: deps.processUuid
      });
    }
  });
}
