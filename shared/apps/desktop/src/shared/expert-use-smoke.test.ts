import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import {
  isExpertAvailableInWorkspace,
  optionalBrainWorkspaceKey
} from "./expert-workspace-policy.ts";

export const CASE_ID = "EXPERT-USE-SMOKE-001";

function readFirst(urls: URL[]) {
  for (const url of urls) {
    if (existsSync(url)) return readFileSync(url, "utf8");
  }
  throw new Error(`Missing source: ${urls.map((url) => url.pathname).join(" | ")}`);
}

test(`${CASE_ID} marketplace Use keeps the scene so the expert can be summoned`, () => {
  const uiDesigner = { id: "ui-designer" };
  assert.equal(optionalBrainWorkspaceKey("explore"), "explore");
  assert.equal(optionalBrainWorkspaceKey(" software "), "software");
  assert.equal(optionalBrainWorkspaceKey("unknown"), undefined);
  assert.equal(optionalBrainWorkspaceKey(""), undefined);
  assert.equal(isExpertAvailableInWorkspace(uiDesigner, "explore"), true);
  assert.equal(isExpertAvailableInWorkspace(uiDesigner, "software"), true);
  assert.equal(isExpertAvailableInWorkspace(uiDesigner, "unknown"), false);

  const ipc = readFirst([
    new URL("../../../../../platforms/windows/apps/desktop/src/main/workspace-ipc.ts", import.meta.url),
    new URL("../main/workspace-ipc.ts", import.meta.url)
  ]);
  const parseAddThread = ipc.slice(ipc.indexOf("function parseAddThread"), ipc.indexOf("function parseRewindThread"));
  assert.match(parseAddThread, /optionalBrainWorkspaceKey\(record\.brainWorkspaceKey\)/);
  assert.match(parseAddThread, /brainWorkspaceKey/);

  const workspace = readFileSync(new URL("../renderer/app/WorkspaceModules.tsx", import.meta.url), "utf8");
  const useExpert = workspace.slice(workspace.indexOf("const useMarketplaceExpert"), workspace.indexOf("const fullPageFeature"));
  assert.match(useExpert, /brainWorkspaceKey: sceneKey/);
  assert.match(useExpert, /summonExpert\(\{ threadId: thread\.id, expertId, userConfirmed: true \}\)/);
  assert.match(useExpert, /sceneKeys\.includes\(selectedBrainWorkspaceKey\)/);
});
