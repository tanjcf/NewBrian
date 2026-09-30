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

test("project facts become short NEWBRAIN candidates", () => {
  const facts = extractFacts(
    "请记录本项目桌面端架构：main 负责 IPC，renderer 只做 UI。",
    "已记下架构分层。"
  );
  assert.ok(facts.projectFacts.length >= 1);
  assert.ok(facts.projectFacts.every((line) => line.startsWith("NEWBRAIN候选:")));
  assert.ok(!facts.projectFacts.some((line) => line.startsWith("用户意图:")));
});

test("ensureProjectSkill scaffolds NEWBRAIN.md and Project OS skill", async () => {
  const root = mkdtempSync(join(tmpdir(), "newbrain-project-os-"));
  try {
    const shadow = new UserShadow({ workspacePath: root, projectName: "DemoApp" });
    await shadow.ensureProjectSkill();
    const osPath = join(root, PROJECT_OS_FILENAME);
    assert.equal(existsSync(osPath), true);
    const osText = readFileSync(osPath, "utf8");
    assert.match(osText, /Project OS/);
    assert.match(osText, /NEWBRAIN\.md/);
    const skill = readFileSync(join(shadow.skillPath, "SKILL.md"), "utf8");
    assert.match(skill, /Project OS/);
    assert.match(skill, /NEWBRAIN\.md/);
    assert.match(skill, /Do \*\*not\*\* use tools to create or edit `\.newbrain`/);
    assert.match(skill, /update `NEWBRAIN\.md` with workspace tools/);
    assert.match(skill, /Programming Guardrails \(coding\)/);
    assert.match(skill, /references\/programming-guardrails\.md/);
    assert.match(skill, /workspace\.glob/);
    assert.match(skill, /workspace\.grep/);
    assert.match(skill, /workspace\.read/);
    assert.match(skill, /references\/java-javadoc-rules\.md/);
    assert.match(skill, /references\/backend-technical-design-framework\.md/);
    assert.match(
      readFileSync(join(shadow.referencesPath, "programming-guardrails.md"), "utf8"),
      /Workspace Retrieval|workspace\.glob/
    );
    assert.match(
      readFileSync(join(shadow.referencesPath, "java-javadoc-rules.md"), "utf8"),
      /Mandatory method template/
    );
    assert.match(
      readFileSync(join(shadow.referencesPath, "backend-technical-design-framework.md"), "utf8"),
      /Layered backend structure/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ensureProjectSkill upgrades older project-manager templates with programming pack", async () => {
  const root = mkdtempSync(join(tmpdir(), "newbrain-project-os-upgrade-"));
  try {
    const shadow = new UserShadow({ workspacePath: root, projectName: "Legacy" });
    await shadow.ensureProjectSkill();
    writeFileSync(
      join(shadow.skillPath, "SKILL.md"),
      [
        "---",
        "name: legacy-project-manager",
        "description: old",
        "---",
        "",
        "# Legacy",
        "",
        "## Project OS",
        "",
        "NEWBRAIN.md",
        "",
        "## Required Workflow (PAHF)",
        "",
        "Pre-Action Clarification",
        ""
      ].join("\n"),
      "utf8"
    );
    await shadow.ensureProjectSkill();
    const skill = readFileSync(join(shadow.skillPath, "SKILL.md"), "utf8");
    assert.match(skill, /Programming Guardrails \(coding\)/);
    assert.equal(existsSync(join(shadow.referencesPath, "programming-guardrails.md")), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ensureProjectOsFiles does not overwrite existing NEWBRAIN.md", async () => {
  const root = mkdtempSync(join(tmpdir(), "newbrain-project-os-keep-"));
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

test("upgrade seeds NEWBRAIN.md from legacy CLAUDE.md without deleting it", async () => {
  const root = mkdtempSync(join(tmpdir(), "newbrain-project-os-migrate-"));
  try {
    writeFileSync(join(root, "CLAUDE.md"), "# Legacy\n\nUse pnpm test.\n", "utf8");
    const shadow = new UserShadow({ workspacePath: root, projectName: "LegacyApp" });
    const result = await shadow.ensureProjectOsFiles();
    assert.equal(result.created, true);
    assert.equal(result.seededFrom, "CLAUDE.md");
    const newbrain = readFileSync(join(root, PROJECT_OS_FILENAME), "utf8");
    assert.match(newbrain, /Migrated from `CLAUDE\.md`/);
    assert.match(newbrain, /Use pnpm test/);
    assert.equal(readFileSync(join(root, "CLAUDE.md"), "utf8"), "# Legacy\n\nUse pnpm test.\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("absorbExchange persists active preference and digest", async () => {
  const root = mkdtempSync(join(tmpdir(), "newbrain-active-shadow-"));
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

test("absorbExchange persists document.style delivery preferences", async () => {
  const root = mkdtempSync(join(tmpdir(), "newbrain-delivery-style-"));
  try {
    const shadow = new UserShadow({ workspacePath: root, projectName: "DocStyle" });
    const result = await shadow.absorbExchange({
      user: "以后默认正文宋体小四、行距1.5",
      assistant: "已记住交付版式。"
    });
    assert.ok(result.changed.includes("delivery-preferences"));
    assert.ok(result.changed.includes("thread-delivery-preferences"));
    assert.equal(result.threadDeliveryPreferences.domains["document.style"].values.fontFamily, "SimSun");
    assert.equal(result.threadDeliveryPreferences.domains["document.style"].values.lineSpacing, 1.5);
    const file = JSON.parse(readFileSync(join(result.skillPath, "references", "delivery-preferences.json"), "utf8"));
    assert.equal(file.domains["document.style"].values.fontFamily, "SimSun");
    const rules = readFileSync(join(result.skillPath, "references", "user-output-rules.md"), "utf8");
    assert.match(rules, /交付版式:/);

    const pinned = await shadow.pinThreadStyleToProject(result.threadDeliveryPreferences);
    assert.equal(pinned.pinned, true);
    const ui = await shadow.getDeliveryPreferenceUiState(result.threadDeliveryPreferences);
    assert.equal(ui.canPin, false);
    assert.equal(ui.canClear, true);

    const cleared = await shadow.clearDocumentStyle("both", result.threadDeliveryPreferences);
    assert.ok(cleared.changed.includes("thread-delivery-preferences"));
    assert.ok(cleared.changed.includes("delivery-preferences"));
    const clearedUi = await shadow.getDeliveryPreferenceUiState(cleared.threadDeliveryPreferences);
    assert.equal(clearedUi.hasStyle, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ensureProjectSkill clears stale lock left by dead pid", async () => {
  const root = mkdtempSync(join(tmpdir(), "newbrain-stale-lock-"));
  try {
    const shadow = new UserShadow({ workspacePath: root, projectName: "LockDemo" });
    await shadow.ensureProjectSkill();
    const lockPath = join(shadow.referencesPath, "session-digest.md.lock");
    writeFileSync(
      lockPath,
      JSON.stringify({ pid: 999_999_991, createdAt: new Date(Date.now() - 120_000).toISOString() }),
      "utf8"
    );
    const started = Date.now();
    await shadow.ensureProjectSkill();
    assert.ok(Date.now() - started < 3_000, "stale lock must clear without full timeout");
    assert.equal(existsSync(lockPath), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ensureProjectSkill clears corrupt lock metadata", async () => {
  const root = mkdtempSync(join(tmpdir(), "newbrain-corrupt-lock-"));
  try {
    const shadow = new UserShadow({ workspacePath: root, projectName: "CorruptLock" });
    await shadow.ensureProjectSkill();
    const lockPath = join(shadow.referencesPath, "session-digest.md.lock");
    writeFileSync(lockPath, "not-json-lock", "utf8");
    await shadow.ensureProjectSkill();
    assert.equal(existsSync(lockPath), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
