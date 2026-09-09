import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";

const {
  detectOpenClawSkillPackage,
  normalizeOpenClawSkillName,
  parseOpenClawSkillFrontmatter,
  scanOpenClawSkillPackage,
  assertZipEntrySafe
} = await import(new URL("./openclaw-skill-package.ts", import.meta.url).href);

const { installOpenClawSkillPackage, collectRelativeFiles } = await import(
  new URL("./openclaw-skill-installer.ts", import.meta.url).href
);

const { parseClawHubSkillRef, searchClawHubSkills, resolveClawHubSkillInstall } = await import(
  new URL("./clawhub-client.ts", import.meta.url).href
);

async function withTempDir(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "newbrain-openclaw-skill-"));
  try {
    return await run(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

test("normalizes OpenClaw skill names and @owner/slug refs", () => {
  assert.equal(normalizeOpenClawSkillName("@owner/Hello World"), "hello-world");
  assert.equal(normalizeOpenClawSkillName("  skill__hunter!! "), "skill-hunter");
  assert.deepEqual(parseClawHubSkillRef("@acme/calendar"), { ownerHandle: "acme", slug: "calendar" });
  assert.deepEqual(parseClawHubSkillRef("calendar"), { slug: "calendar" });
});

test("detects root SKILL.md OpenClaw packages", async () => {
  await withTempDir(async (root) => {
    const skillDir = path.join(root, "hello-world");
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, "SKILL.md"),
      "---\nname: hello-world\ndescription: Say hello when greeted.\n---\n\n# Hello\n",
      "utf8"
    );
    await fs.mkdir(path.join(skillDir, "scripts"));
    await fs.writeFile(path.join(skillDir, "scripts", "hi.js"), "console.log('hi')\n", "utf8");

    const info = await detectOpenClawSkillPackage(skillDir);
    assert.equal(info.layout, "openclaw-root");
    assert.equal(info.name, "hello-world");
    assert.equal(info.hasScripts, true);
    const scan = await scanOpenClawSkillPackage(info);
    assert.equal(scan.ok, true);
    assert.match(scan.warnings.join(" "), /scripts/);
  });
});

test("detects spring nested skill/SKILL.md packages", async () => {
  await withTempDir(async (root) => {
    const skillDir = path.join(root, "gov-writer");
    await fs.mkdir(path.join(skillDir, "skill"), { recursive: true });
    await fs.writeFile(
      path.join(skillDir, "skill", "SKILL.md"),
      "---\nname: gov-writer\ndescription: Government writing helper.\n---\n\n# Gov\n",
      "utf8"
    );
    await fs.mkdir(path.join(skillDir, "knowledge"), { recursive: true });
    await fs.writeFile(path.join(skillDir, "knowledge", "style.md"), "# style\n", "utf8");

    const info = await detectOpenClawSkillPackage(skillDir);
    assert.equal(info.layout, "spring-nested");
    assert.equal(info.name, "gov-writer");
  });
});

test("installs OpenClaw zip into managed skills root", async () => {
  await withTempDir(async (root) => {
    const zip = new JSZip();
    zip.file(
      "demo-skill/SKILL.md",
      "---\nname: demo-skill\ndescription: Demo OpenClaw skill for NewBrain.\n---\n\n# Demo\n"
    );
    zip.file("demo-skill/references/guide.md", "# Guide\n");
    const bytes = await zip.generateAsync({ type: "uint8array" });
    const zipPath = path.join(root, "demo-skill.zip");
    await fs.writeFile(zipPath, bytes);

    const userSkillRoot = path.join(root, "skills");
    const result = await installOpenClawSkillPackage({
      userSkillRoot,
      zipPath,
      acknowledgeRisk: true,
      origin: { source: "zip" }
    });

    assert.equal(result.skill.name, "demo-skill");
    assert.equal(result.skill.source, "openclaw");
    assert.equal(result.skill.executionKind, "instructions");
    assert.deepEqual(result.skill.executionEvidence, ["SKILL.md"]);
    const files = await collectRelativeFiles(result.targetDir);
    assert.ok(files.includes("SKILL.md"));
    assert.ok(files.includes("references/guide.md"));
    assert.ok(files.includes(".clawhub/origin.json"));
    const origin = JSON.parse(await fs.readFile(path.join(result.targetDir, ".clawhub", "origin.json"), "utf8"));
    assert.equal(origin.source, "zip");
    assert.ok(origin.archiveSha256);

    const exportPath = path.join(root, "demo-skill-backup.zip");
    const { exportOpenClawSkillPackageZip } = await import(
      new URL("./openclaw-skill-installer.ts", import.meta.url).href
    );
    const exported = await exportOpenClawSkillPackageZip({
      skillDir: result.targetDir,
      destinationPath: exportPath,
      skillName: "demo-skill"
    });
    assert.equal(exported.fileCount >= 2, true);
    const reloaded = await JSZip.loadAsync(await fs.readFile(exportPath));
    assert.ok(reloaded.file("demo-skill/SKILL.md"));
    assert.ok(reloaded.file("demo-skill/references/guide.md"));
    assert.equal(reloaded.file("demo-skill/.clawhub/origin.json"), null);
  });
});

