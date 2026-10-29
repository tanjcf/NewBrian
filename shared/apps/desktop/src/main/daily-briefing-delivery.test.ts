import assert from "node:assert/strict";
import test from "node:test";
import {
  deliverStartupDailyBriefing,
  setDailyBriefingChatHost,
  tryHandleDailyBriefingChat,
  type DailyBriefingCatalog
} from "./daily-briefing-delivery.ts";

function catalog(): DailyBriefingCatalog {
  return {
    workspaces: [{
      id: "ws-1",
      threads: [{ id: "thread-1", title: "随便聊聊" }]
    }]
  };
}

test("startup briefing is skipped when the app was not opened at login", async () => {
  const result = await deliverStartupDailyBriefing({
    openedAtLogin: false,
    accessToken: "token",
    gatewayOrigin: "https://api.example.test",
    headers: {},
    catalog: catalog(),
    addThread: async () => { throw new Error("should not add"); },
    readMessages: async () => { throw new Error("should not read"); },
    appendAssistantMessage: async () => { throw new Error("should not append"); },
    activate: async () => { throw new Error("should not activate"); },
    fetchImpl: async () => { throw new Error("should not fetch"); }
  });
  assert.equal(result, "skipped");
});

test("startup briefing inserts once and skips a second copy of the same date", async () => {
  const stored: string[] = [];
  let activated = 0;
  const messages = () => stored.map((content) => ({ content }));
  const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({
    ok: true,
    text: "早。今天是 2026-09-30，星期三。\n1、国际：今天没有拉到可用来源。",
    date: "2026-09-30"
  }), { status: 200, headers: { "Content-Type": "application/json" } });
  const deps = {
    openedAtLogin: true,
    accessToken: "token",
    gatewayOrigin: "https://api.example.test/",
    headers: { Authorization: "Bearer token" },
    catalog: catalog(),
    addThread: async (workspaceId: string) => ({
      workspaces: [{
        id: workspaceId,
        threads: [
          { id: "briefing-1", title: "今日简报" },
          { id: "thread-1", title: "随便聊聊" }
        ]
      }]
    }),
    readMessages: async () => messages(),
    appendAssistantMessage: async (_workspaceId: string, _threadId: string, content: string) => {
      stored.push(content);
    },
    activate: async () => { activated += 1; },
    fetchImpl
  };
  assert.equal(await deliverStartupDailyBriefing(deps), "inserted");
  assert.equal(activated, 1);
  assert.equal(stored.length, 1);
  assert.match(stored[0], /2026-09-30/);
  assert.equal(await deliverStartupDailyBriefing(deps), "present");
  assert.equal(stored.length, 1);
  assert.equal(activated, 1);
});

test("briefing thread short commands rewrite the reply and other threads stay on the model", async () => {
  const saved: string[] = [];
  setDailyBriefingChatHost({
    readAccessToken: async () => "token",
    readGatewayOrigin: async () => "https://api.example.test",
    createHeaders: () => ({ Authorization: "Bearer token" }),
    readThreadTitle: async (_workspaceId, threadId) => threadId === "briefing" ? "今日简报" : "项目讨论",
    appendMessages: async (_workspaceId, _threadId, messages) => {
      saved.push(...messages.map((item) => item.content));
    },
    snapshot: async () => ({ messages: saved }),
    nowIso: () => "2026-09-30T00:00:00.000Z",
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(String(init?.body || "{}")) as { utterance?: string };
      if (body.utterance === "我在上海") {
        return new Response(JSON.stringify({
          ok: true,
          handled: true,
          notice: "城市改成上海了，明天还按这个城市。",
          text: "早。今天是 2026-09-30，星期三。\n1、国际：今天没有拉到可用来源。"
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true, handled: false }), { status: 200 });
    }
  });
  try {
    const adjusted = await tryHandleDailyBriefingChat({
      workspaceId: "ws-1",
      threadId: "briefing",
      requestId: "request-1",
      messages: [{ id: "user-1", role: "user", content: "我在上海" }]
    });
    assert.equal(adjusted?.content, "城市改成上海了，明天还按这个城市。\n早。今天是 2026-09-30，星期三。\n1、国际：今天没有拉到可用来源。");
    assert.deepEqual(saved, [
      "我在上海",
      "城市改成上海了，明天还按这个城市。\n早。今天是 2026-09-30，星期三。\n1、国际：今天没有拉到可用来源。"
    ]);
    const passed = await tryHandleDailyBriefingChat({
      workspaceId: "ws-1",
      threadId: "other",
      requestId: "request-2",
      messages: [{ role: "user", content: "我在上海" }]
    });
    assert.equal(passed, null);
  } finally {
    setDailyBriefingChatHost(null);
  }
});
