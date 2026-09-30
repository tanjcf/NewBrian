import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const main = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
const preload = readFileSync(new URL("../preload/index.ts", import.meta.url), "utf8");
const renderer = readFileSync(new URL("../renderer/app/QuantWorkspace.tsx", import.meta.url), "utf8");

test("read-only quant market IPC bypasses Brain project persistence", () => {
  assert.match(main, /desktopIpcChannels\.quantMarket\.queryBars[\s\S]*desktopMarketBarsClient\.queryBars/);
  assert.match(main, /desktopIpcChannels\.quantMarket\.queryOverview[\s\S]*desktopMarketOverviewClient\.queryOverview/);
  assert.match(main, /desktopIpcChannels\.quantMarket\.queryScreener[\s\S]*desktopMarketOverviewClient\.queryScreener/);
  assert.doesNotMatch(preload, /queryQuantBars:[^\n]*brainWorkspaceIpcChannels/);
});

test("market UI queries do not require a Brain project id", () => {
  assert.match(preload, /queryQuantBars: \(input: \{ query: unknown \}\)/);
  assert.match(preload, /queryQuantMarketOverview: \(input: \{ limit\?: number \}\)/);
  assert.match(preload, /queryQuantMarketScreener: \(input: \{ criteria: Record<string, unknown> \}\)/);
  assert.doesNotMatch(renderer, /if \(!projectId \|\| !window\.newbrain\?\.queryQuantBars/);
  assert.match(renderer, /useWorkspaceSceneState\(projectId \|\| workspaceId/);
});
