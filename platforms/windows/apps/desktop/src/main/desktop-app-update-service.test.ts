import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import assert from "node:assert/strict";
import test from "node:test";
const {
  DesktopAppUpdateService,
  buildDeferredSilentMsiexecScript,
  buildSilentDesktopMsiUpgradeArgs,
  controlPlaneCacheRelease,
  describeSilentDesktopMsiFailure,
  isSilentDesktopMsiSuccess,
  parseDesktopAppRelease,
  quoteCmdArgument,
  resolveDesktopAppUpdateStatus,
  resolveDesktopMsiInstallScope
} = await import(new URL("./desktop-app-update-service.ts", import.meta.url).href);

test("an update without a checksum never reaches download or installation", async () => {
  const service = new DesktopAppUpdateService({
    getCurrentVersion: () => "1.4.4",
    readCachedRelease: async () => ({ latest_version: "1.4.5", download_url: "https://example.test/update.msi" }),
    downloadDir: () => { throw new Error("must not create a download directory"); },
    runSilentInstall: async () => { throw new Error("must not install"); },
    openInstallerFallback: async () => { throw new Error("must not open installer"); }
  });
  const result = await service.startUpdate();
  assert.equal(result.ok, false);
  assert.match(result.detail, /缺少 SHA-256/);
});

test("parses and compares app_release offers for click-to-upgrade", () => {
  assert.equal(parseDesktopAppRelease(null), null);
  assert.equal(parseDesktopAppRelease({ latest_version: "0.1.61" }), null);
  const release = parseDesktopAppRelease({
    latest_version: "0.1.61",
    download_url: "https://example.com/codeCN.msi",
    sha256: "ABC",
    notes: "fix fetch",
    mandatory: true
  });
  assert.deepEqual(release, {
    latestVersion: "0.1.61",
    downloadUrl: "https://example.com/codeCN.msi",
    sha256: "abc",
    notes: "fix fetch",
    mandatory: true,
    releaseId: "",
    channel: "",
    packageKind: ""
  });
  const offer = {
    latest_version: "0.1.61",
    download_url: "https://example.com/codeCN.msi",
    sha256: "abc",
    notes: "fix fetch",
    mandatory: true
  };
  assert.equal(resolveDesktopAppUpdateStatus({
    currentVersion: "0.1.60",
    release: offer
  }).available, true);
  assert.equal(resolveDesktopAppUpdateStatus({
    currentVersion: "0.1.61",
    release: offer
  }).available, false);
  assert.deepEqual(
    controlPlaneCacheRelease({ bootstrap: { app_release: offer } }),
    offer
  );
});

