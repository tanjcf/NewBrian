import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("composer textarea keeps local draft without requiring parent question updates", () => {
  const source = readFileSync(new URL("./ComposerTextarea.tsx", import.meta.url), "utf8");
  assert.match(source, /const \[draft, setDraft\] = useState\(initialValue\)/);
  assert.match(source, /onDraftChange\?\.\(next\)/);
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
