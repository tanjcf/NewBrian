import assert from "node:assert/strict";
import test from "node:test";
import { selectGithubDesktopRelease } from "./github-desktop-release.ts";

const catalog = {
  available: true,
  latest_version: "1.4.23",
  release_id: "release_1.4.23",
  notes: "Windows",
  mandatory: false,
  package_kind: "nsis",
  download_url: "https://github.com/tanjcf/NewBrian/releases/download/release_1.4.23/NewBrian-1.4.23-windows-x64-setup.exe",
  sha256: "aa",
  platforms: {
    "windows-nsis": {
      package_kind: "nsis",
      download_url: "https://github.com/tanjcf/NewBrian/releases/download/release_1.4.23/NewBrian-1.4.23-windows-x64-setup.exe",
      sha256: "aa"
    },
    "windows-msi": {
      package_kind: "msi",
      download_url: "https://github.com/tanjcf/NewBrian/releases/download/release_1.4.23/NewBrian-1.4.23-windows-x64.msi",
      sha256: "bb"
    }
  }
};

test("windows update uses the GitHub setup.exe link", () => {
  const selected = selectGithubDesktopRelease(catalog, "win32", "x64") as { download_url: string; package_kind: string };
  assert.equal(selected.package_kind, "nsis");
  assert.match(selected.download_url, /\/releases\/download\/release_1\.4\.23\/NewBrian-1\.4\.23-windows-x64-setup\.exe$/);
});

test("macOS without a published installer is not offered the Windows package", () => {
  const selected = selectGithubDesktopRelease(catalog, "darwin", "arm64") as { available: boolean };
  assert.equal(selected.available, false);
});

test("rejects an installer URL outside the NewBrian GitHub release", () => {
  const selected = selectGithubDesktopRelease({
    available: true,
    latest_version: "1.4.23",
    download_url: "https://api.sinnauze.cn/desktop/setup.exe",
    sha256: "aa"
  }, "win32", "x64") as { available: boolean };
  assert.equal(selected.available, false);
});
