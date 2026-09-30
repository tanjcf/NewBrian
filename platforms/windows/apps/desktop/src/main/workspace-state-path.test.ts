import assert from "node:assert/strict";
import { isAbsolute, join, relative, resolve } from "node:path";
import test from "node:test";
import { INTERNAL_CHAT_WORKSPACE_ID } from "@codex-forge/protocol";

const {
  encodeWorkspaceStateSegment,
  getWorkspaceStateDirectory,
  resolveWorkspaceStatePath
} = await import(
  new URL("./workspace-state-path.ts", import.meta.url).href
);

test("maps the internal chat workspace ID to a Windows-safe state directory", () => {
  assert.equal(
    getWorkspaceStateDirectory("C:\\Users\\me\\.newbrain", INTERNAL_CHAT_WORKSPACE_ID),
    join("C:\\Users\\me\\.newbrain", "workspaces", "workspace-internal-chat")
  );
});

test("preserves existing project workspace directory names", () => {
  assert.equal(
    getWorkspaceStateDirectory("C:\\Users\\me\\.newbrain", "workspace-123"),
    join("C:\\Users\\me\\.newbrain", "workspaces", "workspace-123")
  );
});

test("encodes non-legacy internal workspace ids as one Windows-safe state directory segment", () => {
  const stateRoot = resolve("state");
  const target = resolveWorkspaceStatePath(stateRoot, "workspace:another-internal-chat");
  const segment = relative(resolve(stateRoot, "workspaces"), target);

  assert.equal(isAbsolute(segment), false);
  assert.doesNotMatch(segment, /[<>:"/\\|?*\u0000-\u001f]/);
  assert.equal(segment.includes(".."), false);
});

test("preserves existing portable workspace ids", () => {
  assert.equal(encodeWorkspaceStateSegment("workspace-123_abc"), "workspace-123_abc");
});

test("does not collide an encoded id with a portable id", () => {
  assert.notEqual(
    encodeWorkspaceStateSegment("workspace:internal-chat"),
    encodeWorkspaceStateSegment("workspace-internal-chat")
  );
});
