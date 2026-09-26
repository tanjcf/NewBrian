import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const {
  clearBrowserHistory,
  listBrowserHistory,
  recordBrowserHistoryVisit,
  removeBrowserHistoryEntry
} = await import(new URL("./browser-history-store.ts", import.meta.url).href);

test("records, lists, removes, and clears browser history", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "nb-browser-hist-"));
  try {
    await recordBrowserHistoryVisit({ rootDir }, { url: "http://127.0.0.1:3000/", title: "Home" });
    await recordBrowserHistoryVisit({ rootDir }, { url: "https://example.com/a", title: "Example" });
    let rows = await listBrowserHistory({ rootDir });
    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.url, "https://example.com/a");
    rows = await removeBrowserHistoryEntry({ rootDir }, rows[0]!.id);
    assert.equal(rows.length, 1);
    await clearBrowserHistory({ rootDir });
    rows = await listBrowserHistory({ rootDir });
    assert.equal(rows.length, 0);
    const raw = await readFile(join(rootDir, "browser", "history.json"), "utf8");
    assert.equal(JSON.parse(raw).length, 0);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
