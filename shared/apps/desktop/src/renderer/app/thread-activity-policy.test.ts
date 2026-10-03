import assert from "node:assert/strict";
import test from "node:test";

const {
  groupActivitiesByUserMessage,
  isComposerThreadRunning,
  patchRuntimeSnapshotMessagesForTurn,
  reconcileThreadDisplayMessages,
  resolveActiveReasoningRequestId,
  resolvePendingApprovalThreadKey,
  resolveSelectedThreadOwnsLiveApproval,
  threadStillNeedsApproval
} = await import(
  new URL("./thread-activity-policy.ts", import.meta.url).href
) as typeof import("./thread-activity-policy.js");

test("a running selected thread does not make the new-thread composer busy", () => {
  assert.equal(isComposerThreadRunning({
    isComposingNewThread: true,
    selectedThreadId: "thread-a",
    activeThreadRequestIds: { "thread-a": "request-a" }
  }), false);
});

test("the selected existing thread remains busy while its own request runs", () => {
  assert.equal(isComposerThreadRunning({
    isComposingNewThread: false,
    selectedThreadId: "thread-a",
    activeThreadRequestIds: { "thread-a": "request-a" }
  }), true);
});

test("another running thread does not make the selected existing thread busy", () => {
  assert.equal(isComposerThreadRunning({
    isComposingNewThread: false,
    selectedThreadId: "thread-b",
    activeThreadRequestIds: { "thread-a": "request-a" }
  }), false);
});

test("live reasoning request id stays on the selected thread", () => {
  assert.equal(resolveActiveReasoningRequestId({
    selectedThreadId: "thread-a",
    activeThreadRequestIds: { "thread-a": "request-a", "thread-b": "request-b" }
  }), "request-a");
  assert.equal(resolveActiveReasoningRequestId({
    selectedThreadId: "thread-b",
    activeThreadRequestIds: { "thread-a": "request-a" }
  }), "");
  assert.equal(resolveActiveReasoningRequestId({
    selectedThreadId: "",
    activeThreadRequestIds: { "thread-a": "request-a" }
  }), "");
});

test("selected thread does not own another thread's live approval via ask-busy alone", () => {
  assert.equal(resolveSelectedThreadOwnsLiveApproval({
    selectedThreadId: "software-thread",
    activeThreadRequestIds: { "game-thread": "request-game" },
    selectedThreadAwaitingApproval: false
  }), false);

  assert.equal(resolveSelectedThreadOwnsLiveApproval({
    selectedThreadId: "software-thread",
    activeThreadRequestIds: {},
    selectedThreadAwaitingApproval: true
  }), false);

  assert.equal(resolveSelectedThreadOwnsLiveApproval({
    selectedThreadId: "game-thread",
    activeThreadRequestIds: { "game-thread": "request-game" },
    selectedThreadAwaitingApproval: false
  }), true);

  assert.equal(resolvePendingApprovalThreadKey({
    workspaceId: "ws-software",
    threadId: "software-thread",
    snapshotHasApproval: true,
    selectedThreadOwnsLiveApproval: false
  }), "");

  assert.equal(resolvePendingApprovalThreadKey({
    workspaceId: "ws-game",
    threadId: "game-thread",
    snapshotHasApproval: true,
    selectedThreadOwnsLiveApproval: true
  }), "ws-game:game-thread");
});

test("keeps a newly submitted user message when a stale snapshot does not contain it yet", () => {
  const current = [
    { id: "user-old", role: "user", content: "old", createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "assistant-old", role: "assistant", content: "done", createdAt: "2026-01-01T00:00:01.000Z" },
    { id: "local-user-new", role: "user", content: "new question", createdAt: "2026-01-01T00:00:02.000Z" },
    { id: "local-assistant-new", role: "assistant", content: "", createdAt: "2026-01-01T00:00:03.000Z" }
  ];
  const canonical = current.slice(0, 2);

  assert.deepEqual(reconcileThreadDisplayMessages(current, canonical), current);
});

test("keeps a new-thread user message when the canonical thread summary is slightly newer", () => {
  const optimistic = {
    id: "local-user-new-thread",
    role: "user",
    content: "start a long government-writing task",
    createdAt: "2026-01-01T00:00:00.000Z"
  };
  const summary = {
    id: "thread-summary-message",
    role: "assistant",
    content: "thread created",
    createdAt: "2026-01-01T00:00:00.050Z"
  };

  assert.deepEqual(
    reconcileThreadDisplayMessages([optimistic], [summary]),
    [summary, optimistic]
  );
});

