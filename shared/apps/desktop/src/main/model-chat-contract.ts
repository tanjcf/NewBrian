import type { ComposerAttachment, ModelChatInput, ModelChatMessageInput } from "@codex-forge/protocol";

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, maxLength: number, optional = false): string | undefined {
  if (optional && value === undefined) return undefined;
  if (typeof value !== "string" || value.length > maxLength) throw new TypeError(`${label} is invalid.`);
  return value;
}

function requiredText(value: unknown, label: string, maxLength: number): string {
  const result = text(value, label, maxLength);
  if (!result?.trim()) throw new TypeError(`${label} is required.`);
  return result;
}

function list(value: unknown, label: string, maxLength: number): unknown[] {
  if (!Array.isArray(value) || value.length > maxLength) throw new TypeError(`${label} is invalid.`);
  return value;
}

function parseAttachment(value: unknown): ComposerAttachment {
  const input = record(value, "Model attachment");
  const linkMode = input.linkMode === "local" || input.linkMode === "copied" ? input.linkMode : undefined;
  const sizeBytes = typeof input.sizeBytes === "number" && Number.isFinite(input.sizeBytes)
    ? Math.max(0, Math.trunc(input.sizeBytes))
    : undefined;
  return {
    name: requiredText(input.name, "Attachment name", 512),
    path: requiredText(input.path, "Attachment path", 4_096),
    url: requiredText(input.url, "Attachment URL", 8_192),
    sourcePath: text(input.sourcePath, "Attachment source path", 4_096, true),
    linkMode,
    sizeBytes
  };
}

function parseMessage(value: unknown): ModelChatMessageInput {
  const input = record(value, "Model message");
  if (input.role !== "system" && input.role !== "user" && input.role !== "assistant") throw new TypeError("Model message role is invalid.");
  return {
    id: text(input.id, "Model message ID", 256, true),
    role: input.role,
    content: text(input.content, "Model message content", 1_048_576) ?? "",
    createdAt: text(input.createdAt, "Model message timestamp", 128, true),
    attachments: input.attachments === undefined ? undefined : list(input.attachments, "Model message attachments", 20).map(parseAttachment)
  };
}

export function parseModelChatInput(value: unknown): ModelChatInput {
  const input = record(value, "Model chat input");
  if (input.wireApi !== "responses" && input.wireApi !== "chat.completions") throw new TypeError("Model wire API is invalid.");
  if (input.reasoningEffort !== "low" && input.reasoningEffort !== "medium" && input.reasoningEffort !== "high" && input.reasoningEffort !== "xhigh") throw new TypeError("Reasoning effort is invalid.");
  if (typeof input.disableResponseStorage !== "boolean") throw new TypeError("Response storage flag must be a boolean.");
  if (input.permissionMode !== undefined && input.permissionMode !== "full" && input.permissionMode !== "approval" && input.permissionMode !== "agent") throw new TypeError("Permission mode is invalid.");
  const messages = list(input.messages, "Model messages", 500).map(parseMessage);
  if (messages.reduce((sum, message) => sum + message.content.length, 0) > 5_242_880) throw new TypeError("Model message content is too large.");
  const selectedSkillNames = input.selectedSkillNames === undefined ? undefined : list(input.selectedSkillNames, "Selected skills", 100).map((item) => requiredText(item, "Selected skill name", 256));
  const composerModes = input.composerModes === undefined ? undefined : list(input.composerModes, "Composer modes", 2).map((mode) => {
    if (mode !== "goal" && mode !== "plan") throw new TypeError("Composer mode is invalid.");
    return mode;
  });
  return {
    requestId: requiredText(input.requestId, "Model request ID", 256),
    workspaceId: text(input.workspaceId, "Workspace ID", 256, true)?.trim() || undefined,
    threadId: text(input.threadId, "Thread ID", 256, true)?.trim() || undefined,
    provider: requiredText(input.provider, "Model provider", 256),
    baseUrl: text(input.baseUrl, "Model base URL", 8_192) ?? "",
    apiKey: text(input.apiKey, "Model API key", 32_768) ?? "",
    wireApi: input.wireApi,
    model: requiredText(input.model, "Model name", 512),
    reviewModel: text(input.reviewModel, "Review model", 512) ?? "",
    reasoningEffort: input.reasoningEffort,
    disableResponseStorage: input.disableResponseStorage,
    // `approval` is a removed legacy UI tier. Preserve wire compatibility for
    // old persisted turns while executing them with agent-managed approval.
    permissionMode: input.permissionMode === "full" ? "full" : "agent",
    systemPrompt: text(input.systemPrompt, "System prompt", 1_048_576) ?? "",
    toolContext: text(input.toolContext, "Tool context", 1_048_576, true),
    selectedSkillNames,
    composerModes,
    messages
  };
}
