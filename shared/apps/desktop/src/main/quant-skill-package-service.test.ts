import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { QuantSkillPackageService } from "./quant-skill-package-service.ts";

test("creates and removes a project-scoped managed quantitative Skill package", async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), "newbrain-quant-skill-"));
  try {
    const service = new QuantSkillPackageService(workspacePath);
    const created = await service.create({
      skillId: "sany-trend-verify",
      title: "三一重工趋势验证",
      symbol: "600031",
      strategyId: "trend-following"
    });

    assert.equal(created.created, true);
    assert.equal(created.relativePath, ".newbrain/skills/sany-trend-verify");
    const asset = JSON.parse(await readFile(join(workspacePath, ".newbrain", "skills", "sany-trend-verify", "asset.json"), "utf8"));
    assert.equal(asset.managedBy, "newbrain.quant");
    assert.equal(asset.title, "三一重工趋势验证");
    assert.match(await readFile(join(workspacePath, ".newbrain", "skills", "sany-trend-verify", "SKILL.md"), "utf8"), /600031/);
    assert.match(await readFile(join(workspacePath, ".newbrain", "skills", "sany-trend-verify", "references", "usage.md"), "utf8"), /600031/);

    assert.equal((await service.remove("sany-trend-verify")).removed, true);
    assert.equal((await service.remove("sany-trend-verify")).removed, false);
  } finally {
    await rm(workspacePath, { recursive: true, force: true });
  }
});

test("rejects path traversal and refuses to remove an unmanaged Skill directory", async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), "newbrain-quant-skill-"));
  try {
    const service = new QuantSkillPackageService(workspacePath);
    await assert.rejects(() => service.create({ skillId: "../escape", title: "escape", symbol: "600031", strategyId: "trend-following" }), /skillId/);
    await assert.rejects(() => service.remove("../escape"), /skillId/);
    const unmanaged = join(workspacePath, ".newbrain", "skills", "manual-skill");
    await mkdir(unmanaged, { recursive: true });
    await writeFile(join(unmanaged, "asset.json"), JSON.stringify({ managedBy: "user" }), "utf8");
    await assert.rejects(() => service.remove("manual-skill"), /unmanaged/i);
    const legacy = join(workspacePath, ".newbrain", "skills", "legacy-quant");
    await mkdir(legacy, { recursive: true });
    await writeFile(join(legacy, "asset.json"), JSON.stringify({ name: "legacy-quant", type: "quant", simulationOnly: true }), "utf8");
    assert.equal((await service.remove("legacy-quant")).removed, true);
  } finally {
    await rm(workspacePath, { recursive: true, force: true });
  }
});

test("refuses to replace a rules pack already stored under .newbrain/skills", async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), "newbrain-quant-skill-"));
  try {
    const service = new QuantSkillPackageService(workspacePath);
    const target = join(workspacePath, ".newbrain", "skills", "nuclear-uranium-ai-team");
    await mkdir(target, { recursive: true });
    await writeFile(join(target, "SKILL.md"), "# 团队规则\n", "utf8");
    await assert.rejects(
      () => service.create({ skillId: "nuclear-uranium-ai-team", title: "覆盖", symbol: "600519", strategyId: "trend-following" }),
      /unmanaged/i
    );
    assert.match(await readFile(join(target, "SKILL.md"), "utf8"), /团队规则/);
  } finally {
    await rm(workspacePath, { recursive: true, force: true });
  }
});

test("removes a tool-created quantitative Skill whose ownership marker was lost during a model edit", async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), "newbrain-quant-skill-"));
  try {
    const service = new QuantSkillPackageService(workspacePath);
    const target = join(workspacePath, ".newbrain", "skills", "sany-trend-e2e");
    await mkdir(target, { recursive: true });
    await writeFile(join(target, "asset.json"), JSON.stringify({
      skillId: "sany-trend-e2e",
      title: "三一重工趋势验收",
      symbol: "600031",
      strategyId: "trend-following",
      simulationOnly: true
    }), "utf8");

    assert.equal((await service.remove("sany-trend-e2e")).removed, true);
  } finally {
    await rm(workspacePath, { recursive: true, force: true });
  }
});
