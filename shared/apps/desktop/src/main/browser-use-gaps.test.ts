import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { assertBrowserHistoryAccess } = await import(new URL("./browser-history-access.ts", import.meta.url).href);
const {
  mergeBrowserPermissionsExceptions,
  writeBrowserPermissionsFile,
  readBrowserPermissionsFile
} = await import(new URL("./browser-permissions-store.ts", import.meta.url).href);
const { writeBrowserScreenshotAnnotation } = await import(
  new URL("./browser-screenshot-annotation.ts", import.meta.url).href
);
const { applyBrowserDownloadItemPolicy } = await import(new URL("./browser-download-session.ts", import.meta.url).href);
const { DEFAULT_BROWSER_USE_PREFERENCES } = await import(new URL("./browser-agent-policy.ts", import.meta.url).href);
const {
  listBrowserContacts,
  upsertBrowserContact,
  removeBrowserContact
} = await import(new URL("./browser-contacts-store.ts", import.meta.url).href);

test("assertBrowserHistoryAccess allow/deny/ask", async () => {
  await assertBrowserHistoryAccess("allow", async () => false);
  await assert.rejects(() => assertBrowserHistoryAccess("deny", async () => true), /拒绝/);
  await assert.rejects(() => assertBrowserHistoryAccess("always_ask", async () => false), /取消/);
  await assertBrowserHistoryAccess("always_ask", async () => true);
});

test("permissions.json round-trip and merge preference", async () => {
  const root = await mkdtemp(join(tmpdir(), "nb-browser-perm-"));
  try {
    const written = await writeBrowserPermissionsFile(root, [
      {
        origin: "https://example.com",
        browse: "always_allow",
        download: "deny",
        upload: "require_approval"
      }
    ]);
    assert.equal(written.exceptions.length, 1);
    const file = await readBrowserPermissionsFile(root);
    assert.equal(file?.exceptions[0]?.origin, "https://example.com");
    const merged = await mergeBrowserPermissionsExceptions(root, [
      {
        origin: "http://127.0.0.1:8765",
        browse: "always_allow",
        download: "require_approval",
        upload: "require_approval"
      }
    ]);
    assert.equal(merged[0]?.origin, "https://example.com");
    const raw = await readFile(join(root, "browser", "permissions.json"), "utf8");
    assert.match(raw, /example\.com/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("annotatedScreenshots never/always/ask", async () => {
  const root = await mkdtemp(join(tmpdir(), "nb-browser-ann-"));
  try {
    const shot = join(root, "shot.png");
    await writeFileUtf8(shot, "png");
    assert.equal(
      await writeBrowserScreenshotAnnotation({ mode: "never", path: shot, url: "https://a.test" }),
      null
    );
    const always = await writeBrowserScreenshotAnnotation({
      mode: "always",
      path: shot,
      url: "https://a.test",
      title: "A"
    });
    assert.ok(always?.endsWith(".annotation.json"));
    const skipped = await writeBrowserScreenshotAnnotation({
      mode: "ask",
      path: shot,
      url: "https://a.test",
      ask: async () => false
    });
    assert.equal(skipped, null);
    const asked = await writeBrowserScreenshotAnnotation({
      mode: "ask",
      path: shot,
      url: "https://a.test",
      ask: async () => true
    });
    assert.ok(asked);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("download policy cancels denied origins and honors save path", async () => {
  const prefs = {
    enabled: true,
    ...DEFAULT_BROWSER_USE_PREFERENCES,
    agentPermissions: {
      defaults: {
        browse: "require_approval" as const,
        download: "deny" as const,
        upload: "require_approval" as const
      },
      exceptions: []
    },
    downloadDir: "",
    askDownloadPath: true
  };
  let canceled = false;
  const denied = await applyBrowserDownloadItemPolicy({
    item: {
      getURL: () => "https://evil.example/file.bin",
      getFilename: () => "file.bin",
      setSavePath: () => undefined,
      setSaveDialogOptions: () => undefined,
      cancel: () => {
        canceled = true;
      }
    },
    browser: prefs
  });
  assert.equal(denied.ok, false);
  assert.equal(canceled, true);

  const allowPrefs = {
    ...prefs,
    agentPermissions: {
      defaults: {
        browse: "require_approval" as const,
        download: "always_allow" as const,
        upload: "require_approval" as const
      },
      exceptions: []
    },
    downloadDir: "C:\\Downloads",
    askDownloadPath: false
  };
  let savePath = "";
  const allowed = await applyBrowserDownloadItemPolicy({
    item: {
      getURL: () => "https://cdn.example/a.zip",
      getFilename: () => "a.zip",
      setSavePath: (path: string) => {
        savePath = path;
      },
      setSaveDialogOptions: () => undefined,
      cancel: () => undefined
    },
    browser: allowPrefs
  });
  assert.equal(allowed.ok, true);
  assert.match(savePath.replace(/\\/g, "/"), /Downloads\/a\.zip$/);
});

test("contacts store upsert/list/remove without secrets", async () => {
  const root = await mkdtemp(join(tmpdir(), "nb-browser-contacts-"));
  try {
    const rows = await upsertBrowserContact(
      { rootDir: root },
      { name: "Ada", email: "ada@example.com", phone: "100" }
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.email, "ada@example.com");
    const listed = await listBrowserContacts({ rootDir: root });
    assert.equal(listed.length, 1);
    const next = await removeBrowserContact({ rootDir: root }, listed[0]!.id);
    assert.equal(next.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function writeFileUtf8(path: string, contents: string) {
  const { writeFile, mkdir } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents, "utf8");
}
