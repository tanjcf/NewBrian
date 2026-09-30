import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { insertNewlineIntoDraft } from "./composer-newline.ts";

test("composer textarea keeps local draft without requiring parent question updates", () => {
  const source = readFileSync(new URL("./ComposerTextarea.tsx", import.meta.url), "utf8");
  assert.match(source, /const \[draft, setDraft\] = useState\(initialValue\)/);
  assert.match(source, /onDraftChangeRef\.current\?\.\(next\)/);
});

test("Shift+Enter inserts a real newline instead of relying on browser default", () => {
  const source = readFileSync(new URL("./ComposerTextarea.tsx", import.meta.url), "utf8");
  assert.match(source, /if \(event\.shiftKey\)/);
  assert.match(source, /event\.preventDefault\(\);\s*insertNewlineAtCursor\(\);/s);
  assert.equal(insertNewlineIntoDraft("第一行第二行", 3, 3).next, "第一行\n第二行");
  assert.equal(insertNewlineIntoDraft("第一行第二行", 3, 3).cursor, 4);
  assert.equal(insertNewlineIntoDraft("abcd", 1, 3).next, "a\nd");
});

test("composer textarea exposes write-history undo and redo", () => {
  const source = readFileSync(new URL("./ComposerTextarea.tsx", import.meta.url), "utf8");
  assert.match(source, /commitComposerDraftHistory/);
  assert.match(source, /undoComposerDraftHistory/);
  assert.match(source, /redoComposerDraftHistory/);
  assert.match(source, /COMPOSER_DRAFT_HISTORY_IDLE_MS/);
  assert.match(source, /event\.key\.toLowerCase\(\) === "z"/);
  assert.match(source, /onHistoryChange/);
});

test("composer textarea can insert text at the caret", () => {
  const source = readFileSync(new URL("./ComposerTextarea.tsx", import.meta.url), "utf8");
  assert.match(source, /insertTextAtCursor/);
  assert.match(source, /setValue: \(value: string, cursor\?: number\)/);
});

test("composer attaches files at the caret with Cursor-style @ tokens", () => {
  const source = readFileSync(new URL("./WorkspaceModules.tsx", import.meta.url), "utf8");
  assert.match(source, /attachComposerAttachmentsAtCursor/);
  assert.match(source, /insertComposerAttachmentTokens/);
  assert.match(source, /removeComposerAttachment/);
  assert.match(source, /已在光标处添加/);
});

test("composer add menu exposes three-tier materials routing", () => {
  const source = readFileSync(new URL("./WorkspaceModules.tsx", import.meta.url), "utf8");
  assert.match(source, /COMPOSER_MATERIALS_MENU_ITEMS/);
  assert.match(source, /data-testid="composer-materials-menu"/);
  assert.match(source, /composer-materials-hint/);
  assert.match(source, /switchBrainWorkspace\("data"\)/);
  assert.match(source, /已挂载工作区文件夹/);
  assert.match(source, /已打开数据场景/);
});

test("composer toolbar places undo and redo beside send", () => {
  const source = readFileSync(new URL("./WorkspaceModules.tsx", import.meta.url), "utf8");
  assert.match(source, /data-testid="composer-undo-button"/);
  assert.match(source, /data-testid="composer-redo-button"/);
  assert.match(source, /onHistoryChange=\{setComposerDraftHistoryCaps\}/);
  const undoAt = source.indexOf('data-testid="composer-undo-button"');
  const redoAt = source.indexOf('data-testid="composer-redo-button"');
  const sendAt = source.indexOf('data-testid="composer-send-button"');
  assert.ok(undoAt > 0 && redoAt > undoAt && sendAt > redoAt);
});

test("composer send button uses the shared arrow icon instead of a text glyph", () => {
  const source = readFileSync(new URL("./WorkspaceModules.tsx", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  const sendButton = source.slice(
    source.indexOf('data-testid="composer-send-button"'),
    source.indexOf("</button>", source.indexOf('data-testid="composer-send-button"'))
  );

  assert.match(sendButton, /<SidebarIcon name="arrow-up" \/>/);
  assert.doesNotMatch(sendButton, />\s*↑\s*$/);
  assert.doesNotMatch(styles, /border-bottom:\s*8px solid #ffffff/);
});

test("submit composer does not auto-send after scene workspace alignment", () => {
  const source = readFileSync(new URL("./WorkspaceModules.tsx", import.meta.url), "utf8");
  const submitSource = source.slice(source.indexOf("function submitComposerRequest"), source.indexOf("function renderBrainChatModule"));
  assert.match(submitSource, /请再次发送/);
  assert.doesNotMatch(submitSource, /pendingComposerSendRef/);
  assert.doesNotMatch(submitSource, /正在发送/);
});

test("submit composer clears attachment chips after send or enqueue", () => {
  const source = readFileSync(new URL("./WorkspaceModules.tsx", import.meta.url), "utf8");
  const clearSource = source.slice(
    source.indexOf("function clearComposerAfterSend"),
    source.indexOf("function submitComposerRequest")
  );
  const submitSource = source.slice(
    source.indexOf("function submitComposerRequest"),
    source.indexOf("function renderBrainChatModule")
  );
  assert.match(clearSource, /setComposerImages\(\[\]\)/);
  assert.match(clearSource, /setQuestion\(""\)/);
  assert.match(submitSource, /clearComposerAfterSend\(\)/);
  const sceneSwitchBranch = submitSource.slice(
    submitSource.indexOf("if (sceneWorkspace.id !== selectedWorkspace?.id)"),
    submitSource.indexOf("if (executionBrainProject && executionBrainProject.id !== selectedBrainProjectId)")
  );
  assert.match(sceneSwitchBranch, /请再次发送/);
  assert.doesNotMatch(sceneSwitchBranch, /clearComposerAfterSend/);
});
