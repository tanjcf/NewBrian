import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDeferredMacZipApplyScript,
  escapeBashDoubleQuotes,
  resolveMacAppBundlePath,
  safeMacZipFileName
} from "./desktop-app-update-apply.ts";
import {
  normalizeDesktopUpdateVersionLabel,
  parseDesktopAppRelease,
  resolveDesktopAppUpdateStatus
} from "./desktop-app-update-service.ts";

test("resolveMacAppBundlePath strips Contents/MacOS/binary", () => {
  assert.equal(
    resolveMacAppBundlePath("/Applications/NewBrain.app/Contents/MacOS/NewBrain"),
    "/Applications/NewBrain.app"
  );
  assert.equal(
    resolveMacAppBundlePath("/tmp/NewBrain.app/Contents/MacOS/electron"),
    "/tmp/NewBrain.app"
  );
});

test("safeMacZipFileName prefers url basename", () => {
  assert.equal(
    safeMacZipFileName("1.4.24", "https://cdn.example/NewBrain-1.4.24-arm64-mac.zip?x=1"),
    "NewBrain-1.4.24-arm64-mac.zip"
  );
  assert.equal(safeMacZipFileName("1.4.24", "https://cdn.example/download"), "NewBrain-1.4.24-mac.zip");
});

test("deferred apply script waits for pid then ditto/open", () => {
  const script = buildDeferredMacZipApplyScript({
    zipPath: "/tmp/NewBrain-1.4.24-mac.zip",
    appBundlePath: "/Applications/NewBrain.app",
    processId: 4242,
    resultPath: "/tmp/last-mac-update.json",
    expectedVersion: "1.4.24"
  });
  assert.match(script, /kill -0 "\$PID"/);
  assert.match(script, /\/usr\/bin\/unzip/);
  assert.match(script, /\/usr\/bin\/ditto/);
  assert.match(script, /\/usr\/bin\/open "\$APP_BUNDLE"/);
  assert.match(script, /4242/);
  assert.equal(escapeBashDoubleQuotes('a"b'), 'a\\"b');
});

test("parseDesktopAppRelease and status detect newer zip", () => {
  const release = parseDesktopAppRelease({
    available: true,
    latest_version: "1.4.24",
    download_url: "https://example/NewBrain-1.4.24-mac.zip",
    sha256: "abc",
    package_kind: "zip",
    notes: "mac"
  });
  assert.ok(release);
  assert.equal(release?.packageKind, "zip");
  const status = resolveDesktopAppUpdateStatus({
    currentVersion: "1.4.23",
    release
  });
  assert.equal(status.available, true);
  assert.equal(normalizeDesktopUpdateVersionLabel("v1.4.24"), "1.4.24");
});
