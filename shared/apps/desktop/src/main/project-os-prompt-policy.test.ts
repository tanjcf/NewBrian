import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const {
  buildProjectOsPromptBlock,
  loadProjectOsInstruction,
  selectProjectManagerReferences,
  selectProjectOsSource,
  isDefaultProjectOsScaffold,
  truncateProjectOsText,
  truncateReferenceTail,
  isProjectManagerSkillName,
  PROJECT_OS_FILE_CANDIDATES
} = await import(new URL("./project-os-prompt-policy.ts", import.meta.url).href);

test("truncateProjectOsText keeps short text and marks long cuts", () => {
  assert.equal(truncateProjectOsText("hello"), "hello");
  const long = "x".repeat(100);
  const cut = truncateProjectOsText(long, 40);
  assert.ok(cut.includes("truncated"));
  assert.ok(cut.length < long.length);
});

test("selectProjectManagerReferences keeps prefs and tails digest", () => {
  const selected = selectProjectManagerReferences([
    { name: "user-output-rules.md", content: "- Prefer Chinese\n" },
    { name: "learning-open-questions.md", content: "- (none)\n" },
    { name: "programming-guardrails.md", content: "# Programming Guardrails\n" },
    { name: "session-digest.md", content: `${"old\n".repeat(2_000)}tail-marker` },
    { name: "project-knowledge.md", content: "- NEWBRAIN候选: demo\n" },
    { name: "other.md", content: "should drop" }
  ]);
  const names = selected.map((item) => item.name);
  assert.deepEqual(names, [
    "user-output-rules.md",
    "learning-open-questions.md",
    "programming-guardrails.md",
    "session-digest.md",
    "project-knowledge.md"
  ]);
  assert.ok(!names.includes("other.md"));
  const digest = selected.find((item) => item.name === "session-digest.md");
  assert.ok(digest?.content.includes("tail-marker"));
  assert.ok(digest?.content.includes("omitted") || digest!.content.length <= 5_000);
});

test("loadProjectOsInstruction prefers NEWBRAIN.md then CLAUDE.md then AGENTS.md", async () => {
  const root = mkdtempSync(join(tmpdir(), "newbrain-os-load-"));
  try {
    writeFileSync(join(root, "AGENTS.md"), "# Agents\nfrom agents\n", "utf8");
    let loaded = await loadProjectOsInstruction(root);
    assert.equal(loaded.sourceFile, "AGENTS.md");
    assert.match(loaded.text, /from agents/);

    writeFileSync(join(root, "CLAUDE.md"), "# Claude\nfrom claude\n", "utf8");
    loaded = await loadProjectOsInstruction(root);
    assert.equal(loaded.sourceFile, "CLAUDE.md");
    assert.match(loaded.text, /from claude/);

    writeFileSync(join(root, "NEWBRAIN.md"), "# NewBrain\nfrom newbrain\n", "utf8");
    loaded = await loadProjectOsInstruction(root);
    assert.equal(loaded.sourceFile, "NEWBRAIN.md");
    assert.match(loaded.text, /from newbrain/);
    assert.deepEqual([...PROJECT_OS_FILE_CANDIDATES], ["NEWBRAIN.md", "CLAUDE.md", "AGENTS.md"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("loadProjectOsInstruction prefers real CLAUDE.md over stock NEWBRAIN scaffold", async () => {
  const root = mkdtempSync(join(tmpdir(), "newbrain-os-legacy-"));
  try {
    writeFileSync(
      join(root, "NEWBRAIN.md"),
      "# Demo Project OS\n\nThis file is the **repo-root source of truth** for how NewBrain works.\n\n- Purpose: _(fill in)_\n",
      "utf8"
    );
    writeFileSync(join(root, "CLAUDE.md"), "# Real legacy\n\nAlways run vitest.\n", "utf8");
    const loaded = await loadProjectOsInstruction(root);
    assert.equal(loaded.sourceFile, "CLAUDE.md");
    assert.match(loaded.text, /Always run vitest/);
    assert.equal(isDefaultProjectOsScaffold(readFileSync(join(root, "NEWBRAIN.md"), "utf8")), true);
    const selected = selectProjectOsSource([
      { fileName: "NEWBRAIN.md", text: readFileSync(join(root, "NEWBRAIN.md"), "utf8") },
      { fileName: "CLAUDE.md", text: "real" },
      { fileName: "AGENTS.md", text: "" }
    ]);
    assert.equal(selected.sourceFile, "CLAUDE.md");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("buildProjectOsPromptBlock formats injection and skips empty", () => {
  assert.equal(buildProjectOsPromptBlock(""), "");
  assert.equal(buildProjectOsPromptBlock({ sourceFile: null, text: "  " }), "");
  const block = buildProjectOsPromptBlock({
    sourceFile: "NEWBRAIN.md",
    text: "Build with pnpm test"
  });
  assert.match(block, /Project OS/);
  assert.match(block, /source=NEWBRAIN\.md/);
  assert.match(block, /Build with pnpm test/);
  assert.match(block, /NEWBRAIN\.md/);
  assert.equal(truncateReferenceTail("abc", 10), "abc");
  assert.equal(isProjectManagerSkillName("demo-project-manager"), true);
  assert.equal(isProjectManagerSkillName("other"), false);
});
