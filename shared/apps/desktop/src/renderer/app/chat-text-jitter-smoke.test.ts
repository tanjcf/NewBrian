/**
 * CHAT-TEXT-JITTER-SMOKE-001
 * Packaging must run this case and stop when it fails.
 * Streamed chat text must stay pinned without oscillating up and down.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { nextScrollTop, nextStickToBottom, retainStreamingText } from "./chat-scroll-stability.ts";

const CASE_ID = "CHAT-TEXT-JITTER-SMOKE-001";

test(`${CASE_ID} ignores the scroll event caused by following the tail`, () => {
  const clientHeight = 400;
  let scrollTop = 400;
  let scrollHeight = 800;
  let stick = true;

  scrollHeight = 860;
  const follow = nextScrollTop({ scrollHeight, clientHeight, scrollTop, stick });
  assert.equal(follow, 460);
  scrollTop = follow ?? scrollTop;
  stick = nextStickToBottom({
    distanceFromBottom: scrollHeight - scrollTop - clientHeight + 80,
    programmatic: true,
    currentlyStuck: stick
  });
  assert.equal(stick, true);
  assert.equal(nextScrollTop({ scrollHeight, clientHeight, scrollTop, stick }), null);
});

test(`${CASE_ID} stays put after the reader scrolls away from the tail`, () => {
  const stick = nextStickToBottom({
    distanceFromBottom: 300,
    programmatic: false,
    currentlyStuck: true
  });
  assert.equal(stick, false);
  assert.equal(nextScrollTop({
    scrollHeight: 900,
    clientHeight: 400,
    scrollTop: 200,
    stick
  }), null);
});

test(`${CASE_ID} pins the live turn to the main scroller before paint`, () => {
  const modules = readFileSync(new URL("./WorkspaceModules.tsx", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  assert.match(modules, /nextStickToBottom/);
  assert.match(modules, /nextScrollTop/);
  assert.match(modules, /programmaticScrollRef/);
  assert.match(modules, /new ResizeObserver/);
  assert.match(modules, /useLayoutEffect\(\(\) => \{\s*if \(!isAskingModel \|\| !stickToBottomRef\.current\) return;\s*scrollTaskToBottom\("auto"\);/s);
  assert.doesNotMatch(modules, /requestAnimationFrame\(\(\) => \{\s*if \(!stickToBottomRef\.current\) return;\s*scrollTaskToBottom\("auto"\);/s);
  assert.match(styles, /\.task-scroll\s*\{[^}]*overflow-anchor:\s*none;/s);
  assert.match(styles, /\.task-scroll\s*\{[^}]*scrollbar-gutter:\s*stable;/s);
  assert.match(styles, /Windows-only:/);
  assert.match(styles, /\.markdown-message-streaming\s*\{[^}]*overflow-anchor:\s*none;/s);
  assert.match(styles, /\.conversation-turn\.current\s*\{[^}]*content-visibility:\s*visible;/s);
  assert.doesNotMatch(styles, /\.assistant-activity-scroll\s*\{[^}]*scroll-behavior:\s*smooth;/s);
  assert.match(modules, /liveTurnAnswerText/);
  assert.doesNotMatch(modules, /requestAnimationFrame\(\(\) => scrollTaskToBottom\("auto"\)\)/);
  const resize = modules.slice(modules.indexOf("new ResizeObserver"), modules.indexOf("observer.disconnect"));
  assert.doesNotMatch(resize, /observer\.observe\(scrollContainer\)/);
  assert.match(resize, /observer\.observe\(content\)/);
});

test(`${CASE_ID} keeps already visible stream text when a later chunk is empty`, () => {
  assert.equal(retainStreamingText("已经显示的回答", ""), "已经显示的回答");
  assert.equal(retainStreamingText("已经显示的回答", "   "), "已经显示的回答");
  assert.equal(retainStreamingText("已经显示的回答", "已经显示的回答，继续"), "已经显示的回答，继续");
});
