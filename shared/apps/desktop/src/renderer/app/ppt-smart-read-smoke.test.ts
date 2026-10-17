import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deflateRawSync, crc32 } from "node:zlib";
import test from "node:test";
import { speechTextForPreview, speechTextFromSlideXml } from "./preview-speech-text.ts";

export const CASE_ID = "PPT-SMART-READ-SMOKE-001";

const button = readFileSync(new URL("./NovelTtsButton.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("./WorkspaceModules.tsx", import.meta.url), "utf8");

function zipStore(files: Array<{ name: string; data: Buffer }>) {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name);
    const compressed = deflateRawSync(file.data);
    const checksum = crc32(file.data) >>> 0;
    const local = Buffer.alloc(30 + name.length + compressed.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    compressed.copy(local, 30 + name.length);
    locals.push(local);
    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(file.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centrals.push(central);
    offset += local.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, eocd]);
}

function slideXml(text: string) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:sp><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>
</p:sld>`;
}

test(`${CASE_ID} reads PPTX slide text when preview content is empty`, async () => {
  const pptx = zipStore([
    { name: "ppt/slides/slide1.xml", data: Buffer.from(slideXml("咖啡运营方案")) },
    { name: "ppt/slides/slide2.xml", data: Buffer.from(slideXml("把每一杯咖啡，做成可复制的生意。")) },
    { name: "[Content_Types].xml", data: Buffer.from("<Types/>") }
  ]);
  const spoken = await speechTextForPreview({
    kind: "pptx",
    content: "",
    dataUrl: `data:application/vnd.openxmlformats-officedocument.presentationml.presentation;base64,${pptx.toString("base64")}`
  });
  assert.match(spoken, /咖啡运营方案/);
  assert.match(spoken, /把每一杯咖啡，做成可复制的生意。/);
  assert.doesNotMatch(spoken, /Content_Types/);
  assert.equal(speechTextFromSlideXml("<a:t>咖啡</a:t><a:t>运营</a:t>"), "咖啡运营");
});

test(`${CASE_ID} preview speaker resolves slide text instead of empty content`, () => {
  const actions = workspace.slice(workspace.indexOf("artifact-file-actions"), workspace.indexOf("artifact-icon-button"));
  assert.match(actions, /className="artifact-tts"/);
  assert.match(actions, /resolveText=\{\(\) => speechTextForPreview\(searchFilePreview\)\}/);
  assert.doesNotMatch(actions, /text=\{String\(searchFilePreview\.content \|\| ""\)\}/);
  assert.match(workspace, /import \{ speechTextForPreview \} from "\.\/preview-speech-text"/);
  assert.match(button, /resolveText/);
  assert.match(button, /source = await resolveText\(\)/);
  assert.match(button, /setPlaying\(true\)/);
  const prepareAt = button.indexOf("prepareNovelSpeechText(source)");
  const resolveAt = button.indexOf("source = await resolveText()");
  assert.ok(resolveAt >= 0 && prepareAt > resolveAt);
  assert.match(button, /onPointerDown=\{\(event\) => event\.stopPropagation\(\)\}/);
  assert.match(button, /toggleMain\(\)/);
});
