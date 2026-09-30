/**
 * Sync spring-app product identity with NewBrain desktop rename.
 * Preserves OpenAI Codex identifiers.
 */
import fs from "node:fs";
import path from "node:path";

const root = path.resolve("I:/G盘迁移备份/workrpase/spring-app");

const SKIP_DIRS = new Set([
  ".git", "node_modules", "target", "build", "dist", "out", "logs", ".idea", ".gradle", "data"
]);

const TEXT_EXT = new Set([
  ".java", ".kt", ".properties", ".yml", ".yaml", ".xml", ".md", ".ps1", ".sh",
  ".json", ".ts", ".js", ".vue", ".tsx", ".html", ".txt", ".css"
]);

const REPLACEMENTS = [
  [/X-Codecn-Selected-Model/g, "X-NewBrain-Selected-Model"],
  [/X-Codecn-Routing-Reason/g, "X-NewBrain-Routing-Reason"],
  [/X-Codecn-Model-Alias/g, "X-NewBrain-Model-Alias"],
  [/X-Codecn-Routing-Channel/g, "X-NewBrain-Routing-Channel"],
  [/X-CodeCN-Mock/g, "X-NewBrain-Mock"],
  [/X-CodeCN-/g, "X-NewBrain-"],
  [/X-Codecn-/g, "X-NewBrain-"],
  [/x-codecn-/g, "x-newbrain-"],
  [/codecn\.agent\.v1/g, "newbrain.agent.v1"],
  [/app\.auth\.codecn-desktop-e2e/g, "app.auth.newbrain-desktop-e2e"],
  [/APP_AUTH_CODECN_DESKTOP_E2E_/g, "APP_AUTH_NEWBRAIN_DESKTOP_E2E_"],
  [/APP_CODECN_E2E_OWNER_EMAIL/g, "APP_NEWBRAIN_E2E_OWNER_EMAIL"],
  [/APP_CODECN_/g, "APP_NEWBRAIN_"],
  [/CODECN_MYSQL_E2E_/g, "NEWBRAIN_MYSQL_E2E_"],
  [/CODECN_MODEL_BASE_URL/g, "NEWBRAIN_MODEL_BASE_URL"],
  [/CODECN_MEDIA_GATEWAY_BASE_URL/g, "NEWBRAIN_MEDIA_GATEWAY_BASE_URL"],
  [/CODECN_E2E_AUTH_BYPASS/g, "NEWBRAIN_E2E_AUTH_BYPASS"],
  [/CODECN_E2E_AUTH_TOKEN/g, "NEWBRAIN_E2E_AUTH_TOKEN"],
  [/CODECN_DESKTOP_E2E_KEY_NAME/g, "NEWBRAIN_DESKTOP_E2E_KEY_NAME"],
  [/CODECN_/g, "NEWBRAIN_"],
  [/matchesCodecnDesktopE2eKey/g, "matchesNewbrainDesktopE2eKey"],
  [/codecnDesktopE2e/g, "newbrainDesktopE2e"],
  [/CodecnDesktopE2e/g, "NewbrainDesktopE2e"],
  [/codecn_desktop_e2e/g, "newbrain_desktop_e2e"],
  [/codecn-desktop-e2e/g, "newbrain-desktop-e2e"],
  [/codecn-e2e/g, "newbrain-e2e"],
  [/codecn-local-dev\.ps1/g, "newbrain-local-dev.ps1"],
  [/BootstrapSeedServiceCodecnE2eTest/g, "BootstrapSeedServiceNewbrainE2eTest"],
  [/catalogMatchesCodecnFieldContract/g, "catalogMatchesNewbrainFieldContract"],
  [/You are codeCN\./g, "You are NewBrain."],
  [/\[codeCN\]/g, "[NewBrain]"],
  [/codeCN Desktop E2E/g, "NewBrain Desktop E2E"],
  [/codeCN desktop E2E/g, "NewBrain desktop E2E"],
  [/codeCN Holon/g, "NewBrain Holon"],
  [/codeCN desktop/g, "NewBrain desktop"],
  [/codeCN client/g, "NewBrain client"],
  [/codeCN-/g, "NewBrain-"],
  [/codeCN\b/g, "NewBrain"],
  [/CodeCN\b/g, "NewBrain"],
  [/Codecn\b/g, "Newbrain"],
  [/\bcodecn\b/g, "newbrain"],
];

function shouldSkipDir(name) {
  return SKIP_DIRS.has(name) || name.startsWith(".");
}

function walk(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (shouldSkipDir(ent.name)) continue;
      // skip built frontend bundles under static/app/assets hashed js? still update source frontend
      walk(full, out);
    } else if (ent.isFile()) {
      const ext = path.extname(ent.name).toLowerCase();
      if (TEXT_EXT.has(ext) || ent.name === "Dockerfile") out.push(full);
    }
  }
  return out;
}

function mask(text) {
  return text
    .replace(/@codex-forge\//g, "___CF___")
    .replace(/\.codex-plugin\b/g, "___CP___")
    .replace(/\.codex\b/g, "___DC___")
    .replace(/codex-storage/g, "___CS___")
    .replace(/openai-wire/g, "___OW___")
    .replace(/\bCodex\b/g, "___CX___")
    .replace(/\bcodex\b/g, "___cx___")
    // keep method names that are clearly OpenAI Codex wire tests partially
    .replace(/CodexResponses/g, "___CodexResponses___")
    .replace(/prepareUpstreamRequest/g, "___prepareUpstreamRequest___");
}

function unmask(text) {
  return text
    .replace(/___CF___/g, "@codex-forge/")
    .replace(/___CP___/g, ".codex-plugin")
    .replace(/___DC___/g, ".codex")
    .replace(/___CS___/g, "codex-storage")
    .replace(/___OW___/g, "openai-wire")
    .replace(/___CX___/g, "Codex")
    .replace(/___cx___/g, "codex")
    .replace(/___CodexResponses___/g, "CodexResponses")
    .replace(/___prepareUpstreamRequest___/g, "prepareUpstreamRequest");
}

function transform(text) {
  let next = mask(text);
  for (const [re, to] of REPLACEMENTS) next = next.replace(re, to);
  return unmask(next);
}

function renameFiles(files) {
  let n = 0;
  const candidates = files
    .filter((f) => /codecn|codeCN|CodeCN/i.test(path.basename(f)))
    .sort((a, b) => b.length - a.length);
  for (const file of candidates) {
    const base = path.basename(file);
    const nextBase = base
      .replace(/codeCN/g, "NewBrain")
      .replace(/CodeCN/g, "NewBrain")
      .replace(/Codecn/g, "Newbrain")
      .replace(/codecn/g, "newbrain");
    if (nextBase === base) continue;
    const dest = path.join(path.dirname(file), nextBase);
    if (fs.existsSync(dest)) {
      console.warn("skip rename, exists:", dest);
      continue;
    }
    fs.renameSync(file, dest);
    n += 1;
    console.log("rename", path.relative(root, file), "->", path.relative(root, dest));
  }
  return n;
}

const files = walk(root);
let changed = 0;
for (const file of files) {
  // skip minified hashed frontend build assets (regenerate via frontend build)
  if (/[\\/]static[\\/]app[\\/]assets[\\/].+\.js$/i.test(file)) continue;
  const before = fs.readFileSync(file, "utf8");
  const after = transform(before);
  if (after !== before) {
    fs.writeFileSync(file, after, "utf8");
    changed += 1;
  }
}
console.log(`content-updated: ${changed}`);
console.log(`renamed: ${renameFiles(walk(root))}`);