test("drops an old optimistic message when canonical history is substantially newer", () => {
  const optimistic = {
    id: "local-user-stale",
    role: "user",
    content: "stale",
    createdAt: "2026-01-01T00:00:00.000Z"
  };
  const canonical = {
    id: "assistant-current",
    role: "assistant",
    content: "current",
    createdAt: "2026-01-01T00:02:00.000Z"
  };

  assert.deepEqual(reconcileThreadDisplayMessages([optimistic], [canonical]), [canonical]);
});

test("drops streaming local-assistant stub once durable assistant-turn is present", () => {
  const current = [
    { id: "local-user-1", role: "user", content: "写一首诗", createdAt: "2026-01-01T00:00:00.000Z" },
    {
      id: "local-assistant-1",
      role: "assistant",
      content: "《初见》\n键盘敲醒静夜的窗",
      createdAt: "2026-01-01T00:00:01.000Z"
    }
  ];
  const canonical = [
    { id: "local-user-1", role: "user", content: "写一首诗", createdAt: "2026-01-01T00:00:00.000Z" },
    {
      id: "assistant-turn-1",
      role: "assistant",
      content: "《初见》\n键盘敲醒静夜的窗",
      createdAt: "2026-01-01T00:00:05.000Z"
    }
  ];

  assert.deepEqual(reconcileThreadDisplayMessages(current, canonical), canonical);
});

test("keeps failed local-assistant stubs that are excluded from model context", () => {
  const current = [
    {
      id: "local-assistant-failed",
      role: "assistant",
      content: "",
      excludeFromModelContext: true,
      createdAt: "2026-01-01T00:00:01.000Z"
    }
  ];
  const canonical = [
    {
      id: "assistant-turn-ok",
      role: "assistant",
      content: "done",
      createdAt: "2026-01-01T00:00:05.000Z"
    }
  ];

  assert.deepEqual(reconcileThreadDisplayMessages(current, canonical), [
    ...canonical,
    ...current
  ]);
});

test("keeps streamed partial content when durable failure stub is empty", () => {
  const current = [
    {
      id: "local-assistant-1",
      role: "assistant",
      content: "半成品视频脚本……",
      reasoningSummary: "正在检查 ffmpeg",
      excludeFromModelContext: true,
      createdAt: "2026-01-01T00:00:01.000Z"
    }
  ];
  const canonical = [
    {
      id: "local-assistant-1",
      role: "assistant",
      content: "",
      reasoningSummary: "正在检查 ffmpeg\n\n本轮在完成前发生异常：timeout",
      excludeFromModelContext: true,
      createdAt: "2026-01-01T00:00:01.000Z"
    }
  ];

  assert.deepEqual(reconcileThreadDisplayMessages(current, canonical), [{
    id: "local-assistant-1",
    role: "assistant",
    content: "半成品视频脚本……",
    reasoningSummary: "正在检查 ffmpeg\n\n本轮在完成前发生异常：timeout",
    excludeFromModelContext: true,
    createdAt: "2026-01-01T00:00:01.000Z"
  }]);
});

test("folds richer local-assistant stub into durable assistant-turn instead of wiping it", () => {
  const current = [
    { id: "local-user-1", role: "user", content: "做出一张桌面图片", createdAt: "2026-01-01T00:00:00.000Z" },
    {
      id: "local-assistant-1",
      role: "assistant",
      content: "Pillow 可用。现在我可以用 Python 生成壁纸。",
      reasoningSummary: "正在检查 Pillow",
      createdAt: "2026-01-01T00:00:01.000Z"
    }
  ];
  const canonical = [
    { id: "local-user-1", role: "user", content: "做出一张桌面图片", createdAt: "2026-01-01T00:00:00.000Z" },
    {
      id: "assistant-turn-1",
      role: "assistant",
      content: "",
      createdAt: "2026-01-01T00:00:05.000Z"
    }
  ];

  assert.deepEqual(reconcileThreadDisplayMessages(current, canonical), [
    { id: "local-user-1", role: "user", content: "做出一张桌面图片", createdAt: "2026-01-01T00:00:00.000Z" },
    {
      id: "assistant-turn-1",
      role: "assistant",
      content: "Pillow 可用。现在我可以用 Python 生成壁纸。",
      reasoningSummary: "正在检查 Pillow",
      createdAt: "2026-01-01T00:00:05.000Z"
    }
  ]);
});

