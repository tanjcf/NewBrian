import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createSceneTestCdpClient } from "./scene-test-cdp-client.mjs";
import { osKeyCombo, osPressEnter } from "./scene-test-os-input.mjs";
const execFileAsync = promisify(execFile);
const client = await createSceneTestCdpClient(Number(process.env.NEWBRAIN_E2E_REMOTE_DEBUG_PORT || 9555));
try {
  await client.waitForAppReady();
  await client.mouseClickSelector('button[aria-label="添加项目"]');
  await client.waitFor("Boolean(document.querySelector('.project-create-menu'))");
  await client.mouseClickButtonText("新建空白项目", ".project-create-menu");
  await client.waitFor("Boolean(document.querySelector('.project-name-dialog input'))");
  const name = `游戏制作验收-${Date.now()}`;
  await client.mouseClickSelector(".project-name-dialog input");
  const encoded = Buffer.from(name, "utf8").toString("base64");
  await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `$v=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')); Set-Clipboard -Value $v`], { windowsHide: true });
  await osKeyCombo(true, "v");
  await osPressEnter();
  await client.waitFor(`document.body?.innerText?.includes(${JSON.stringify(name)})`, 20_000);
  const state = await client.evaluate(`(() => ({ name: ${JSON.stringify(name)}, visible: document.body.innerText.includes(${JSON.stringify(name)}), scene: (() => { try { return JSON.parse(localStorage.getItem('brain.workspaceSelection.v2') || '{}').selectedWorkspaceKey; } catch { return null; } })() }))()`);
  console.log(JSON.stringify({ ok: true, caseId: "VISIBLE-GAME-PROJECT-CREATE", state }, null, 2));
} finally { await client.close(); }
