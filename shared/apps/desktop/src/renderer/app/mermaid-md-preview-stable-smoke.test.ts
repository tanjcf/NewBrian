/**
 * MERMAID-MD-PREVIEW-STABLE-SMOKE-001
 * Packaging must run this case and stop when it fails.
 * Opening a Markdown file with Mermaid architecture diagrams must not
 * bounce between loading and SVG layouts.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  clearMermaidSvgCacheForTests,
  createMermaidDiagramId,
  mermaidInitializeCountForTests,
  peekMermaidSvgCache,
  rememberMermaidSvg
} from "./mermaid-diagram-stability.ts";

export const CASE_ID = "MERMAID-MD-PREVIEW-STABLE-SMOKE-001";

function readFirstExisting(relativeUrls: string[]) {
  for (const relativeUrl of relativeUrls) {
    const file = fileURLToPath(new URL(relativeUrl, import.meta.url));
    if (existsSync(file)) return readFileSync(file, "utf8");
  }
  throw new Error(`Missing smoke source: ${relativeUrls.join(" | ")}`);
}

test(`${CASE_ID} caches rendered SVG so remounts do not flash loading`, () => {
  clearMermaidSvgCacheForTests();
  const source = "flowchart TD\n  A-->B";
  assert.equal(peekMermaidSvgCache(source), "");
  rememberMermaidSvg(source, "<svg data-stable=\"1\"></svg>");
  assert.equal(peekMermaidSvgCache(source), "<svg data-stable=\"1\"></svg>");
  assert.equal(createMermaidDiagramId(":r1:", 2), "newbrain-mermaid-r1-2");
  assert.equal(mermaidInitializeCountForTests(), 0);
});

test(`${CASE_ID} keeps file-preview Mermaid on a flat document with a stable host`, () => {
  const markdown = readFirstExisting([
    "../../../../../../platforms/windows/apps/desktop/src/renderer/app/MarkdownMessage.tsx",
    "./MarkdownMessage.tsx"
  ]);
  const workspace = readFileSync(new URL("./WorkspaceModules.tsx", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

  assert.match(markdown, /loadMermaidOnce/);
  assert.match(markdown, /peekMermaidSvgCache\(source\)/);
  assert.match(markdown, /rememberMermaidSvg\(source, result\.svg\)/);
  assert.match(markdown, /const MermaidDiagram = memo/);
  assert.match(markdown, /useLayoutEffect\(\(\) => \{\s*const host = hostRef\.current;/s);
  assert.match(markdown, /host\.style\.minHeight/);
  assert.match(markdown, /collapsible = true/);
  assert.match(markdown, /useFlatDocument/);
  assert.match(markdown, /data-testid="markdown-mermaid"/);

  assert.match(workspace, /data-testid="workspace-markdown-preview"/);
  assert.match(
    workspace,
    /workspace-markdown-preview[\s\S]{0,400}collapsible=\{false\}/
  );

  assert.match(styles, /\.workspace-artifact-markdown\s*\{[^}]*overflow-anchor:\s*none;/s);
  assert.match(styles, /\.markdown-mermaid\s*,\s*\n\.markdown-mermaid-loading[\s\S]{0,200}overflow-anchor:\s*none;/);
  assert.match(styles, /\.markdown-mermaid\s*\{[^}]*min-height:\s*120px;/s);
  assert.match(styles, /\.markdown-message-file-preview\s*\{[^}]*overflow-anchor:\s*none;/s);
});
