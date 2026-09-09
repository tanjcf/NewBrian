import assert from "node:assert/strict";
import test from "node:test";

const { parseShowAppMenuInput } = await import(new URL("./app-menu-contract.ts", import.meta.url).href);
const menuPolicy = await import(new URL("./app-menu-policy.ts", import.meta.url).href);
const windowPolicy = await import(new URL("./desktop-window-policy.ts", import.meta.url).href);

test("normalizes valid app menu coordinates", () => {
  assert.deepEqual(parseShowAppMenuInput({ menu: "file", x: 12.4, y: 20.6 }), { menu: "file", x: 12, y: 21 });
});

test("rejects invalid app menu names and coordinates", () => {
  assert.throws(() => parseShowAppMenuInput({ menu: "developer", x: 0, y: 0 }), /name/);
  assert.throws(() => parseShowAppMenuInput({ menu: "file", x: Number.NaN, y: 0 }), /coordinates/);
  assert.throws(() => parseShowAppMenuInput({ menu: "file", x: 1_000_000, y: 0 }), /range/);
});

test("resolves saved menu accelerators and dispatches finite commands", () => {
  assert.equal(menuPolicy.resolveAppMenuAccelerator({ "new-chat": "Alt+N" }, "new-chat", "Ctrl+N"), "Alt+N");
  assert.equal(menuPolicy.resolveAppMenuAccelerator({}, "new-chat", "Ctrl+N"), "Ctrl+N");
  const commands: string[] = [];
  const item = menuPolicy.createAppMenuCommand("New Chat", "new-chat", (id: string) => commands.push(id), "Alt+N");
  assert.equal(item.accelerator, "Alt+N");
  assert.equal(typeof item.click, "function");
  (item.click as Function)();
  assert.deepEqual(commands, ["new-chat"]);
});

test("builds Chinese menu structure with injected side effects", () => {
  const commands: string[] = [];
  const urls: string[] = [];
  const windowActions: string[] = [];
  const actions = {
    sendCommand: (id: string) => commands.push(id),
    createWindow: () => commands.push("new-window"),
    openExternal: (url: string) => urls.push(url),
    showAbout: () => commands.push("about"),
    controlWindow: (action: "minimize" | "maximize" | "close") => windowActions.push(action)
  };
  const file = menuPolicy.createAppMenuTemplate("file", { "new-chat": "Alt+N" }, actions);
  assert.equal(file[0].label, "新建窗口");
  assert.equal(file[1].label, "新建对话");
  assert.equal(file[1].accelerator, "Alt+N");
  (file[0].click as Function)();
  (file[1].click as Function)();
  assert.deepEqual(commands, ["new-window", "new-chat"]);
  const windowMenu = menuPolicy.createAppMenuTemplate("window", {}, actions);
  assert.equal(windowMenu[0].label, "最小化");
  assert.equal(windowMenu[1].label, "最大化或还原");
  (windowMenu[0].click as Function)();
  (windowMenu[1].click as Function)();
  assert.deepEqual(windowActions, ["minimize", "maximize"]);
  const help = menuPolicy.createAppMenuTemplate("help", {}, actions);
  assert.equal(help[0].label, "NewBrain 文档");
  (help[0].click as Function)();
  (help.at(-1)?.click as Function)();
  assert.match(urls[0], /codex/);
  assert.equal(commands.at(-1), "about");
});

test("builds unique renderer URLs and screen-bounded window geometry", () => {
  assert.deepEqual(windowPolicy.createRendererUrlCandidates("http://localhost:5173"), [
    "http://localhost:5173", "http://[::1]:5173", "http://127.0.0.1:5173"
  ]);
  assert.deepEqual(windowPolicy.createRendererUrlCandidates("http://dev.internal"), ["http://dev.internal"]);
  const compact = windowPolicy.computeDesktopWindowBounds({ width: 500, height: 380 });
  assert.ok(compact.minWidth <= compact.width);
  assert.ok(compact.minHeight <= compact.height);
  assert.ok(compact.height <= 380);
  assert.ok(compact.minHeight <= 380);
  const casted = windowPolicy.computeDesktopWindowBounds({ width: 1280, height: 600 });
  assert.ok(casted.height <= 600);
  assert.ok(casted.minHeight <= casted.height);
  assert.ok(casted.minHeight <= 560);
});

test("bounds renderer crash recovery to three attempts per minute", () => {
  const first = windowPolicy.recordRendererCrash([], 100_000);
  assert.equal(first.shouldRecover, true);
  const fourth = windowPolicy.recordRendererCrash([70_000, 80_000, 90_000], 100_000);
  assert.equal(fourth.shouldRecover, false);
  const expired = windowPolicy.recordRendererCrash([1, 2, 3], 100_000);
  assert.deepEqual(expired.crashTimes, [100_000]);
});

test("cycles renderer load candidates within a bounded retry budget", () => {
  const urls = ["first", "second"];
  assert.deepEqual(windowPolicy.createRendererLoadAttempt(urls, 0), { url: "first", nextAttempt: 1 });
  assert.deepEqual(windowPolicy.createRendererLoadAttempt(urls, 2), { url: "first", nextAttempt: 3 });
  assert.equal(windowPolicy.canRetryRendererLoad(urls, 8), true);
  assert.equal(windowPolicy.canRetryRendererLoad(urls, 9), false);
  assert.equal(windowPolicy.canRetryRendererLoad([], 0), false);
});

test("controls desktop window state through one finite action policy", () => {
  const calls: string[] = [];
  let maximized = false;
  const window = {
    minimize: () => calls.push("minimize"),
    maximize: () => { maximized = true; calls.push("maximize"); },
    unmaximize: () => { maximized = false; calls.push("unmaximize"); },
    isMaximized: () => maximized,
    close: () => calls.push("close")
  };
  windowPolicy.controlDesktopWindow(window, "maximize");
  windowPolicy.controlDesktopWindow(window, "maximize");
  windowPolicy.controlDesktopWindow(window, "minimize");
  windowPolicy.controlDesktopWindow(window, "close");
  assert.deepEqual(calls, ["maximize", "unmaximize", "minimize", "close"]);
  assert.deepEqual(windowPolicy.controlDesktopWindow(null, "close"), { ok: false });
  assert.equal(windowPolicy.shouldHideWindowOnClose(false), false);
  assert.equal(windowPolicy.shouldHideWindowOnClose(true), false);
});