test("does not fold a new turn streaming stub into a prior turn assistant", () => {
  const current = [
    { id: "local-user-1", role: "user", content: "你会做ppt吗", createdAt: "2026-01-01T00:00:00.000Z" },
    {
      id: "assistant-turn-1",
      role: "assistant",
      content: "会的！我可以帮你制作 PowerPoint 演示文稿 (PPT)",
      createdAt: "2026-01-01T00:00:05.000Z"
    },
    { id: "local-user-2", role: "user", content: "哈哈哈真有趣", createdAt: "2026-01-01T00:01:00.000Z" },
    {
      id: "local-assistant-2",
      role: "assistant",
      content: "新回复正在生成",
      createdAt: "2026-01-01T00:01:01.000Z"
    }
  ];
  const canonical = current.filter((message) => message.id !== "local-assistant-2");
  const reconciled = reconcileThreadDisplayMessages(current, canonical);

  assert.equal(
    reconciled.find((message) => message.id === "assistant-turn-1")?.content,
    "会的！我可以帮你制作 PowerPoint 演示文稿 (PPT)"
  );
  assert.ok(reconciled.some((message) => message.id === "local-assistant-2"));
});

test("patchRuntimeSnapshotMessagesForTurn does not overwrite prior assistant when current turn is missing", () => {
  const snapshot = [
    { id: "local-user-1", role: "user", content: "你会做ppt吗", createdAt: "2026-01-01T00:00:00.000Z" },
    {
      id: "assistant-turn-1",
      role: "assistant",
      content: "会的！我可以帮你制作 PowerPoint 演示文稿 (PPT)",
      createdAt: "2026-01-01T00:00:05.000Z"
    }
  ];
  const current = [
    ...snapshot,
    { id: "local-user-2", role: "user", content: "哈哈哈真有趣", createdAt: "2026-01-01T00:01:00.000Z" },
    {
      id: "local-assistant-abc",
      role: "assistant",
      content: "新回复正在生成",
      createdAt: "2026-01-01T00:01:01.000Z"
    }
  ];
  const patched = patchRuntimeSnapshotMessagesForTurn({
    snapshotMessages: snapshot,
    currentMessages: current,
    streamRequestId: "local-assistant-abc",
    userMessageId: "local-user-2",
    finalContent: "哈哈哈，看来你对 PPT 功能挺感兴趣！",
    reasoningSummary: ""
  });

  assert.equal(
    patched.find((message) => message.id === "assistant-turn-1")?.content,
    "会的！我可以帮你制作 PowerPoint 演示文稿 (PPT)"
  );
  assert.equal(
    patched.find((message) => message.id === "local-assistant-abc")?.content,
    "哈哈哈，看来你对 PPT 功能挺感兴趣！"
  );
});

test("groups persisted commands under the user message from the same turn", () => {
  const events = [
    {
      id: "message-1",
      type: "message",
      createdAt: "2026-01-01T00:00:00.000Z",
      turnId: "turn-1",
      payload: { role: "user", messageId: "user-1", content: "first" }
    },
    {
      id: "message-2",
      type: "message",
      createdAt: "2026-01-01T00:01:00.000Z",
      turnId: "turn-2",
      payload: { role: "user", messageId: "user-2", content: "second" }
    }
  ];
  const activities = [
    { callId: "call-1", turnId: "turn-1", title: "first command" },
    { callId: "call-2", turnId: "turn-2", title: "second command" }
  ];

  const grouped = groupActivitiesByUserMessage(events, activities);
  assert.deepEqual(grouped.get("user-1")?.map((item) => item.callId), ["call-1"]);
  assert.deepEqual(grouped.get("user-2")?.map((item) => item.callId), ["call-2"]);
});

test("an already decided approval does not keep the sidebar waiting badge", () => {
  assert.equal(threadStillNeedsApproval({
    threadStatus: "awaiting-approval",
    threadKey: "workspace:thread",
    pendingApprovalThreadKey: "workspace:thread",
    threadId: "thread",
    settledApprovalId: "approval-1",
    settledThreadId: "thread",
    snapshotApprovalId: "approval-1"
  }), false);
  assert.equal(threadStillNeedsApproval({
    threadStatus: "awaiting-approval",
    threadKey: "workspace:thread",
    pendingApprovalThreadKey: "",
    threadId: "thread",
    settledApprovalId: "approval-1",
    settledThreadId: "thread",
    snapshotApprovalId: "approval-2"
  }), true);
});

test("a finished answer replaces the longer approval-wait notice", () => {
  const notice = [
    "已请求执行工具，等待你批准后继续。",
    "待确认工具：shell.exec",
    "批准后会继续生成可见结果；拒绝则本轮停止。"
  ].join("\n\n");
  const reconciled = reconcileThreadDisplayMessages(
    [
      { id: "user-1", role: "user", content: "检索进展", createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "assistant-turn-1", role: "assistant", content: notice, createdAt: "2026-01-01T00:00:05.000Z" }
    ],
    [
      { id: "user-1", role: "user", content: "检索进展", createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "assistant-turn-1", role: "assistant", content: "命令已执行。", createdAt: "2026-01-01T00:00:05.000Z" }
    ]
  );
  assert.equal(reconciled.find((message) => message.id === "assistant-turn-1")?.content, "命令已执行。");
});