test("builds silent per-user msiexec args matching LocalAppData installs", () => {
  assert.equal(
    resolveDesktopMsiInstallScope("C:\\Users\\Ada\\AppData\\Local\\.codecn\\codeCN.exe"),
    "per-user"
  );
  assert.equal(
    resolveDesktopMsiInstallScope("C:\\Program Files\\codeCN\\codeCN.exe"),
    "per-machine"
  );
  assert.deepEqual(
    buildSilentDesktopMsiUpgradeArgs("C:\\updates\\codeCN-1.2.1.msi", "per-user"),
    [
      "/i",
      "C:\\updates\\codeCN-1.2.1.msi",
      "/qn",
      "/norestart",
      "REBOOT=ReallySuppress",
      "MSIINSTALLPERUSER=1",
      "ALLUSERS="
    ]
  );
  assert.deepEqual(
    buildSilentDesktopMsiUpgradeArgs("C:\\updates\\codeCN-1.2.1.msi", "per-machine", {
      applicationFolder: "C:\\Program Files\\codeCN\\"
    }),
    [
      "/i",
      "C:\\updates\\codeCN-1.2.1.msi",
      "/qn",
      "/norestart",
      "REBOOT=ReallySuppress",
      "ALLUSERS=1",
      "APPLICATIONFOLDER=C:\\Program Files\\codeCN"
    ]
  );
  assert.equal(isSilentDesktopMsiSuccess(0), true);
  assert.equal(isSilentDesktopMsiSuccess(3010), true);
  assert.equal(isSilentDesktopMsiSuccess(1603), false);
  assert.match(
    describeSilentDesktopMsiFailure({ exitCode: 1625, scope: "per-machine" }),
    /管理员权限/
  );
  assert.equal(quoteCmdArgument("C:\\updates\\codeCN 1.2.1.msi"), "\"C:\\updates\\codeCN 1.2.1.msi\"");
  const deferred = buildDeferredSilentMsiexecScript({
    msiPath: "C:\\updates\\codeCN-1.2.1.msi",
    args: buildSilentDesktopMsiUpgradeArgs("C:\\updates\\codeCN-1.2.1.msi", "per-user"),
    processImageName: "codeCN.exe",
    maxWaitSeconds: 30
  });
  assert.match(deferred, /msiexec\.exe \/i .* \/qn \/norestart REBOOT=ReallySuppress MSIINSTALLPERUSER=1 ALLUSERS=/);
  assert.match(deferred, /Get-Process -Name \$name/);
  assert.match(deferred, /WindowStyle Hidden/);
  assert.match(deferred, /等待 codeCN 退出超时/);
  assert.doesNotMatch(deferred, /find \/I/i);
  assert.doesNotMatch(deferred, /tasklist/i);
  assert.match(deferred, /if errorlevel 1 \(/);
  assert.match(deferred, /start ""/);
  assert.doesNotMatch(deferred, /\/qb\b/);
});

test("getStatus refresh surfaces a newly published release without restart", async () => {
  let cached: unknown = { available: false };
  const service = new DesktopAppUpdateService({
    getCurrentVersion: () => "0.1.64",
    readCachedRelease: async () => cached,
    refreshRelease: async () => {
      cached = {
        available: true,
        latest_version: "0.1.65",
        download_url: "https://example.com/codeCN-0.1.65.msi",
        release_id: "rel_65",
        channel: "stable"
      };
      return cached;
    },
    downloadDir: () => tmpdir(),
    runSilentInstall: async () => ({ exitCode: 0 }),
    openInstallerFallback: async () => ""
  });
  assert.equal((await service.getStatus({ refresh: false })).available, false);
  const refreshed = await service.getStatus({ refresh: true });
  assert.equal(refreshed.available, true);
  assert.equal(refreshed.latestVersion, "0.1.65");
  assert.equal(refreshed.releaseId, "rel_65");
});

test("downloads MSI and runs silent install after the user clicks update", async () => {
  const payload = Buffer.from("msi-bytes");
  const sha256 = createHash("sha256").update(payload).digest("hex");
  const dir = await mkdtemp(join(tmpdir(), "codecn-update-"));
  const silentCalls: Array<{ msiPath: string; args: string[]; scope: string }> = [];
  const opened: string[] = [];
  const progress: Array<{ phase: string; detail: string }> = [];
  let afterSilent = 0;
  const server = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "application/octet-stream" });
    response.end(payload);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing port");
  const downloadUrl = `http://127.0.0.1:${address.port}/codeCN.msi`;
  try {
    const service = new DesktopAppUpdateService({
      getCurrentVersion: () => "0.1.60",
      getExecutablePath: () => "C:\\Users\\Ada\\AppData\\Local\\.codecn\\codeCN.exe",
      readCachedRelease: async () => ({
        latest_version: "0.1.61",
        download_url: downloadUrl,
        sha256,
        release_id: "rel_1",
        channel: "canary"
      }),
      downloadDir: () => dir,
      runSilentInstall: async (input) => {
        silentCalls.push(input);
        return { exitCode: 0 };
      },
      openInstallerFallback: async (path) => {
        opened.push(path);
        return "";
      },
      afterSilentSuccess: () => {
        afterSilent += 1;
      },
      onProgress: (item) => {
        progress.push({ phase: item.phase, detail: item.detail });
      },
      verifyUpdate: async ({ releaseId, ok }) => ({
        ok: true,
        release_id: releaseId,
        verification_count: 1,
        threshold: 1,
        promoted_to_stable: ok
      })
    });
    const status = await service.getStatus({ refresh: false });
    assert.equal(status.available, true);
    assert.equal(status.releaseId, "rel_1");
    const result = await service.startUpdate();
    assert.equal(result.ok, true);
    assert.equal(silentCalls.length, 1);
    assert.equal(opened.length, 0);
    assert.deepEqual(silentCalls[0]?.args, [
      "/i",
      silentCalls[0]!.msiPath,
      "/qn",
      "/norestart",
      "REBOOT=ReallySuppress",
      "MSIINSTALLPERUSER=1",
      "APPLICATIONFOLDER=C:\\Users\\Ada\\AppData\\Local\\.codecn",
      "ALLUSERS="
    ]);
    assert.match(result.detail, /即将退出并安装/);
    assert.equal(afterSilent, 1);
    assert.ok(progress.some((item) => item.phase === "installing" && /正在安装/.test(item.detail)));
    assert.ok(progress.some((item) => item.phase === "done" && /即将退出并安装/.test(item.detail)));
    assert.deepEqual(await readFile(silentCalls[0]!.msiPath), payload);
    const verify = await service.verifyUpdate({ ok: true });
    assert.equal(verify.ok, true);
    assert.equal(verify.promotedToStable, true);
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("falls back to opening the MSI wizard when silent install fails", async () => {
  const payload = Buffer.from("msi-fallback");
  const sha256 = createHash("sha256").update(payload).digest("hex");
  const dir = await mkdtemp(join(tmpdir(), "codecn-update-fb-"));
  const opened: string[] = [];
  const server = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "application/octet-stream" });
    response.end(payload);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing port");
  const downloadUrl = `http://127.0.0.1:${address.port}/codeCN.msi`;
  try {
    const service = new DesktopAppUpdateService({
      getCurrentVersion: () => "0.1.60",
      resolveInstallScope: () => "per-machine",
      readCachedRelease: async () => ({
        latest_version: "0.1.61",
        download_url: downloadUrl,
        sha256
      }),
      downloadDir: () => dir,
      runSilentInstall: async () => ({ exitCode: 1625 }),
      openInstallerFallback: async (path) => {
        opened.push(path);
        return "";
      }
    });
    const result = await service.startUpdate();
    assert.equal(result.ok, true);
    assert.equal(opened.length, 1);
    assert.match(result.detail, /管理员权限/);
    assert.match(result.detail, /已打开/);
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("startUpdate keeps partial on failure and resumes on retry", async () => {
  const payload = Buffer.from("resume-service-bytes-ABCDEFGH");
  const sha256 = createHash("sha256").update(payload).digest("hex");
  const dir = await mkdtemp(join(tmpdir(), "codecn-update-resume-"));
  const partialPath = join(dir, "codeCN-1.3.6.msi.partial");
  await writeFile(partialPath, payload.subarray(0, 12));
  let rangeSeen = false;
  const server = createServer((request, response) => {
    const range = String(request.headers.range || "");
    if (range.startsWith("bytes=")) {
      rangeSeen = true;
      const start = Number(range.slice("bytes=".length).split("-")[0] || 0);
      const slice = payload.subarray(start);
      response.writeHead(206, {
        "Content-Type": "application/octet-stream",
        "Content-Range": `bytes ${start}-${payload.length - 1}/${payload.length}`,
        "Content-Length": String(slice.length)
      });
      response.end(slice);
      return;
    }
    response.writeHead(200, {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(payload.length)
    });
    response.end(payload);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing port");
  const downloadUrl = `http://127.0.0.1:${address.port}/codeCN.msi`;
  const progress: string[] = [];
  try {
    const service = new DesktopAppUpdateService({
      getCurrentVersion: () => "1.3.5",
      getExecutablePath: () => "C:\\Users\\Ada\\AppData\\Local\\.codecn\\codeCN.exe",
      readCachedRelease: async () => ({
        latest_version: "1.3.6",
        download_url: downloadUrl,
        sha256
      }),
      downloadDir: () => dir,
      runSilentInstall: async () => ({ exitCode: 0 }),
      openInstallerFallback: async () => "",
      onProgress: (item) => progress.push(`${item.phase}:${item.detail}`)
    });
    const result = await service.startUpdate();
    assert.equal(result.ok, true);
    assert.equal(rangeSeen, true);
    assert.ok(progress.some((item) => item.includes("断点续传")));
    assert.deepEqual(await readFile(join(dir, "codeCN-1.3.6.msi")), payload);
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("startUpdate leaves preparing immediately and handles 1.2.9.ulit patch MSI", async () => {
  const payload = Buffer.from("ulit-msi-bytes");
  const sha256 = createHash("sha256").update(payload).digest("hex");
  const dir = await mkdtemp(join(tmpdir(), "codecn-update-ulit-"));
  const silentCalls: Array<{ msiPath: string }> = [];
  const progress: string[] = [];
  const server = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "application/octet-stream" });
    response.end(payload);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address !== "object") throw new Error("missing port");
  const downloadUrl = `http://127.0.0.1:${address.port}/1.2.9ulit.msi`;
  try {
    const service = new DesktopAppUpdateService({
      getCurrentVersion: () => "1.2.7",
      getExecutablePath: () => "C:\\Users\\Ada\\AppData\\Local\\.codecn\\codeCN.exe",
      readCachedRelease: async () => ({
        latest_version: "1.2.9.ulit",
        download_url: downloadUrl,
        sha256,
        package_kind: "patch"
      }),
      downloadDir: () => dir,
      runSilentInstall: async (input) => {
        silentCalls.push(input);
        return { exitCode: 0 };
      },
      openInstallerFallback: async () => "",
      onProgress: (item) => progress.push(`${item.phase}:${item.percent}`)
    });
    const result = await service.startUpdate();
    assert.equal(result.ok, true);
    assert.equal(silentCalls.length, 1);
    assert.match(silentCalls[0]!.msiPath.replace(/\\/g, "/"), /1\.2\.9ulit\.msi$/);
    assert.ok(progress.some((item) => item.startsWith("preparing:")));
    assert.ok(progress.some((item) => item.startsWith("downloading:")));
    const preparingIndex = progress.findIndex((item) => item.startsWith("preparing:"));
    const downloadingIndex = progress.findIndex((item) => item.startsWith("downloading:"));
    assert.ok(downloadingIndex > preparingIndex);
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("startUpdate surfaces download errors without throwing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codecn-update-err-"));
  const server = createServer((_request, response) => {
    response.writeHead(500, { "Content-Type": "text/plain" });
    response.end("boom");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing port");
  const downloadUrl = `http://127.0.0.1:${address.port}/codeCN.msi`;
  try {
    const service = new DesktopAppUpdateService({
      getCurrentVersion: () => "1.3.5",
      readCachedRelease: async () => ({
        latest_version: "1.3.6",
        download_url: downloadUrl,
        sha256: "abc"
      }),
      downloadDir: () => dir,
      runSilentInstall: async () => ({ exitCode: 0 }),
      openInstallerFallback: async () => ""
    });
    const result = await service.startUpdate();
    assert.equal(result.ok, false);
    assert.match(result.detail, /下载更新失败：HTTP 500/);
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});
