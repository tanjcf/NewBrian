import type { ChatMessage } from "@codex-forge/protocol";

export type ThreadHistoryHtmlExportInput = {
  title: string;
  workspaceName?: string;
  threadId?: string;
  exportedAt?: string;
  messages: ChatMessage[];
};

const ROLE_LABELS: Record<string, string> = {
  user: "用户",
  assistant: "助手",
  tool: "工具",
  system: "系统"
};

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function sanitizeExportFileName(title: string): string {
  const cleaned = title
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .slice(0, 80)
    .trim();
  return cleaned || "对话导出";
}

function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role;
}

function renderAttachments(message: ChatMessage): string {
  const attachments = message.attachments ?? [];
  if (!attachments.length) return "";
  const items = attachments.map((item) => {
    const name = escapeHtml(item.name || item.path || "附件");
    const path = escapeHtml(item.path || item.url || "");
    return `<li><code>${name}</code>${path ? ` <span class="meta">${path}</span>` : ""}</li>`;
  });
  return `<div class="attachments"><strong>附件</strong><ul>${items.join("")}</ul></div>`;
}

function renderMessage(message: ChatMessage): string {
  const role = escapeHtml(roleLabel(message.role));
  const createdAt = message.createdAt ? escapeHtml(message.createdAt) : "";
  const reasoning = message.reasoningSummary?.trim()
    ? `<details class="reasoning"><summary>思考摘要</summary><pre>${escapeHtml(message.reasoningSummary)}</pre></details>`
    : "";
  const content = escapeHtml(message.content ?? "");
  return [
    `<article class="message role-${escapeHtml(message.role)}">`,
    `<header><span class="role">${role}</span>${createdAt ? `<time>${createdAt}</time>` : ""}</header>`,
    reasoning,
    `<pre class="content">${content}</pre>`,
    renderAttachments(message),
    `</article>`
  ].join("");
}

/** Build a standalone UTF-8 HTML document for a thread's historical messages. */
export function buildThreadHistoryHtml(input: ThreadHistoryHtmlExportInput): string {
  const title = input.title.trim() || "对话导出";
  const exportedAt = input.exportedAt || new Date().toISOString();
  const metaBits = [
    input.workspaceName ? `工作区：${escapeHtml(input.workspaceName)}` : "",
    input.threadId ? `线程：${escapeHtml(input.threadId)}` : "",
    `导出时间：${escapeHtml(exportedAt)}`,
    `消息数：${input.messages.length}`
  ].filter(Boolean);
  const body = input.messages.length
    ? input.messages.map(renderMessage).join("\n")
    : `<p class="empty">当前对话没有可导出的历史消息。</p>`;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; background: #f6f7f9; color: #1f2328; line-height: 1.55; }
  main { max-width: 920px; margin: 0 auto; padding: 28px 20px 48px; }
  h1 { font-size: 22px; margin: 0 0 8px; }
  .meta { color: #656d76; font-size: 13px; }
  .meta-row { display: flex; flex-wrap: wrap; gap: 12px 18px; margin-bottom: 22px; }
  .message { background: #fff; border: 1px solid #d8dee4; border-radius: 10px; padding: 14px 16px; margin: 0 0 12px; }
  .message header { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 8px; }
  .role { font-weight: 650; }
  .role-user .role { color: #0550ae; }
  .role-assistant .role { color: #1a7f37; }
  .role-tool .role { color: #9a6700; }
  .role-system .role { color: #8250df; }
  time { color: #656d76; font-size: 12px; }
  pre { white-space: pre-wrap; word-break: break-word; margin: 0; font-family: ui-monospace, "Cascadia Mono", Consolas, monospace; font-size: 13px; }
  .reasoning { margin: 0 0 10px; background: #f6f8fa; border-radius: 8px; padding: 8px 10px; }
  .reasoning summary { cursor: pointer; color: #656d76; font-size: 13px; }
  .attachments { margin-top: 10px; font-size: 13px; }
  .attachments ul { margin: 6px 0 0; padding-left: 18px; }
  .empty { color: #656d76; }
</style>
</head>
<body>
<main>
  <h1>${escapeHtml(title)}</h1>
  <div class="meta-row">${metaBits.map((bit) => `<span class="meta">${bit}</span>`).join("")}</div>
  ${body}
</main>
</body>
</html>
`;
}
