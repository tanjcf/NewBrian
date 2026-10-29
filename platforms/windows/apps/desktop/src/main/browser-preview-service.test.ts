import assert from "node:assert/strict";
import test from "node:test";
const { BrowserPreviewService, normalizeBrowserPreviewUrl } = await import(new URL("./browser-preview-service.ts", import.meta.url).href);

test("opens the normalized preview and records diagnostics", async () => {
  const events: string[] = [];
  const service = new BrowserPreviewService({
    getPreferences: async () => ({
      browser: {
        enabled: true,
        previewUrl: "https://default.invalid",
        openWebLinksIn: "in-app-browser",
        openLocalLinksIn: "in-app-browser"
      }
    }) as never,
    openWindow: async (url: string) => { events.push(`open:${url}`); },
    closeWindow: () => { events.push("close"); },
    captureWindow: async () => ({ ok: true, path: "capture.png", url: "file:///capture.png" }),
    saveThreadState: async (summary: string) => { events.push(summary); },
    appendDiagnostics: async (entry: string) => { events.push(entry); }
  });
  assert.deepEqual(await service.open(" https://example.com "), { ok: true, url: "https://example.com/" });
  assert.deepEqual(events, [
    "open:https://example.com/",
    "Opened browser preview: https://example.com/",
    "opened preview https://example.com/"
  ]);
  assert.deepEqual(service.close(), { ok: true });
  assert.equal(events.at(-1), "close");
});

test("rejects open when Browser Use is disabled", async () => {
  const service = new BrowserPreviewService({
    getPreferences: async () => ({
      browser: { enabled: false, previewUrl: "https://example.com" }
    }) as never,
    openWindow: async () => {
      throw new Error("should not open");
    },
    closeWindow: () => undefined,
    captureWindow: async () => ({ ok: true, path: "", url: "" }),
    saveThreadState: async () => undefined,
    appendDiagnostics: async () => undefined
  });
  await assert.rejects(() => service.open("https://example.com"), /已关闭/);
});

test("defaults missing schemes to HTTPS and rejects privileged protocols", () => {
  assert.equal(normalizeBrowserPreviewUrl("example.com/path"), "https://example.com/path");
  assert.throws(() => normalizeBrowserPreviewUrl("file:///C:/secret.txt"), /only supports http and https/);
});
