import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const {
  DesktopAppUpdateService,
  parseDesktopAppRelease
} = await import(new URL("./desktop-app-update-service.ts", import.meta.url).href);

test("parseDesktopAppRelease accepts nsis package_kind", () => {
  const release = parseDesktopAppRelease({
    available: true,
    latest_version: "1.4.11",
    download_url: "https://cdn.example/NewBrain%201.4.11-setup.exe",
    sha256: "abc",
    notes: "修复更新体验",
    package_kind: "nsis"
  });
  assert.ok(release);
  assert.equal(release?.packageKind, "nsis");
  assert.equal(release?.notes, "修复更新体验");
});

test("startUpdate stages package and applyStagedUpdate runs NSIS installer", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nb-update-"));
  const calls: string[] = [];
  let skipped: string | null = null;
  const payload = Buffer.from("fake-setup-bytes");
  const sha256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
  // empty file hash above; write empty file via download mock

  const service = new DesktopAppUpdateService({
    getCurrentVersion: () => "1.4.10",
    getExecutablePath: () => "C:\\Users\\demo\\AppData\\Local\\Programs\\NewBrain\\NewBrain.exe",
    downloadDir: () => dir,
    readCachedRelease: async () => ({
      available: true,
      latest_version: "1.4.11",
      download_url: "https://cdn.example/NewBrain 1.4.11-setup.exe",
      sha256: "2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae",
      notes: "Cockpit-style",
      package_kind: "nsis"
    }),
    fetchImpl: async () =>
      new Response(new Uint8Array([0x66, 0x6f, 0x6f]), {
        status: 200,
        headers: { "content-type": "application/octet-stream", "content-length": "3" }
      }),
    runSilentInstall: async () => {
      calls.push("msi");
      return { exitCode: 0 };
    },
    runSilentNsisInstall: async ({ setupPath }) => {
      calls.push(`nsis:${setupPath}`);
      return { exitCode: 0 };
    },
    openInstallerFallback: async () => "",
    readSkippedVersion: async () => skipped,
    writeSkippedVersion: async (value) => {
      skipped = value;
    },
    afterSilentSuccess: () => {
      calls.push("quit");
    }
  });

  const phases: string[] = [];
  (service as any).dependencies.onProgress = (progress: { phase: string }) => {
    phases.push(progress.phase);
  };

  const started = await service.startUpdate();
  assert.equal(started.ok, true);
  assert.equal(started.staged, true);
  assert.ok(started.path);
  assert.ok(phases.includes("ready"));
  assert.deepEqual(calls, []);

  const status = await service.getStatus({ refresh: false });
  assert.equal(status.staged, true);

  const applied = await service.applyStagedUpdate();
  assert.equal(applied.ok, true);
  assert.ok(calls.some((item) => item.startsWith("nsis:")));
  assert.ok(calls.includes("quit"));

  const skip = await service.skipVersion("1.4.11");
  assert.equal(skip.ok, true);
  assert.equal(skipped, "1.4.11");

  await rm(dir, { recursive: true, force: true });
});
