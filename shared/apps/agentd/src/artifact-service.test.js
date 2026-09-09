import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { ArtifactService, inferArtifactKind } from "./artifact-service.js";
import { ToolHostClient } from "./tool-host-client.js";

function createStoredZip(entries) {
  const locals = [];
  const centrals = [];
  let localOffset = 0;
  for (const [entryName, entryContent] of Object.entries(entries)) {
    const name = Buffer.from(entryName);
    const content = Buffer.from(entryContent);
    const local = Buffer.alloc(30 + name.length + content.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt32LE(content.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    content.copy(local, 30 + name.length);
    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt32LE(content.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(localOffset, 42);
    name.copy(central, 46);
    locals.push(local);
    centrals.push(central);
    localOffset += local.length;
  }
  const centralSize = centrals.reduce((total, item) => total + item.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(locals.length, 8);
  eocd.writeUInt16LE(locals.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...locals, ...centrals, eocd]);
}

test("creates and validates code and web artifacts through the Tool Host", async () => {
  const workspacePath = await mkdtemp(path.join(tmpdir(), "newbrain-artifact-"));
  try {
    const host = new ToolHostClient({ timeoutMs: 10_000 });
    const service = new ArtifactService({ workspacePath, invokeTool: (name, input) => host.invoke(name, input, { workspacePath, shellEnv: {} }) });
    const code = await service.create({ targetPath: "src/main.ts", content: "export const ready = true;" });
    const web = await service.create({ targetPath: "site/index.html", content: "<!doctype html><html><body>Ready</body></html>" });
    assert.equal(code.ok, true);
    assert.equal(web.ok, true);
    assert.equal(inferArtifactKind("report.xlsx"), "spreadsheet");
  } finally {
    await rm(workspacePath, { recursive: true, force: true });
  }
});

test("rejects a fake Office artifact", async () => {
  const workspacePath = await mkdtemp(path.join(tmpdir(), "newbrain-artifact-office-"));
  try {
    const host = new ToolHostClient({ timeoutMs: 10_000 });
    const service = new ArtifactService({ workspacePath, invokeTool: (name, input) => host.invoke(name, input, { workspacePath, shellEnv: {} }) });
    const result = await service.create({ targetPath: "report.docx", content: "not a zip" });
    assert.equal(result.ok, false);
    assert.equal(result.gates.find((gate) => gate.id === "office-package").status, "failed");
  } finally {
    await rm(workspacePath, { recursive: true, force: true });
  }
});

test("parses OOXML structure and visible presentation content", async () => {
  const workspacePath = await mkdtemp(path.join(tmpdir(), "newbrain-artifact-pptx-"));
  try {
    const host = new ToolHostClient({ timeoutMs: 10_000 });
    const service = new ArtifactService({ workspacePath, invokeTool: (name, input) => host.invoke(name, input, { workspacePath, shellEnv: {} }) });
    const pptx = createStoredZip({
      "ppt/presentation.xml": "<p:presentation/>",
      "ppt/slides/slide1.xml": "<p:sld><a:t>第一张幻灯片</a:t></p:sld>"
    });
    const result = await service.create({ targetPath: "deck.pptx", content: pptx.toString("base64"), encoding: "base64" });
    const rendered = await service.render({ targetPath: "deck.pptx" });
    assert.equal(result.ok, true);
    assert.equal(result.inspection.office.entryCount, 1);
    assert.match(rendered.preview, /第一张幻灯片/);
  } finally {
    await rm(workspacePath, { recursive: true, force: true });
  }
});
