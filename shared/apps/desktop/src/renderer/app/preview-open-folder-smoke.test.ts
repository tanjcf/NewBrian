import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { previewFolderOpenRequest } from "./preview-folder-open.ts";

export const CASE_ID = "PREVIEW-OPEN-FOLDER-SMOKE-001";

const workspace = readFileSync(new URL("./WorkspaceModules.tsx", import.meta.url), "utf8");

test(`${CASE_ID} opens the preview file folder instead of saving a copy`, () => {
  const request = previewFolderOpenRequest({
    workspaceId: "workspace-coffee",
    filePath: "outputs/咖啡运营方案-深烘焦糖主题.pptx"
  });
  assert.equal(request.ok, true);
  if (!request.ok) return;
  assert.equal(request.action, "reveal");
  assert.equal(request.filePath, "outputs/咖啡运营方案-深烘焦糖主题.pptx");
  assert.equal(previewFolderOpenRequest({ filePath: "outputs/咖啡运营方案-深烘焦糖主题.pptx" }).ok, false);

  const header = workspace.slice(workspace.indexOf('aria-label="刷新预览"'), workspace.indexOf('aria-label="用系统应用打开"'));
  assert.match(header, /aria-label="打开文件夹"/);
  assert.match(header, /title="打开文件夹"/);
  assert.match(header, /previewFolderOpenRequest\(\{ workspaceId: selectedWorkspace\?\.id, filePath: searchFilePreview\.path \}\)/);
  assert.match(header, /action: request\.action/);
  assert.match(header, /SidebarIcon name="folder-open"/);
  assert.match(header, /已打开文件所在文件夹。/);
  assert.doesNotMatch(header, /下载副本/);
  assert.doesNotMatch(header, /save-as/);
  assert.doesNotMatch(header, /SidebarIcon name="download"/);
  assert.match(workspace, /import \{ previewFolderOpenRequest \} from "\.\/preview-folder-open"/);
});
