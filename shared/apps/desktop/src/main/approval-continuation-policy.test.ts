import assert from "node:assert/strict";
import test from "node:test";
import {
  applyPendingApprovalToSessionSnapshot,
  buildEmptyTurnFallbackContent,
  ensureApprovalSnapshotForPendingLoop,
  shouldKeepApprovalRequestAlive
} from "./approval-continuation-policy.ts";

test("ensureApprovalSnapshotForPendingLoop synthesizes approval when loop awaits again", () => {
  const next = ensureApprovalSnapshotForPendingLoop({
    snapshot: { approval: null, session: { status: "idle" }, messages: [] },
    loopStatus: "awaiting-approval",
    pending: {
      call: { id: "call-2", name: "shell.exec", arguments: { command: "where.exe ffmpeg" } },
      descriptor: { kind: "command", description: "Run shell", risk: "high" }
    }
  });
  assert.ok(next.approval);
  assert.equal((next.approval as { toolRequestId: string }).toolRequestId, "call-2");
  assert.equal((next.pendingTool as { command: string }).command, "where.exe ffmpeg");
  assert.equal((next.session as { status: string }).status, "awaiting-approval");
});

test("applyPendingApprovalToSessionSnapshot mutates live session for hosted awaits", () => {
  const sessionSnapshot: Record<string, unknown> = {
    approval: null,
    session: { status: "running" }
  };
  applyPendingApprovalToSessionSnapshot({
    sessionSnapshot,
    loopStatus: "awaiting-approval",
    pending: {
      call: { id: "call-9", name: "workspace.edit", arguments: { path: "a.py" } },
      descriptor: { kind: "write", description: "Edit file", risk: "medium" }
    }
  });
  assert.equal((sessionSnapshot.approval as { toolRequestId: string }).toolRequestId, "call-9");
  assert.equal((sessionSnapshot.session as { status: string }).status, "awaiting-approval");
  applyPendingApprovalToSessionSnapshot({
    sessionSnapshot,
    loopStatus: "completed",
    pending: null
  });
  assert.equal(sessionSnapshot.approval, undefined);
  assert.equal(sessionSnapshot.pendingTool, undefined);
});

test("shouldKeepApprovalRequestAlive when session still awaiting without approval object", () => {
  assert.equal(shouldKeepApprovalRequestAlive({ approval: null, session: { status: "awaiting-approval" } }), true);
  assert.equal(shouldKeepApprovalRequestAlive({ approval: { id: "a" }, session: { status: "idle" } }), true);
  assert.equal(shouldKeepApprovalRequestAlive({ approval: null, session: { status: "idle" } }), false);
});

test("buildEmptyTurnFallbackContent mentions failed ffmpeg", () => {
  const text = buildEmptyTurnFallbackContent({
    latestUserText: "能帮做出视频吗",
    failedCommands: [{
      command: "ffmpeg -version",
      stderr: "ffmpeg : 无法将“ffmpeg”项识别为 cmdlet"
    }]
  });
  assert.match(text, /没有生成可见回复/);
  assert.match(text, /能帮做出视频吗/);
  assert.match(text, /ffmpeg/);
});
