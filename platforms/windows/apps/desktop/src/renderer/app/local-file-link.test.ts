import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const { isArtifactFilePath, isLocalFileLink, parseLocalFileReference, resolveLocalArtifactHref, resolveLocalFileLinkTarget } = await import(new URL("./local-file-link.ts", import.meta.url).href) as typeof import("./local-file-link.js");

test("recognizes workspace-relative and absolute filesystem links", () => {
  assert.equal(isLocalFileLink("output-contract-live.txt"), true);
  assert.equal(isLocalFileLink("reports/final speech.md"), true);
  assert.equal(isLocalFileLink("C:\\workspace\\report.docx"), true);
  assert.equal(isLocalFileLink("/workspace/report.pdf"), true);
});

test("recognizes generated document paths without turning ordinary inline code into links", () => {
  assert.equal(isArtifactFilePath("2025年上半年军事发展总结.pdf"), true);
  assert.equal(isArtifactFilePath("C:\\project\\报告.docx"), true);
  assert.equal(isArtifactFilePath("outputs/吉祥物-旺财动画狗.html"), true);
  assert.equal(isArtifactFilePath("generate_pdf.py"), false);
  assert.equal(isArtifactFilePath("pnpm build"), false);
});

test("routes local-file clicks directly without a duplicate global event bus", () => {
  const ui = readFileSync(new URL("../ui.tsx", import.meta.url), "utf8");
  const workspace = readFileSync(new URL("./WorkspaceModules.tsx", import.meta.url), "utf8");
  const registrations = `${ui}\n${workspace}`.match(/addEventListener\("newbrain:open-local-file"/g) ?? [];
  assert.equal(registrations.length, 0);
  assert.match(workspace, /const openLocalFilePreview[\s\S]*setPreviewPlacement\("side"\)[\s\S]*api\.readWorkspaceFile/);
  assert.match(workspace, /reportRendererDiagnostic/);
  assert.match(workspace, /isStaleFilePreviewRequest/);
  assert.match(workspace, /classifyTextPreviewPayload/);
  assert.match(workspace, /findMatchingArtifactTab/);
  assert.match(workspace, /artifactPathsReferToSameFile/);
  assert.match(workspace, /isReusableArtifactPreview/);
});

test("routes restored local links through the preview callback even before workspace metadata is ready", () => {
  const markdown = readFileSync(new URL("./MarkdownMessage.tsx", import.meta.url), "utf8");
  assert.match(markdown, /onOpenLocalFile && localTarget \? parseLocalFileReference\(localTarget\) : null/);
  assert.match(markdown, /openLocalFile\(workspaceId \|\| "", reference!/);
});

test("recovers a local file target from link text when markdown sanitizes its href", () => {
  const markdown = readFileSync(new URL("./MarkdownMessage.tsx", import.meta.url), "utf8");
  assert.match(markdown, /const visibleTarget = typeof children === "string" \? children\.trim\(\) : ""/);
  assert.match(markdown, /const localTarget = resolveLocalFileLinkTarget\(href, visibleTarget\)/);
  assert.match(markdown, /parseLocalFileReference\(localTarget\)/);
});

test("file-change links stop row interactions and open through the local preview callback", () => {
  const workspace = readFileSync(new URL("./WorkspaceModules.tsx", import.meta.url), "utf8");
  assert.match(workspace, /className="assistant-file-link"/);
  assert.match(workspace, /event\.preventDefault\(\)/);
  assert.match(workspace, /event\.stopPropagation\(\)/);
  assert.match(workspace, /openLocalFilePreview\(file\.filePath\)/);
  assert.match(workspace, /className="assistant-file-link"[\s\S]*?onPointerDown=\{\(event\) => event\.stopPropagation\(\)\}/);
});

test("all activity and file-change paths use actionable local-file links", () => {
  const workspace = readFileSync(new URL("./WorkspaceModules.tsx", import.meta.url), "utf8");
  assert.match(workspace, /activity\.type === "patch"[\s\S]*className="assistant-activity-file-link"/);
  assert.match(workspace, /className="assistant-activity-file-link"[\s\S]*openLocalFilePreview\(patchFile\.filePath\)/);
  assert.match(workspace, /className="assistant-file-link"[\s\S]*showWorkspaceFileMenu\(event, file\.filePath\)/);
});

test("markdown and activity links share the same file context menu", () => {
  const markdown = readFileSync(new URL("./MarkdownMessage.tsx", import.meta.url), "utf8");
  const workspace = readFileSync(new URL("./WorkspaceModules.tsx", import.meta.url), "utf8");
  assert.match(markdown, /<LocalFileContextMenu/);
  assert.match(workspace, /<LocalFileContextMenu/);
  assert.match(workspace, /showWorkspaceFileMenu/);
});

test("recovers workspace artifact paths after the browser resolves relative links", () => {
  assert.equal(resolveLocalArtifactHref("http://localhost:5173/outputs/report.pdf", "http://localhost:5173"), "outputs/report.pdf");
  assert.equal(resolveLocalArtifactHref("outputs/report.docx", "http://localhost:5173"), "outputs/report.docx");
  assert.equal(resolveLocalArtifactHref("file:///C:/app/out/renderer/outputs/report.pdf", "file:///C:/app/out/renderer/index.html"), "outputs/report.pdf");
  assert.equal(resolveLocalArtifactHref("https://example.com/outputs/report.pdf", "http://localhost:5173"), null);
});

test("does not route web, email, data, or page links to the filesystem", () => {
  assert.equal(isLocalFileLink("https://example.com/report"), false);
  assert.equal(isLocalFileLink("www.gov.cn"), false);
  assert.equal(isLocalFileLink("www.gov.cn）整理的最新消息："), false);
  assert.equal(isLocalFileLink("mailto:test@example.com"), false);
  assert.equal(isLocalFileLink("data:text/plain,hello"), false);
  assert.equal(isLocalFileLink("#section"), false);
});

test("never replaces a real web href with local-looking link text", () => {
  assert.equal(resolveLocalFileLinkTarget("https://www.gov.cn/", "www.gov.cn）整理的最新消息："), null);
  assert.equal(resolveLocalFileLinkTarget("https://example.com/report", "report.pdf"), null);
  assert.equal(resolveLocalFileLinkTarget("", "outputs/report.pdf"), "outputs/report.pdf");
});

test("separates Codex-style line citations from their filesystem path", () => {
  assert.deepEqual(parseLocalFileReference("C:\\workspace\\app.ts:12:4"), { filePath: "C:\\workspace\\app.ts", line: 12, column: 4 });
  assert.deepEqual(parseLocalFileReference("src/app.ts:12-20"), { filePath: "src/app.ts", line: 12, endLine: 20 });
  assert.deepEqual(parseLocalFileReference("/workspace/app.ts#L12-L20"), { filePath: "/workspace/app.ts", line: 12, endLine: 20 });
  assert.deepEqual(parseLocalFileReference("README.md"), { filePath: "README.md" });
});

test("decodes URL-encoded Chinese artifact paths before opening them", () => {
  assert.deepEqual(
    parseLocalFileReference("outputs/%E7%85%A4%E7%82%AD%E4%BC%81%E4%B8%9A-%E7%AC%AC%E4%B8%80%E7%89%88.pdf"),
    { filePath: "outputs/煤炭企业-第一版.pdf" }
  );
});

test("local file references expose the Codex-style context menu actions", () => {
  const markdown = readFileSync(new URL("./MarkdownMessage.tsx", import.meta.url), "utf8");
  const menu = readFileSync(new URL("./LocalFileContextMenu.tsx", import.meta.url), "utf8");
  assert.match(markdown, /data-local-file-path/);
  for (const label of ["在 Visual Studio 中打开", "打开方式", "复制路径", "复制文件内容", "在资源管理器中打开"]) {
    assert.match(menu, new RegExp(label));
  }
  assert.match(menu, /getSystemTools\(\)/);
  assert.match(menu, /const availableTools = systemTools\.filter\(\(tool\) => tool\.available\)/);
  assert.match(menu, /availableTools\.map/);
  assert.match(menu, /action: "open-tool", toolId: tool\.id/);
  assert.match(menu, /performWorkspaceFileAction/);
});

test("positions the hyperlink context menu below the link and flips only at the viewport edge", () => {
  const menu = readFileSync(new URL("./LocalFileContextMenu.tsx", import.meta.url), "utf8");
  assert.match(menu, /const bounds = element\.getBoundingClientRect\(\)/);
  assert.match(menu, /const belowY = \(point\?\.y \?\? bounds\.bottom\) \+ gap/);
  assert.match(menu, /belowY \+ menuHeight <= window\.innerHeight - 8/);
  assert.match(menu, /point\?\.x \?\? bounds\.left/);
  assert.match(menu, /point\?\.y \?\? bounds\.bottom/);
  assert.match(menu, /createPortal\(menuElement, document\.body\)/);
});

test("line citations open a clean path and select the requested preview range", () => {
  const markdown = readFileSync(new URL("./MarkdownMessage.tsx", import.meta.url), "utf8");
  const workspace = readFileSync(new URL("./WorkspaceModules.tsx", import.meta.url), "utf8");
  assert.match(markdown, /openLocalFile\(workspaceId \|\| "", reference!/);
  assert.match(workspace, /data-preview-line/);
  assert.match(workspace, /scrollIntoView\(\{ block: "center" \}\)/);
  assert.match(workspace, /lineNumber <= \(searchFilePreview\.endLine \|\| searchFilePreview\.line\)/);
});
