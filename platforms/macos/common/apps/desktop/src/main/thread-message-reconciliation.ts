export interface ReconcilableMessage {
  id?: string;
  role: string;
  content: string;
  createdAt?: string;
  attachments?: unknown;
}

/**
 * 合并磁盘持久化消息与本次请求携带的消息：
 * - 已有 id 或（无 id 时）role+createdAt+content 完全相同的消息视为重复，跳过；
 * - 新消息补齐 id 与 createdAt 后追加到末尾。
 * 仅接收 user/assistant 消息，工具消息由 rollout 事件单独记录。
 */
export function reconcileThreadMessages<T extends ReconcilableMessage>(
  persisted: T[],
  incoming: ReconcilableMessage[],
  makeMessageId: () => string,
  fallbackCreatedAt: string
): T[] {
  const messages = persisted.map((message) => ({ ...message }));
  const knownIds = new Set(messages.map((message) => message.id));
  const knownLegacyMessages = new Set(
    messages.map((message) => `${message.role}\0${message.createdAt ?? ""}\0${message.content}`)
  );
  for (const message of incoming) {
    if (message.role !== "user" && message.role !== "assistant") continue;
    const legacyKey = `${message.role}\0${message.createdAt ?? ""}\0${message.content}`;
    if ((message.id && knownIds.has(message.id)) || (!message.id && knownLegacyMessages.has(legacyKey))) {
      continue;
    }
    const nextMessage = {
      id: message.id?.trim() || makeMessageId(),
      role: message.role,
      content: message.content,
      attachments: message.attachments,
      createdAt: message.createdAt?.trim() || fallbackCreatedAt
    } as T;
    messages.push(nextMessage);
    knownIds.add(nextMessage.id);
    knownLegacyMessages.add(legacyKey);
  }
  return messages as T[];
}
