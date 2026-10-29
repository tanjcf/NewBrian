import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

const MSI_LAYOUT_EXE = "C:\\Users\\Ada\\AppData\\Local\\.newbrain\\NewBrain.exe";
const FOO_SHA256 = "2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae";

function nsisRelease(version: string) {
  return {
    available: true,
    latest_version: version,
    download_url: `https://cdn.example/NewBrain ${version}-setup.exe`,
    sha256: FOO_SHA256,
    notes: "Cockpit-style",
    package_kind: "nsis"
  };
}

test("staged NSIS package on an MSI-layout install survives getStatus and installs on restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nb-update-kind-"));
  const setupPath = join(dir, "NewBrain 1.4.17-setup.exe");
  const nsisCalls: Array<{ setupPath: string; executablePath: string }> = [];
  try {
    await writeFile(setupPath, "foo", "utf8");
    await writeFile(
      join(dir, "staged-update.json"),
      JSON.stringify({
        latestVersion: "1.4.17",
        fromVersion: "1.4.15",
        path: setupPath,
        notes: "",
        releaseId: "rel_17",
        packageKind: "nsis",
        sha256: FOO_SHA256,
        stagedAt: new Date().toISOString()
      }),
      "utf8"
    );
    const service = new DesktopAppUpdateService({
      getCurrentVersion: () => "1.4.15",
      getExecutablePath: () => MSI_LAYOUT_EXE,
      downloadDir: () => dir,
      readCachedRelease: async () => nsisRelease("1.4.17"),
      fetchImpl: async () => {
        throw new Error("must not re-download a staged package");
      },
      runSilentInstall: async () => {
        throw new Error("must not run msiexec on a setup.exe");
      },
      runSilentNsisInstall: async (input: { setupPath: string; executablePath: string }) => {
        nsisCalls.push(input);
        return { exitCode: 0 };
      },
      openInstallerFallback: async () => {
        throw new Error("must not fall back to the wizard");
      }
    });

    const status = await service.getStatus({ refresh: false });
    assert.equal(status.staged, true);
    assert.equal(status.stagedPath, setupPath);
    assert.ok(await readFile(join(dir, "staged-update.json"), "utf8"));

    const applied = await service.applyStagedUpdate();
    assert.equal(applied.ok, true, applied.detail);
    assert.deepEqual(nsisCalls, [{ setupPath, executablePath: MSI_LAYOUT_EXE }]);

    // The pending-apply written by this session must not be read back as a failure.
    const afterApply = await service.getStatus({ refresh: false });
    assert.equal(afterApply.staged, true);
    assert.ok(await readFile(join(dir, "staged-update.json"), "utf8"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("applyStagedUpdate re-downloads instead of dead-ending when the package is missing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nb-update-missing-"));
  const nsisCalls: string[] = [];
  const phases: string[] = [];
  try {
    const service = new DesktopAppUpdateService({
      getCurrentVersion: () => "1.4.15",
      getExecutablePath: () => MSI_LAYOUT_EXE,
      downloadDir: () => dir,
      readCachedRelease: async () => nsisRelease("1.4.17"),
      fetchImpl: async () =>
        new Response(new Uint8Array([0x66, 0x6f, 0x6f]), {
          status: 200,
          headers: { "content-type": "application/octet-stream", "content-length": "3" }
        }),
      runSilentInstall: async () => {
        throw new Error("must not run msiexec on a setup.exe");
      },
      runSilentNsisInstall: async ({ setupPath }: { setupPath: string }) => {
        nsisCalls.push(setupPath);
        return { exitCode: 0 };
      },
      openInstallerFallback: async () => "",
      onProgress: (progress: { phase: string }) => phases.push(progress.phase)
    });

    const applied = await service.applyStagedUpdate();
    assert.equal(applied.ok, true, applied.detail);
    assert.equal(nsisCalls.length, 1);
    assert.ok(phases.includes("downloading") || phases.includes("preparing"));
    assert.ok(phases.includes("done"));
    assert.ok(await readFile(join(dir, "staged-update.json"), "utf8"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
