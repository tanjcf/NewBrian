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

function preparePackageResources() {
  mkdirSync(packageResourcesDir, { recursive: true });
  const input = JSON.parse(readFileSync(join(repoRoot, "newbrain.config.json"), "utf8"));
  const config = sanitizeConfig(input);
  writeFileSync(join(packageResourcesDir, "newbrain.config.json"), JSON.stringify(config, null, 2) + "\n", "utf8");
  writeFileSync(join(packageResourcesDir, "newbrain.features.json"), JSON.stringify(features, null, 2) + "\n", "utf8");
  console.log("Prepared sanitized mac package resources.");
}

module.exports = { preparePackageResources, sanitizeConfig };

if (require.main === module) {
  preparePackageResources();
}
