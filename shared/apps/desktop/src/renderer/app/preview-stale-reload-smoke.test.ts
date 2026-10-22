import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  shouldReuseOpenArtifactPreview,
  withArtifactPreviewCacheBust
} from "./file-preview-policy.ts";

export const CASE_ID = "PREVIEW-STALE-RELOAD-SMOKE-001";

const workspace = readFileSync(new URL("./WorkspaceModules.tsx", import.meta.url), "utf8");
const policy = readFileSync(new URL("./file-preview-policy.ts", import.meta.url), "utf8");

test(`${CASE_ID} reopening or refreshing an artifact always reloads disk content`, () => {
  const existing = {
    tabPath: "Docs/自如家服-CRM-包年目标分层架构总览图.svg",
    path: "Docs/自如家服-CRM-包年目标分层架构总览图.svg",
    name: "自如家服-CRM-包年目标分层架构总览图.svg",
    kind: "image",
    previewUrl: "newbrain-artifact://preview/ws/Docs/arch.svg",
    size: 7000
  };
  assert.equal(shouldReuseOpenArtifactPreview({ existing }), false, "chat reopen must not reuse stale tab");
  assert.equal(shouldReuseOpenArtifactPreview({ existing, forceReload: true }), false);
  assert.equal(shouldReuseOpenArtifactPreview({ existing, reuseCached: true }), true);

  const openPreview = workspace.slice(
    workspace.indexOf("const openLocalFilePreview = useCallback"),
    workspace.indexOf("openLocalFilePreviewRef.current = openLocalFilePreview")
  );
  assert.match(openPreview, /shouldReuseOpenArtifactPreview\(\{/);
  assert.match(openPreview, /reuseCached:\s*location\?\.reuseCached/);
  assert.match(openPreview, /withArtifactPreviewCacheBust\(/);
  assert.match(openPreview, /setHtmlPreviewRefreshToken\(\(token\) => token \+ 1\)/);
  assert.doesNotMatch(
    openPreview,
    /isReusableArtifactPreview\(existing\)\s*&&\s*!location\?\.line\s*&&\s*!location\?\.forceReload/
  );

  assert.match(workspace, /forceReload:\s*true/);
  assert.match(
    workspace,
    /openLocalFilePreview\(searchFilePreview\.tabPath \|\| searchFilePreview\.path,\s*\{[\s\S]*forceReload:\s*true/
  );
  assert.match(workspace, /openLocalFilePreview\(filePath,\s*\{\s*forceReload:\s*true\s*\}\)/);
  assert.match(
    workspace,
    /kind === "image"[\s\S]*key=\{`\$\{String\(searchFilePreview\.previewUrl \|\| ""\)\}:\$\{htmlPreviewRefreshToken\}`\}/
  );
  assert.match(workspace, /pptx\|pdf\|docx\|svg\|png\|jpe\?g\|gif\|webp\|md\|html\?/);

  assert.match(policy, /export function shouldReuseOpenArtifactPreview/);
  assert.match(policy, /export function withArtifactPreviewCacheBust/);
  assert.equal(
    withArtifactPreviewCacheBust("newbrain-artifact://preview/ws/Docs/arch.svg", "7675-9"),
    "newbrain-artifact://preview/ws/Docs/arch.svg?v=7675-9"
  );
});
