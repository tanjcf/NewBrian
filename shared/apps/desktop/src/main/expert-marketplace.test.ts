/**
 * Unit tests for Expert Marketplace registry / summon helpers.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const {
  buildExpertSummonContext,
  emptyExpertRegistry,
  installExpertFromBuiltin,
  listExpertCatalog,
  readExpertRegistry,
  resolveDelegationRole,
  summonExpertToThread,
  writeExpertRegistry
} = await import(new URL("./expert-marketplace.ts", import.meta.url).href) as typeof import("./expert-marketplace.js");

async function writeSeedExpert(root: string, id: string, memberIds: string[] = []) {
  const expertRoot = join(root, id);
  await mkdir(join(expertRoot, ".codex-plugin"), { recursive: true });
  await mkdir(join(expertRoot, "agents"), { recursive: true });
  await mkdir(join(expertRoot, "skills", `${id}-skill`), { recursive: true });
  const manifest = {
    name: id,
    version: "1.0.0",
    description: "test",
    expertType: memberIds.length ? "team" : "agent",
    agentName: `${id}-lead`,
    teamInfo: memberIds.length
      ? { leadAgent: `${id}-lead`, memberAgents: memberIds }
      : undefined,
    agents: [`./agents/${id}-lead.md`, ...memberIds.map((member) => `./agents/${member}.md`)],
    skills: [`./skills/${id}-skill`],
    displayName: { zh: id, en: id },
    profession: { zh: `${id}-profession`, en: id },
    displayDescription: { zh: "desc", en: "desc" },
    categoryId: "02-Engineering",
    tags: [{ zh: "t1", en: "t1" }],
    quickPrompts: [{ zh: "q1", en: "q1" }],
    members: [
      { id: `${id}-lead`, role: "lead", name: { zh: "lead" } },
      ...memberIds.map((member) => ({ id: member, role: "member", name: { zh: member } }))
    ]
  };
  await writeFile(join(expertRoot, ".codex-plugin", "plugin.json"), JSON.stringify(manifest, null, 2), "utf8");
  await writeFile(join(expertRoot, "agents", `${id}-lead.md`), `# ${id} lead\n`, "utf8");
  for (const member of memberIds) {
    await writeFile(join(expertRoot, "agents", `${member}.md`), `# ${member}\n`, "utf8");
  }
  await writeFile(
    join(expertRoot, "skills", `${id}-skill`, "SKILL.md"),
    `---\nname: ${id}-skill\ndescription: test\n---\n\n# Skill\n`,
    "utf8"
  );
}

test("lists builtin experts and installs into registry", async () => {
  const root = await mkdtemp(join(tmpdir(), "brain-experts-"));
  try {
    const builtinRoot = join(root, "builtin");
    const installedRoot = join(root, "installed");
    const registryPath = join(root, "registry.json");
    await writeSeedExpert(builtinRoot, "senior-developer");
    await writeExpertRegistry(registryPath, emptyExpertRegistry());
    const listed = await listExpertCatalog({
      builtinRoot,
      installedRoot,
      registry: await readExpertRegistry(registryPath)
    });
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.id, "senior-developer");
    assert.equal(listed[0]?.installed, false);
    const installed = await installExpertFromBuiltin({
      expertId: "senior-developer",
      builtinRoot,
      installedRoot,
      registryPath
    });
    assert.equal(installed.installed, true);
    assert.equal(installed.enabled, true);
    assert.ok(installed.skillNames.includes("senior-developer-skill"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("summon binds thread and builds delegate roles", async () => {
  const root = await mkdtemp(join(tmpdir(), "brain-experts-"));
  try {
    const builtinRoot = join(root, "builtin");
    const installedRoot = join(root, "installed");
    const registryPath = join(root, "registry.json");
    await writeSeedExpert(builtinRoot, "software-delivery-team", ["tech-lead", "qa-engineer"]);
    await writeExpertRegistry(registryPath, emptyExpertRegistry());
    const context = await summonExpertToThread({
      threadId: "thread-1",
      expertId: "software-delivery-team",
      registryPath,
      builtinRoot,
      installedRoot
    });
    assert.equal(context.expertId, "software-delivery-team");
    assert.ok(context.allowedDelegateRoles.includes("tech-lead"));
    assert.match(context.systemInstruction, /agent\.delegate/);
    assert.equal(resolveDelegationRole({ requestedRole: "tech-lead", allowedExtraRoles: context.allowedDelegateRoles }), "tech-lead");
    assert.equal(resolveDelegationRole({ requestedRole: "nope", allowedExtraRoles: context.allowedDelegateRoles }), "researcher");
    const built = buildExpertSummonContext({
      id: "x",
      name: "x",
      expertType: "agent",
      displayName: "X",
      profession: "X",
      description: "",
      categoryId: "02-Engineering",
      tags: [],
      quickPrompts: [],
      defaultInitPrompt: "",
      installed: true,
      enabled: true,
      source: "builtin",
      rootPath: builtinRoot,
      agentName: "x-lead",
      memberAgentIds: [],
      skillNames: []
    });
    assert.match(built.systemInstruction, /召唤为 BRAIN 专家/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
