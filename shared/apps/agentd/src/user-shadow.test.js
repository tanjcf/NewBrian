import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const {
  UserShadow,
  extractFacts,
  PROJECT_OS_FILENAME
} = await import(new URL("./user-shadow.js", import.meta.url).href);

test("active learning distills corrections without reusable markers", () => {
  const facts = extractFacts(
    "不要用英文总结，改成中文分点输出。",
    "好的，已改为中文分点。"
  );
  assert.ok(facts.outputRules.some((line) => /修正:|偏好:|不要用英文总结/.test(line)));
  assert.match(facts.sessionSummary, /主动学习/);
});

test("active learning always writes a session summary", () => {
  const facts = extractFacts("今天天气怎么样", "今天晴，适合出门。");
  assert.ok(facts.sessionSummary.includes("用户:"));
  assert.ok(facts.sessionSummary.includes("助手:"));
  assert.equal(facts.outputRules.length, 0);
});

test("one-shot task text is not promoted into durable rules", () => {
  const facts = extractFacts(
    "Output exactly OK for this request and create result.txt.",
    "OK"
  );
  assert.ok(!facts.outputRules.some((line) => /create result\.txt/i.test(line)));
});

test("project facts become short CODECN candidates", () => {
  const facts = extractFacts(
    "请记录本项目桌面端架构：main 负责 IPC，renderer 只做 UI。",
    "已记下架构分层。"
  );
  assert.ok(facts.projectFacts.length >= 1);
  assert.ok(facts.projectFacts.every((line) => line.startsWith("CODECN候选:")));
  assert.ok(!facts.projectFacts.some((line) => line.startsWith("用户意图:")));
});

test("ensureProjectSkill scaffolds CODECN.md and Project OS skill", async () => {
  const root = mkdtempSync(join(tmpdir(), "codecn-project-os-"));
  try {
    const shadow = new UserShadow({ workspacePath: root, projectName: "DemoApp" });
    await shadow.ensureProjectSkill();
    const osPath = join(root, PROJECT_OS_FILENAME);
    assert.equal(existsSync(osPath), true);
    const osText = readFileSync(osPath, "utf8");
    assert.match(osText, /Project OS/);
    assert.match(osText, /CODECN\.md/);
    const skill = readFileSync(join(shadow.skillPath, "SKILL.md"), "utf8");
    assert.match(skill, /Project OS/);
    assert.match(skill, /CODECN\.md/);
    assert.match(skill, /Do \*\*not\*\* use tools to create or edit `\.codecn`/);
    assert.match(skill, /update `CODECN\.md` with workspace tools/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ensureProjectOsFiles does not overwrite existing CODECN.md", async () => {
  const root = mkdtempSync(join(tmpdir(), "codecn-project-os-keep-"));
  try {
    const custom = "# Custom Project OS\n\nKeep me.\n";
    writeFileSync(join(root, PROJECT_OS_FILENAME), custom, "utf8");
    const shadow = new UserShadow({ workspacePath: root });
    const result = await shadow.ensureProjectOsFiles();
    assert.equal(result.created, false);
    assert.equal(readFileSync(join(root, PROJECT_OS_FILENAME), "utf8"), custom);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("upgrade seeds CODECN.md from legacy CLAUDE.md without deleting it", async () => {
  const root = mkdtempSync(join(tmpdir(), "codecn-project-os-migrate-"));
  try {
    writeFileSync(join(root, "CLAUDE.md"), "# Legacy\n\nUse pnpm test.\n", "utf8");
    const shadow = new UserShadow({ workspacePath: root, projectName: "LegacyApp" });
    const result = await shadow.ensureProjectOsFiles();
    assert.equal(result.created, true);
    assert.equal(result.seededFrom, "CLAUDE.md");
    const codecn = readFileSync(join(root, PROJECT_OS_FILENAME), "utf8");
    assert.match(codecn, /Migrated from `CLAUDE\.md`/);
    assert.match(codecn, /Use pnpm test/);
    assert.equal(readFileSync(join(root, "CLAUDE.md"), "utf8"), "# Legacy\n\nUse pnpm test.\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("absorbExchange persists active preference and digest", async () => {
  const root = mkdtempSync(join(tmpdir(), "codecn-active-shadow-"));
  try {
    const shadow = new UserShadow({ workspacePath: root });
    const result = await shadow.absorbExchange({
      user: "模块接口文档要写清楚，不要省略字段说明。",
      assistant: "已按你的要求补全字段说明。"
    });
    assert.ok(result.changed.includes("session-digest"));
    assert.ok(
      result.changed.includes("user-output-rules")
      || result.changed.includes("project-knowledge")
    );
    const rules = readFileSync(join(result.skillPath, "references", "user-output-rules.md"), "utf8");
    const digest = readFileSync(join(result.skillPath, "references", "session-digest.md"), "utf8");
    assert.match(digest, /用户:/);
    assert.match(rules, /主动蒸馏|中文|字段说明|修正:|偏好:|规则:/);
    assert.equal(existsSync(join(root, PROJECT_OS_FILENAME)), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
