import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readCandidateBundle, scaffoldGameStudios } from "./garden-integration-service.ts";

test("candidate submission preserves references and rejects outside paths and junctions", async () => {
  const root = await mkdtemp(join(tmpdir(), "brain-candidate-"));
  try {
    const candidate = join(root, ".brain/candidates/test");
    await mkdir(join(candidate, "references"), { recursive: true });
    for (const [name, text] of Object.entries({ "SKILL.md": "# Test", "sources.md": "Source", "evaluation.json": "{}", "references/a.md": "Reference" })) {
      await writeFile(join(candidate, name), text);
    }
    assert.equal((await readCandidateBundle(root, ".brain/candidates/test"))["references/a.md"], "Reference");
    await assert.rejects(readCandidateBundle(root, "../elsewhere"), /CANDIDATE_MUST/);
    await symlink(root, join(candidate, "link"), "junction");
    await assert.rejects(readCandidateBundle(root, ".brain/candidates/test"), /SYMLINK/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Game Studios creates a real directory template and never replaces user stories", async () => {
  const root = await mkdtemp(join(tmpdir(), "brain-game-template-"));
  try {
    const result = await scaffoldGameStudios(root);
    assert.ok(result.created.includes("production/session-state/active.md"));
    await writeFile(join(root, "production/session-state/active.md"), "User story");
    assert.equal((await scaffoldGameStudios(root)).created.length, 0);
    assert.equal(await readFile(join(root, "production/session-state/active.md"), "utf8"), "User story");
  } finally { await rm(root, { recursive: true, force: true }); }
});
