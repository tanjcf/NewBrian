/**
 * NEW-CHAT-LABEL-SMOKE-001
 * Packaging must run this case and stop when it fails.
 * User-facing default new-thread title and sidebar CTA must use 「新对话」, not 「新线程」.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

export const CASE_ID = "NEW-CHAT-LABEL-SMOKE-001";

function readIfPresent(urls: URL[]) {
  for (const url of urls) {
    if (existsSync(url)) return readFileSync(url, "utf8");
  }
  return "";
}

test(`${CASE_ID} sidebar CTA and default conversation title use 「新对话」`, () => {
  const source = readFileSync(new URL("./WorkspaceModules.tsx", import.meta.url), "utf8");
  assert.match(source, /data-testid="new-chat-button"/);
  assert.match(source, /<strong>新对话<\/strong>/);
  assert.match(source, /label:\s*"新对话"/);
  assert.match(source, /title:\s*"新对话"/);
  assert.match(source, /\|\|\s*"新对话"/);
  assert.doesNotMatch(source, /<strong>新线程<\/strong>/);
  assert.doesNotMatch(source, /label:\s*"新线程"/);
});

test(`${CASE_ID} platform create-thread defaults use 「新对话」`, () => {
  // Prefer same-tree files (materialized package gate); fall back to platforms overlays.
  const sources = [
    readIfPresent([
      new URL("../ui.tsx", import.meta.url),
      new URL("../../../../../../platforms/windows/apps/desktop/src/renderer/ui.tsx", import.meta.url)
    ]),
    readIfPresent([
      new URL("./useDesktopCore.tsx", import.meta.url),
      new URL("../../../../../../platforms/windows/apps/desktop/src/renderer/app/useDesktopCore.tsx", import.meta.url)
    ]),
    readIfPresent([
      new URL("../../../../../../platforms/macos/common/apps/desktop/src/renderer/ui.tsx", import.meta.url)
    ]),
    readIfPresent([
      new URL("../../../../../../platforms/macos/common/apps/desktop/src/renderer/app/useDesktopCore.tsx", import.meta.url)
    ]),
    readIfPresent([
      new URL("../../../../../../platforms/ubuntu/common/apps/desktop/src/renderer/ui.tsx", import.meta.url)
    ]),
    readIfPresent([
      new URL("../../../../../../platforms/ubuntu/common/apps/desktop/src/renderer/app/useDesktopCore.tsx", import.meta.url)
    ])
  ].filter(Boolean);
  assert.ok(sources.length >= 2, "platform login/create-thread sources must be present");
  for (const source of sources) {
    assert.match(source, /\|\|\s*"新对话"/);
    assert.doesNotMatch(source, /\|\|\s*"新线程"/);
    if (source.includes("正在创建")) {
      assert.match(source, /正在创建新对话/);
      assert.doesNotMatch(source, /正在创建新线程/);
    }
    if (source.includes("创建失败")) {
      assert.match(source, /新对话创建失败/);
      assert.doesNotMatch(source, /新线程创建失败/);
    }
  }
});