test("remaps spring layout on install", async () => {
  await withTempDir(async (root) => {
    const source = path.join(root, "spring-skill");
    await fs.mkdir(path.join(source, "skill"), { recursive: true });
    await fs.mkdir(path.join(source, "knowledge"), { recursive: true });
    await fs.writeFile(
      path.join(source, "skill", "SKILL.md"),
      "---\nname: spring-skill\ndescription: Nested spring package.\n---\n\n# Nested\n",
      "utf8"
    );
    await fs.writeFile(path.join(source, "knowledge", "notes.md"), "# notes\n", "utf8");

    const result = await installOpenClawSkillPackage({
      userSkillRoot: path.join(root, "skills"),
      sourceDir: source,
      acknowledgeRisk: true
    });
    const files = await collectRelativeFiles(result.targetDir);
    assert.ok(files.includes("SKILL.md"));
    assert.ok(files.includes("references/notes.md"));
    assert.ok(!files.includes("skill/SKILL.md"));
  });
});

test("blocks zip path traversal", () => {
  assert.throws(() => assertZipEntrySafe("/tmp/stage", "../escape.txt"), /traversal|Unsafe|escapes/i);
});

test("clawhub client parses search and install resolution with mock fetch", async () => {
  const fetchImpl = async (input, init) => {
    assert.equal(init?.signal, undefined);
    const url = String(input);
    if (url.includes("/api/v1/search")) {
      return new Response(
        JSON.stringify({
          results: [
            {
              score: 1,
              slug: "skill-hunter",
              ownerHandle: "kenoodl-synthesis",
              displayName: "Skill Hunter",
              summary: "Find skills"
            }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    if (url.includes("/install")) {
      return new Response(
        JSON.stringify({
          ok: true,
          slug: "skill-hunter",
          installKind: "archive",
          archive: {
            version: "1.0.0",
            downloadUrl: "https://clawhub.ai/download/skill-hunter.zip"
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    throw new Error(`unexpected url ${url}`);
  };

  const hits = await searchClawHubSkills({ query: "hunter", fetchImpl });
  assert.equal(hits[0].slug, "skill-hunter");
  assert.match(hits[0].pageUrl || "", /kenoodl-synthesis/);

  const resolved = await resolveClawHubSkillInstall({
    ref: "@kenoodl-synthesis/skill-hunter",
    fetchImpl
  });
  assert.equal(resolved.ok, true);
  if (resolved.ok) {
    assert.equal(resolved.installKind, "archive");
    assert.equal(resolved.version, "1.0.0");
  }
});

test("frontmatter parser accepts AgentSkills fields", () => {
  const parsed = parseOpenClawSkillFrontmatter(
    "---\nname: calendar\ndescription: Calendar helper\nhomepage: https://example.com\n---\n\nBody\n",
    "fallback"
  );
  assert.equal(parsed.name, "calendar");
  assert.equal(parsed.description, "Calendar helper");
  assert.equal(parsed.homepage, "https://example.com");
});
