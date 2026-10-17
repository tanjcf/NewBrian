import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { absoluteWorkspaceFilePath, planPreviewSystemOpen, planPreviewVsCodeOpen } from "./preview-file-menu.ts";

export const CASE_ID = "PREVIEW-FILE-MENU-SMOKE-001";

const workspace = readFileSync(new URL("./WorkspaceModules.tsx", import.meta.url), "utf8");

function readWindowsMain() {
  const candidates = [
    new URL("../../main/index.ts", import.meta.url),
    new URL("../../../../../../platforms/windows/apps/desktop/src/main/index.ts", import.meta.url)
  ];
  const found = candidates.find((url) => existsSync(url));
  if (!found) throw new Error("Windows main index.ts was not found for the preview file menu smoke.");
  return readFileSync(found, "utf8");
}

test(`${CASE_ID} opens the system app, copies the full path, and launches VS Code`, () => {
  const filePath = "outputs/咖啡运营方案-深烘焦糖主题.pptx";
  const systemOpen = planPreviewSystemOpen({ workspaceId: "workspace-coffee", filePath });
  assert.equal(systemOpen.ok, true);
  if (systemOpen.ok) assert.equal(systemOpen.action, "open-with");
  const vsCode = planPreviewVsCodeOpen({ workspaceId: "workspace-coffee", filePath });
  assert.equal(vsCode.ok, true);
  if (vsCode.ok) assert.equal(vsCode.action, "open-vscode");
  const copied = absoluteWorkspaceFilePath("D:\\work\\coffee-project", filePath);
  assert.equal(copied.ok, true);
  if (copied.ok) {
    assert.equal(copied.path, "D:\\work\\coffee-project\\outputs\\咖啡运营方案-深烘焦糖主题.pptx");
    assert.equal(copied.path.includes("coffee-project\\outputs\\"), true);
  }
  assert.equal(absoluteWorkspaceFilePath("", filePath).ok, false);

  const menuStart = workspace.indexOf('className="artifact-more-menu"');
  const menu = workspace.slice(menuStart, workspace.indexOf(">用 VS Code 打开</button>", menuStart));
  assert.match(menu, /planPreviewSystemOpen\(\{ workspaceId: selectedWorkspace\?\.id, filePath: searchFilePreview\.path \}\)/);
  assert.match(menu, /absoluteWorkspaceFilePath\(String\(selectedWorkspace\?\.path \|\| ""\), searchFilePreview\.path\)/);
  assert.match(menu, /planPreviewVsCodeOpen\(\{ workspaceId: selectedWorkspace\?\.id, filePath: searchFilePreview\.path \}\)/);
  assert.match(menu, /已复制完整路径。/);
  assert.doesNotMatch(menu, /openComposerAttachment/);
  assert.doesNotMatch(menu, /copyTextToClipboard\(searchFilePreview\.path\)/);
  assert.match(workspace, /import \{ absoluteWorkspaceFilePath, planPreviewSystemOpen, planPreviewVsCodeOpen \} from "\.\/preview-file-menu"/);

  const main = readWindowsMain();
  const openWith = main.slice(main.indexOf('input.action === "open-with"'), main.indexOf('input.action === "open-tool"'));
  assert.match(openWith, /electronShell\.openPath\(targetPath\)/);
  assert.match(openWith, /已用系统应用打开。/);
  assert.doesNotMatch(openWith, /OpenAs_RunDLL/);
  const vsCodeHandler = main.slice(main.indexOf('item.id === "vscode"'), main.indexOf("return { ok: true, detail: \"已用 VS Code 打开。\" }"));
  assert.match(vsCodeHandler, /resolveSystemToolCommand\(vscodeTool\)/);
  assert.doesNotMatch(vsCodeHandler, /spawnDetachedAndConfirm\("code"/);
  assert.match(main, /已用 VS Code 打开。/);
});
