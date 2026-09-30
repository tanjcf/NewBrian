export interface DailyBriefingThreadRef {
  id: string;
  title: string;
}

export interface DailyBriefingCatalog {
  workspaces: Array<{
    id: string;
    threads: DailyBriefingThreadRef[];
  }>;
}

export interface StartupDailyBriefingDeps {
  openedAtLogin: boolean;
  accessToken: string;
  gatewayOrigin: string;
  headers: Record<string, string>;
  catalog: DailyBriefingCatalog;
  addThread: (workspaceId: string) => Promise<DailyBriefingCatalog>;
  readMessages: (workspaceId: string, threadId: string) => Promise<Array<{ content?: string }>>;
  appendAssistantMessage: (workspaceId: string, threadId: string, content: string) => Promise<void>;
  activate: (workspaceId: string, threadId: string) => Promise<void>;
  fetchImpl?: typeof fetch;
}

const BRIEFING_TITLE = "今日简报";

export async function deliverStartupDailyBriefing(
  deps: StartupDailyBriefingDeps
): Promise<"skipped" | "present" | "inserted"> {
  if (!deps.openedAtLogin) {
    return "skipped";
  }
  const token = deps.accessToken.trim();
  const origin = deps.gatewayOrigin.replace(/\/$/, "");
  if (!token || !origin) {
    return "skipped";
  }
  const fetchImpl = deps.fetchImpl ?? fetch;
  const response = await fetchImpl(`${origin}/api/desktop/v1/daily-briefing`, {
    method: "POST",
    headers: {
      ...deps.headers,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ openedAtLogin: true })
  });
  if (!response.ok) {
    return "skipped";
  }
  const payload = await response.json() as { ok?: boolean; text?: string; date?: string };
  const text = typeof payload.text === "string" ? payload.text : "";
  const date = typeof payload.date === "string" ? payload.date : "";
  if (payload.ok !== true || !text || !date) {
    return "skipped";
  }
  const workspace = deps.catalog.workspaces[0];
  if (!workspace) {
    return "skipped";
  }
  let thread = workspace.threads.find((item) => item.title === BRIEFING_TITLE);
  if (!thread) {
    const catalog = await deps.addThread(workspace.id);
    thread = catalog.workspaces
      .find((item) => item.id === workspace.id)
      ?.threads.find((item) => item.title === BRIEFING_TITLE);
  }
  if (!thread) {
    return "skipped";
  }
  const messages = await deps.readMessages(workspace.id, thread.id);
  if (messages.some((item) => String(item.content ?? "").includes(date))) {
    return "present";
  }
  await deps.appendAssistantMessage(workspace.id, thread.id, text);
  await deps.activate(workspace.id, thread.id);
  return "inserted";
}

export interface DailyBriefingChatTurn {
  workspaceId?: string;
  threadId?: string;
  requestId: string;
  messages: Array<{ id?: string; role?: string; content?: string; createdAt?: string }>;
}

export interface DailyBriefingStoredMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export interface DailyBriefingChatHost {
  readAccessToken: () => Promise<string>;
  readGatewayOrigin: () => Promise<string>;
  createHeaders: (accessToken: string) => Record<string, string>;
  readThreadTitle: (workspaceId: string, threadId: string) => Promise<string>;
  appendMessages: (workspaceId: string, threadId: string, messages: DailyBriefingStoredMessage[]) => Promise<void>;
  snapshot: () => Promise<unknown>;
  nowIso: () => string;
  fetchImpl?: typeof fetch;
}

let dailyBriefingChatHost: DailyBriefingChatHost | null = null;

export function setDailyBriefingChatHost(host: DailyBriefingChatHost | null): void {
  dailyBriefingChatHost = host;
}

export async function tryHandleDailyBriefingChat(
  turn: DailyBriefingChatTurn
): Promise<Record<string, unknown> | null> {
  const host = dailyBriefingChatHost;
  if (!host || !turn.workspaceId || !turn.threadId) {
    return null;
  }
  const title = await host.readThreadTitle(turn.workspaceId, turn.threadId);
  if (title !== BRIEFING_TITLE) {
    return null;
  }
  const user = [...turn.messages].reverse().find((item) => item.role === "user" && String(item.content || "").trim());
  if (!user) {
    return null;
  }
  const utterance = String(user.content || "").trim();
  const token = (await host.readAccessToken()).trim();
  const origin = (await host.readGatewayOrigin()).replace(/\/$/, "");
  if (!token || !origin) {
    return null;
  }
  const fetchImpl = host.fetchImpl ?? fetch;
  const response = await fetchImpl(`${origin}/api/desktop/v1/daily-briefing`, {
    method: "POST",
    headers: {
      ...host.createHeaders(token),
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ utterance })
  });
  if (!response.ok) {
    return null;
  }
  const payload = await response.json() as {
    ok?: boolean;
    handled?: boolean;
    text?: string;
    notice?: string;
  };
  const text = typeof payload.text === "string" ? payload.text.trim() : "";
  if (payload.ok !== true || payload.handled !== true || !text) {
    return null;
  }
  const notice = typeof payload.notice === "string" ? payload.notice.trim() : "";
  const content = notice ? `${notice}\n${text}` : text;
  const createdAt = host.nowIso();
  await host.appendMessages(turn.workspaceId, turn.threadId, [
    {
      id: user.id || `user-${turn.requestId}`,
      role: "user",
      content: utterance,
      createdAt: user.createdAt || createdAt
    },
    {
      id: turn.requestId,
      role: "assistant",
      content,
      createdAt
    }
  ]);
  return {
    content,
    reasoningSummary: "",
    toolCalls: [],
    webSearchCalls: [],
    citations: [],
    awaitingApproval: false,
    runtimeSnapshot: await host.snapshot()
  };
}
