/**
 * One-shot product rename: NewBrain/newbrain -> NewBrain/newbrain
 * Preserves OpenAI Codex / @codex-forge / .codex-plugin identities.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const SKIP_DIR_NAMES = new Set([
  ".git",
  ".materialized",
  "node_modules",
  "out",
  "dist",
  "release",
  "ulit-patch-work",
  "ulit-patch-build-20260807-005002",
  "tmp",
  "tmp-asar-tools",
  "tmp-game-e2e",
  "tmp-mysql-query",
  "tmp-quant-live",
  "tmp-data",
]);

const TEXT_EXT = new Set([
  ".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".md", ".css", ".html", ".htm",
  ".ps1", ".cmd", ".bat", ".sh", ".yml", ".yaml", ".xml", ".wxl", ".txt", ".svg",
  ".plist", ".gradle", ".properties", ".env", ".d.ts",
]);

const ROOT_ALLOW_FILES = new Set(["package.json", "README.md", "adas"]);

/** @type {Array<[RegExp|string, string]>} */
const MASKS = [
  [/@codex-forge\//g, "@codex-forge/"],
  [/\.codex-plugin\b/g, ".codex-plugin"],
  [/\.codex\b/g, ".codex"],
  [/codex-storage/g, "codex-storage"],
  [/openai-wire/g, "openai-wire"],
];

// Ordered replacements (after masking). Longest / most specific first.
const REPLACEMENTS = [
  [/cn\.newbrain\.mac\.desktop/g, "cn.newbrain.mac.desktop"],
  [/cn\.newbrain\.desktop/g, "cn.newbrain.desktop"],
  [/newbrain-artifact/g, "newbrain-artifact"],
  [/newbrain-attachment/g, "newbrain-attachment"],
  [/newbrain-localization/g, "newbrain-localization"],
  [/newbrain-plugin/g, "newbrain-plugin"],
  [/newbrain-source/g, "newbrain-source"],
  [/newbrain\.bootstrap\.json/g, "newbrain.bootstrap.json"],
  [/newbrain\.config\.json/g, "newbrain.config.json"],
  [/newbrain\.features\.json/g, "newbrain.features.json"],
  [/newbrain\.workspaces\.json/g, "newbrain.workspaces.json"],
  [/newbrain\.arch\.json/g, "newbrain.arch.json"],
  [/newbrain\.archivedThreadIds/g, "newbrain.archivedThreadIds"],
  [/newbrain\.ico/g, "newbrain.ico"],
  [/newbrain\.local/g, "newbrain.local"],
  [/@newbrain-mac\//g, "@newbrain-mac/"],
  [/@newbrain-ubuntu\//g, "@newbrain-ubuntu/"],
  [/NEWBRAIN_/g, "NEWBRAIN_"],
  [/X-NewBrain-/g, "X-NewBrain-"],
  [/LaunchNewbrain/g, "LaunchNewbrain"],
  [/userNewbrainPath/g, "userNewbrainPath"],
  [/\.newbrain\b/g, ".newbrain"],
  [/newbrain/g, "newbrain"],
  [/window\.newbrain/g, "window.newbrain"],
  [/exposeInMainWorld\("newbrain"/g, 'exposeInMainWorld("newbrain"'],
  [/exposeInMainWorld\('newbrain'/g, "exposeInMainWorld('newbrain'"],
  [/\bcodecn\?/g, "newbrain?"],
  [/\bcodecn!/g, "newbrain!"],
  [/\bcodecn\./g, "newbrain."],
  [/\{ newbrain \}/g, "{ newbrain }"],
  [/\{newbrain\}/g, "{newbrain}"],
  [/\bcodecn\b/g, "newbrain"],
  [/NewBrain Mac/g, "NewBrain Mac"],
  [/NewBrain/g, "NewBrain"],
  [/NewBrain/g, "NewBrain"],
  [/NEWBRAIN\b/g, "NEWBRAIN"],
];

const FILE_RENAMES = [
  // basename patterns — applied deepest-first later
  ["newbrain.bootstrap.json", "newbrain.bootstrap.json"],
  ["newbrain.config.json", "newbrain.config.json"],
  ["newbrain.features.json", "newbrain.features.json"],
  ["newbrain.workspaces.json", "newbrain.workspaces.json"],
  ["newbrain.arch.json", "newbrain.arch.json"],
  ["newbrain.ico", "newbrain.ico"],
  ["newbrain-localization.wxl", "newbrain-localization.wxl"],
  [".newbrain-source.json", ".newbrain-source.json"],
];

function shouldSkipDir(name) {
  if (SKIP_DIR_NAMES.has(name)) return true;
  if (name.startsWith("tmp-") && name !== "tmp") return true;
  if (name.startsWith("ulit-patch")) return true;
  if (name.startsWith("evidence")) return true;
  return false;
}

function isTextFile(filePath) {
  const base = path.basename(filePath);
  if (base === "SKILL.md" || base.endsWith(".md")) return true;
  const ext = path.extname(base).toLowerCase();
  if (TEXT_EXT.has(ext)) return true;
  if (!ext && ROOT_ALLOW_FILES.has(base)) return true;
  return false;
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
      // skip nested .newbrain project fixtures under apps/desktop that are runtime data? still rename content
      walk(full, out);
    } else if (ent.isFile()) {
      out.push(full);
    }
  }
  return out;
}

function mask(text) {
  let next = text;
  for (const [re, token] of MASKS) {
    next = next.replace(re, token);
  }
  // Protect remaining standalone "Codex" (OpenAI product) when not already masked
  next = next.replace(/\bCodex\b/g, "Codex");
  next = next.replace(/\bcodex\b/g, "codex");
  return next;
}

function unmask(text) {
  return text
    .replace(/@codex-forge//g, "@codex-forge/")
    .replace(/.codex-plugin/g, ".codex-plugin")
    .replace(/.codex/g, ".codex")
    .replace(/codex-storage/g, "codex-storage")
    .replace(/openai-wire/g, "openai-wire")
    .replace(/Codex/g, "Codex")
    .replace(/codex/g, "codex");
}

function transformContent(text) {
  let next = mask(text);
  for (const [re, to] of REPLACEMENTS) {
    next = next.replace(re, to);
  }
  // Fix Window interface patterns that may not have matched
  next = next.replace(/newbrain\?:/g, "newbrain?:");
  next = next.replace(/Window\["newbrain"\]/g, 'Window["newbrain"]');
  next = unmask(next);
  return next;
}

function collectTargets() {
  const files = [];
  for (const top of ["shared", "platforms", "scripts", "docs", ".cursor"]) {
    const p = path.join(root, top);
    if (fs.existsSync(p)) walk(p, files);
  }
  for (const name of ROOT_ALLOW_FILES) {
    const p = path.join(root, name);
    if (fs.existsSync(p)) files.push(p);
  }
  // root assets helper only
  const assets = path.join(root, "assets");
  if (fs.existsSync(assets)) walk(assets, files);
  return files.filter(isTextFile);
}

function renameFiles() {
  const all = [];
  for (const top of ["shared", "platforms", "scripts", "docs", ".cursor", "assets"]) {
    const p = path.join(root, top);
    if (fs.existsSync(p)) walk(p, all);
  }

  // Rename files whose basename contains newbrain / NewBrain
  const fileCandidates = all.filter((f) => /newbrain|NewBrain|NewBrain/i.test(path.basename(f)));
  fileCandidates.sort((a, b) => b.length - a.length);
  let renamed = 0;
  for (const file of fileCandidates) {
    const base = path.basename(file);
    let nextBase = base;
    for (const [from, to] of FILE_RENAMES) {
      if (nextBase === from) nextBase = to;
    }
    nextBase = nextBase
      .replace(/NewBrain/g, "NewBrain")
      .replace(/NewBrain/g, "NewBrain")
      .replace(/newbrain/g, "newbrain");
    if (nextBase === base) continue;
    const dest = path.join(path.dirname(file), nextBase);
    if (fs.existsSync(dest)) {
      console.warn("skip rename, dest exists:", dest);
      continue;
    }
    fs.renameSync(file, dest);
    renamed += 1;
    console.log("rename", path.relative(root, file), "->", path.relative(root, dest));
  }

  // Rename directories named .newbrain / newbrain / *newbrain*
  const dirs = [];
  function walkDirs(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      if (shouldSkipDir(ent.name)) continue;
      const full = path.join(dir, ent.name);
      walkDirs(full);
      if (/newbrain|NewBrain|NewBrain/i.test(ent.name)) {
        dirs.push(full);
      }
    }
  }
  for (const top of ["shared", "platforms", "docs", "assets", ".cursor", "scripts"]) {
    const p = path.join(root, top);
    if (fs.existsSync(p)) walkDirs(p);
  }
  dirs.sort((a, b) => b.length - a.length);
  for (const dir of dirs) {
    const base = path.basename(dir);
    const nextName = base
      .replace(/NewBrain/g, "NewBrain")
      .replace(/NewBrain/g, "NewBrain")
      .replace(/newbrain/g, "newbrain");
    if (nextName === base) continue;
    const dest = path.join(path.dirname(dir), nextName);
    if (fs.existsSync(dest)) {
      console.warn("skip dir rename, dest exists:", dest);
      continue;
    }
    fs.renameSync(dir, dest);
    renamed += 1;
    console.log("rename-dir", path.relative(root, dir), "->", path.relative(root, dest));
  }
  return renamed;
}

function main() {
  const files = collectTargets();
  let changed = 0;
  for (const file of files) {
    const before = fs.readFileSync(file, "utf8");
    const after = transformContent(before);
    if (after !== before) {
      fs.writeFileSync(file, after, "utf8");
      changed += 1;
    }
  }
  console.log(`content-updated: ${changed} / ${files.length}`);
  const renamed = renameFiles();
  console.log(`renamed: ${renamed}`);
}

main();
