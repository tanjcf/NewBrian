import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { planSoftwareLinkActivate } from "./software-link-window.ts";

export const CASE_ID = "SOFTWARE-LINK-SMOKE-001";

const TITLE = "演示文稿PPTX GitHub 哔哩哔哩_bilibili - Google Chrome";

function readFirst(urls: URL[]) {
  for (const url of urls) {
    if (existsSync(url)) return readFileSync(url, "utf8");
  }
  throw new Error(`Missing source: ${urls.map((url) => url.pathname).join(" | ")}`);
}

async function loadDecoder() {
  const candidates = [
    new URL("../../main/desktop-window-output.ts", import.meta.url),
    new URL("../../../../../../platforms/windows/apps/desktop/src/main/desktop-window-output.ts", import.meta.url)
  ];
  for (const url of candidates) {
    if (existsSync(url)) {
      return import(url.href) as Promise<{ decodeDriverOutput: (buffer: Buffer) => string }>;
    }
  }
  throw new Error("desktop-window-output.ts was not found");
}

function encodeGbk(text: string) {
  const dir = mkdtempSync(join(tmpdir(), "software-link-"));
  try {
    const input = join(dir, "in.txt");
    const script = join(dir, "encode.ps1");
    writeFileSync(input, text, "utf8");
    writeFileSync(script, [
      "param([string]$Path)",
      "$json = [System.IO.File]::ReadAllText($Path, [System.Text.UTF8Encoding]::new($false))",
      "$bytes = [System.Text.Encoding]::GetEncoding(936).GetBytes($json)",
      "[Console]::OpenStandardOutput().Write($bytes, 0, $bytes.Length)"
    ].join("\r\n"), "utf8");
    return execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-File", script, "-Path", input]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const workspace = readFileSync(new URL("./WorkspaceModules.tsx", import.meta.url), "utf8");
const driver = readFirst([
  new URL("../../../scripts/windows-installed-ui-driver.ps1", import.meta.url),
  new URL("../../../../../../platforms/windows/apps/desktop/scripts/windows-installed-ui-driver.ps1", import.meta.url)
]);
const control = readFirst([
  new URL("../../main/desktop-window-control.ts", import.meta.url),
  new URL("../../../../../../platforms/windows/apps/desktop/src/main/desktop-window-control.ts", import.meta.url)
]);
const ipc = readFirst([
  new URL("../../main/desktop-window-control-ipc.ts", import.meta.url),
  new URL("../../../../../../platforms/windows/apps/desktop/src/main/desktop-window-control-ipc.ts", import.meta.url)
]);

test(`${CASE_ID} window titles stay readable and a click focuses that window`, async () => {
  const { decodeDriverOutput } = await loadDecoder();
  const payload = JSON.stringify([{
    processId: 12940,
    processName: "chrome",
    title: TITLE,
    handle: 987654
  }]);

  assert.equal(JSON.parse(decodeDriverOutput(Buffer.from(payload, "utf8")))[0].title, TITLE);
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(payload, "utf16le")]);
  assert.equal(JSON.parse(decodeDriverOutput(utf16))[0].title, TITLE);
  assert.equal(JSON.parse(decodeDriverOutput(Buffer.from(payload, "utf16le")))[0].title, TITLE);

  const decoded = JSON.parse(decodeDriverOutput(encodeGbk(payload)));
  const row = Array.isArray(decoded) ? decoded[0] : decoded;
  assert.equal(row.title, TITLE);
  assert.equal(row.processId, 12940);
  assert.equal(row.processName, "chrome");
  assert.doesNotMatch(row.title, /[\uFFFD\u0400-\u04FF\u2666]/);

  const plan = planSoftwareLinkActivate(row);
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.deepEqual(plan.activate, { processId: 12940, processName: "chrome", handle: 987654 });
  assert.equal("windowTitle" in plan.activate, false);
  assert.match(plan.message, /演示文稿PPTX/);
  assert.match(plan.message, /bilibili - Google Chrome/);

  const missing = planSoftwareLinkActivate({ processId: 12940, processName: "chrome", title: TITLE, handle: 0 });
  assert.equal(missing.ok, false);

  const focus = workspace.slice(workspace.indexOf("async function focusDesktopWindow"), workspace.indexOf("高级：MCP 服务器"));
  assert.match(focus, /planSoftwareLinkActivate\(windowItem\)/);
  assert.match(focus, /windowControl\.activate\(plan\.activate\)/);
  assert.match(focus, /onClick=\{\(\) => void focusDesktopWindow\(windowItem\)\}/);
  assert.match(focus, /onClick=\{\(\) => void focusDesktopWindow\(selectedWindow\)\}/);
  assert.doesNotMatch(focus, /windowTitle:/);

  assert.match(driver, /function Write-Utf8Json/);
  assert.match(driver, /OpenStandardOutput\(\)/);
  assert.match(driver, /ForceForeground/);
  assert.match(driver, /\$WindowHandle -gt 0/);
  assert.match(driver, /\$element\.Current\.Name/);
  assert.match(control, /decodeDriverOutput/);
  assert.match(control, /-WindowHandle/);
  assert.match(ipc, /handle: value\.handle/);
});
