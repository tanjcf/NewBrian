import assert from "node:assert/strict";
import test from "node:test";
import {
  buildThreadHistoryHtml,
  escapeHtml,
  sanitizeExportFileName
} from "./thread-history-html-export.ts";

test("escapes HTML special characters in exported content", () => {
  assert.equal(escapeHtml(`<script>"x"&'y'</script>`), "&lt;script&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/script&gt;");
});

test("sanitizes unsafe file name characters", () => {
  assert.equal(sanitizeExportFileName('你好:对话/导出?*'), "你好_对话_导出__");
  assert.equal(sanitizeExportFileName("   "), "对话导出");
});

test("builds standalone HTML with roles, reasoning, and attachments", () => {
  const html = buildThreadHistoryHtml({
    title: "示例对话 <test>",
    workspaceName: "demo",
    threadId: "thread-1",
    exportedAt: "2026-08-10T00:00:00.000Z",
    messages: [
      {
        id: "u1",
        role: "user",
        content: "给男孩命名 <tanjc>",
        createdAt: "2026-08-10T00:00:01.000Z",
        attachments: [{ name: "ref.png", path: "C:\\tmp\\ref.png", url: "file:///tmp/ref.png" }]
      },
      {
        id: "a1",
        role: "assistant",
        content: "男孩 = tanjc",
        createdAt: "2026-08-10T00:00:02.000Z",
        reasoningSummary: "先读 SVG 再改名"
      },
      {
        id: "t1",
        role: "tool",
        content: "已写入 outputs/demo.svg",
        createdAt: "2026-08-10T00:00:03.000Z"
      }
    ]
  });

  assert.match(html, /<!DOCTYPE html>/);
  assert.match(html, /charset="utf-8"/);
  assert.match(html, /示例对话 &lt;test&gt;/);
  assert.match(html, /用户/);
  assert.match(html, /助手/);
  assert.match(html, /工具/);
  assert.match(html, /给男孩命名 &lt;tanjc&gt;/);
  assert.match(html, /思考摘要/);
  assert.match(html, /先读 SVG 再改名/);
  assert.match(html, /ref\.png/);
  assert.match(html, /消息数：3/);
});

test("renders empty-state copy when there are no messages", () => {
  const html = buildThreadHistoryHtml({
    title: "空对话",
    messages: []
  });
  assert.match(html, /当前对话没有可导出的历史消息/);
});
