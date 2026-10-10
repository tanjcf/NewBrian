/**
 * PPT-CONTENT-THEME-SMOKE-001
 * Packaging must run this case and stop when it fails.
 * PPT/HTML decks take a theme designed from the deck content.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";
import { resolveDeckTheme, writeHtmlDeck, writePptxDeck } from "./presentation-deck.js";

const CASE_ID = "PPT-CONTENT-THEME-SMOKE-001";
const FROZEN_ACCENT = "0D9488";
const here = path.dirname(fileURLToPath(import.meta.url));

function readZipEntry(buffer, suffix) {
  let offset = 0;
  while (offset + 30 < buffer.length) {
    if (buffer.readUInt32LE(offset) !== 0x04034b50) break;
    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = buffer.toString("utf8", nameStart, nameStart + nameLength);
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    if (name.endsWith(suffix)) {
      if (method === 0) return compressed.toString("utf8");
      if (method === 8) return inflateRawSync(compressed).toString("utf8");
    }
    offset = dataStart + compressedSize;
  }
  return "";
}

test(`${CASE_ID} uses the model theme designed for this deck`, async () => {
  const input = {
    title: "故宫青铜器",
    theme: { name: "青铜礼器", mood: "矿物、暖纸", accent: "#C45C26", ink: "#1C1410", surface: "#F7F1E8" },
    slides: [{ title: "纹样", bullets: ["饕餮纹", "云雷纹"] }]
  };
  const theme = resolveDeckTheme(input);
  assert.equal(theme.source, "model");
  assert.equal(theme.accent, "C45C26");
  assert.equal(theme.name, "青铜礼器");
  assert.notEqual(theme.accent, FROZEN_ACCENT);

  const root = await mkdtemp(path.join(tmpdir(), "ppt-theme-smoke-"));
  try {
    const pptxPath = path.join(root, "outputs", "bronze.pptx");
    const htmlPath = path.join(root, "outputs", "bronze.slides.html");
    const written = await writePptxDeck(input, pptxPath, () => [], { workspaceRoot: root });
    assert.equal(written.theme.accent, "C45C26");
    const pptx = await readFile(pptxPath);
    const slideXml = readZipEntry(pptx, "slide1.xml");
    assert.match(slideXml, /C45C26/);
    assert.doesNotMatch(slideXml, new RegExp(FROZEN_ACCENT));
    await writeHtmlDeck(input, htmlPath, () => []);
    const html = await readFile(htmlPath, "utf8");
    assert.match(html, /--accent:\s*#C45C26/);
    assert.match(html, /青铜礼器/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test(`${CASE_ID} shared team themes stay on one catalog`, () => {
  const magazine = resolveDeckTheme({ title: "深海科考", theme: { id: "magazine", name: "电子杂志", accent: "#8C4A2F" } });
  const swiss = resolveDeckTheme({ title: "深海科考", theme: { id: "swiss", name: "瑞士网格", accent: "#002FA7" } });
  assert.equal(magazine.source, "team");
  assert.equal(swiss.source, "team");
  assert.equal(magazine.accent, "8C4A2F");
  assert.equal(swiss.accent, "002FA7");
  assert.equal(magazine.fontTitle, "SimSun");
  assert.notEqual(magazine.fontTitle, swiss.fontTitle);
  assert.notEqual(magazine.accent, swiss.accent);
});

test(`${CASE_ID} derives different themes from different deck content`, () => {
  const bronze = resolveDeckTheme({ title: "故宫青铜器", slides: [{ title: "纹样", body: "礼器" }] });
  const ocean = resolveDeckTheme({ title: "深海科考", slides: [{ title: "航次", body: "采样" }] });
  assert.equal(bronze.source, "content");
  assert.equal(ocean.source, "content");
  assert.equal(bronze.accent, "8C4A2F");
  assert.equal(ocean.accent, "2563EB");
  assert.notEqual(bronze.accent, ocean.accent);
  assert.notEqual(bronze.accent, FROZEN_ACCENT);
  assert.notEqual(ocean.accent, FROZEN_ACCENT);
});

test(`${CASE_ID} tells the model to design a theme and does not keep one frozen palette`, () => {
  const deckSource = readFileSync(path.join(here, "presentation-deck.js"), "utf8");
  const toolSource = readFileSync(path.join(here, "tool-registry.js"), "utf8");
  const promptSource = readFileSync(path.join(here, "../../desktop/src/main/native-tool-prompt-policy.ts"), "utf8");
  assert.doesNotMatch(deckSource, /DECK_THEME|0D9488/);
  assert.match(deckSource, /resolveDeckTheme/);
  assert.match(toolSource, /design theme from this deck's subject/);
  assert.match(toolSource, /Do not reuse one fixed palette/);
  assert.match(promptSource, /Design theme from the deck subject/);
  assert.match(promptSource, /Do not reuse one fixed palette/);
});
