const { mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");

const desktopRoot = resolve(__dirname, "..");
const repoRoot = resolve(desktopRoot, "..", "..");
const packageResourcesDir = join(desktopRoot, "build", "package-resources");

function sanitizeConfig(input) {
  const config = structuredClone(input);
  if (config.llm) {
    config.llm.apiKey = "";
  }
  if (config.preferences?.worktree) {
    config.preferences.worktree.rootDir = "";
  }
  if (config.preferences?.environment) {
    config.preferences.environment.extraEnv = {};
  }
  if (config.preferences?.popup) {
    config.preferences.popup.shortcut = "";
  }
  if (config.preferences?.dictation) {
    config.preferences.dictation.holdShortcut = "";
    config.preferences.dictation.toggleShortcut = "";
    config.preferences.dictation.dictionaryEntries = [];
  }
  if (config.preferences) {
    config.preferences.shortcuts = {};
  }
  if (Array.isArray(config.mcpServers)) {
    config.mcpServers = [];
  }
  if (Array.isArray(config.mcpDiscoveredTools)) {
    config.mcpDiscoveredTools = [];
  }
  return config;
}

const features = {
  skills: [],
  plugins: [
    {
      id: "plugin-git-console",
      name: "Git Console",
      summary: "Built-in Git workspace helper.",
      status: "connected",
      version: "builtin",
      source: "builtin",
      capabilities: ["git", "workspace"]
    },
    {
      id: "plugin-shell-runner",
      name: "Shell Runner",
      summary: "Built-in shell command runner.",
      status: "connected",
      version: "builtin",
      source: "builtin",
      capabilities: ["shell", "approval"]
    }
  ],
  automations: [],
  runtime: { rustCoreTools: "disabled" }
};

function resolveChannelEndpoints(channel) {
  const isProduction = channel === "production";
  const gatewayBaseUrl = (
    (isProduction ? process.env.NEWBRAIN_PRODUCTION_GATEWAY_BASE_URL : process.env.NEWBRAIN_TEST_GATEWAY_BASE_URL) ||
    "http://203.0.113.10:8790/v1"
  ).trim();
  const previewUrl = (
    (isProduction ? process.env.NEWBRAIN_PRODUCTION_PREVIEW_URL : process.env.NEWBRAIN_TEST_PREVIEW_URL) ||
    "http://203.0.113.10:3000"
  ).trim();
  return { gatewayBaseUrl, previewUrl };
}

function applyChannelEndpoints(config, channel) {
  if (channel !== "test" && channel !== "production") return config;
  const { gatewayBaseUrl, previewUrl } = resolveChannelEndpoints(channel);
  const next = structuredClone(config);
  if (next.llm) {
    next.llm.baseUrl = gatewayBaseUrl;
  }
  if (next.preferences?.browser) next.preferences.browser.previewUrl = previewUrl;
  return next;
}

function preparePackageResources(channel = process.env.NEWBRAIN_PACKAGE_CHANNEL || "") {
  mkdirSync(packageResourcesDir, { recursive: true });
  const input = JSON.parse(readFileSync(join(repoRoot, "newbrain.config.json"), "utf8"));
  const config = applyChannelEndpoints(sanitizeConfig(input), channel);
  writeFileSync(join(packageResourcesDir, "newbrain.config.json"), JSON.stringify(config, null, 2) + "\n", "utf8");
  writeFileSync(join(packageResourcesDir, "newbrain.features.json"), JSON.stringify(features, null, 2) + "\n", "utf8");
  console.log(channel ? `Prepared sanitized mac ${channel} package resources.` : "Prepared sanitized mac package resources.");
  return config;
}

module.exports = { preparePackageResources, sanitizeConfig, applyChannelEndpoints, resolveChannelEndpoints };

if (require.main === module) {
  preparePackageResources();
}
