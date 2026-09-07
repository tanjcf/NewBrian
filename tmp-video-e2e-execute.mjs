import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { createSceneTestCdpClient } from "./platforms/windows/apps/desktop/scripts/scene-test-cdp-client.mjs";
import { osKeyCombo, osMouseClick } from "./platforms/windows/apps/desktop/scripts/scene-test-os-input.mjs";

const execFileAsync = promisify(execFile);
const caseId = "VIDEO-E2E-REAL-002";
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const projectName = `视频E2E青石谷-${Date.now()}`;
const evidenceDir = `evidence/${caseId}/${stamp}`;
await mkdir(evidenceDir, { recursive: true });

const prompt = `请只使用右侧“视频创作”Tools操作当前新建项目，完成“青石谷清晨入口宣传片”真实视频闭环：
1. 生成策划、完整脚本和2个分镜（每镜4秒）、画面说明、旁白和字幕，并真实写入右侧脚本与分镜模块；
2. 生成或导入真实视频、图片、中文配音、背景音乐和音效素材，右侧项目必须显示真实文件，不得使用模拟素材；
3. 创建16:9、1920×1080、30fps时间线，把视频、音频和字幕写入对应轨道，完成裁剪、排序、转场、滤镜、字幕样式、淡入淡出和音画同步；
4. 启动真实预览，检查画面、字幕和声音；然后把第二个镜头改为更慢的推进镜头，重新生成并再次预览；如配音或音乐工具不可用，必须报告但仍继续完成无声视频渲染，不得中断其他可验收步骤；
5. 最终用右侧Tools渲染导出MP4，验证文件真实存在、大小大于0且能播放，并在右侧保留素材、时间线、预览和导出记录。
必须实际调用右侧Tools并展示每次工具执行，不能只回复方案或代码；任何能力不可用必须明确报告真实失败，不得编造文件或结果。`;

async function activateWindow() {
  await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
    "$w=New-Object -ComObject WScript.Shell; if(-not $w.AppActivate('codeCN')){exit 2}"], { windowsHide: true });
}
async function paste(text) {
  const b64 = Buffer.from(text, "utf16le").toString("base64");
  await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
    `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Clipboard]::SetText([Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${b64}')))`], { windowsHide: true });
  await osKeyCombo(true, "v");
}
async function shot(client, name) {
  const result = await client.command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const path = `${evidenceDir}/${name}.png`;
  await writeFile(path, Buffer.from(result.data, "base64"));
  return path;
}
async function state(client) {
  return client.evaluate(`(() => ({body:document.body.innerText.slice(0,24000), buttons:[...document.querySelectorAll('button')].filter(x=>x.offsetParent).map(x=>({text:x.textContent?.trim(),title:x.title,testid:x.dataset.testid})).slice(0,180)}))()`);
}
async function point(client, rootSelector, text = "") {
  const value = await client.evaluate(`(() => { const root=document.querySelector(${JSON.stringify(rootSelector)})||document.body; const el=${text ? `[...root.querySelectorAll('button,a,[role=button]')].find(n=>n.textContent?.trim()===${JSON.stringify(text)})` : "root"}; if(!el)return null; el.scrollIntoView({block:'center'}); const r=el.getBoundingClientRect(); return {x:Math.round(window.screenX+r.left+r.width/2),y:Math.round(window.screenY+r.top+r.height/2),rect:{left:r.left,top:r.top,width:r.width,height:r.height}}; })()`);
  assert.ok(value, `${rootSelector} ${text}`);
  return value;
}
async function click(client, rootSelector, text = "") {
  const value = await point(client, rootSelector, text);
  await osMouseClick(value.x, value.y);
  return { at: new Date().toISOString(), method: "Windows user32 mouse_event", target: text || rootSelector, ...value };
}

const client = await createSceneTestCdpClient(Number(process.env.CODECN_E2E_REMOTE_DEBUG_PORT || 10011));
const evidence = { caseId, startedAt: new Date().toISOString(), projectName, prompt, environment: { debugPort: Number(process.env.CODECN_E2E_REMOTE_DEBUG_PORT || 10011), input: "Windows user32 mouse_event + clipboard Ctrl+V" }, actions: [], assertions: [], checkpoints: [], result: "FAIL" };
try {
  await client.waitForAppReady();
  await activateWindow();
  evidence.checkpoints.push(await shot(client, "00-start"));
  const currentScene = await client.evaluate(`(() => { try { const r=localStorage.getItem('brain.workspaceSelection.v2'); return r ? JSON.parse(r).selectedWorkspaceKey : ''; }catch{return ''} })()`);
  if (currentScene !== "video") {
    evidence.actions.push(await click(client, ".brain-workspace-trigger"));
    await client.waitFor("Boolean(document.querySelector('.brain-workspace-menu')?.offsetParent)", 10_000);
    evidence.actions.push(await click(client, ".brain-workspace-menu", "视频制作"));
    await client.waitFor(`(() => { try { const r=localStorage.getItem('brain.workspaceSelection.v2'); return r&&JSON.parse(r).selectedWorkspaceKey==='video'; }catch{return false} })()`, 15_000);
  }
  evidence.checkpoints.push(await shot(client, "01-video-scene"));

  evidence.actions.push(await click(client, 'button[title="添加项目"]'));
  await client.waitFor("document.body.innerText.includes('新建空白项目')", 10_000);
  evidence.actions.push(await click(client, "body", "新建空白项目"));
  await client.waitFor("document.body.innerText.includes('为项目命名')", 10_000);
  evidence.actions.push(await click(client, 'body input'));
  await osKeyCombo(true, "a");
  await paste(projectName);
  evidence.actions.push({ at:new Date().toISOString(), method:"Windows clipboard + Ctrl+V", target:"project name input", text:projectName });
  evidence.checkpoints.push(await shot(client, "02-project-name"));
  evidence.actions.push(await click(client, 'body', "保存"));
  await client.waitFor(`document.body.innerText.includes(${JSON.stringify(projectName)})`, 20_000);
  evidence.assertions.push({ name:"new project visible", pass:true, value:projectName });
  evidence.checkpoints.push(await shot(client, "03-project-created"));

  evidence.actions.push(await click(client, '.new-chat-project-picker > button'));
  await client.waitFor("Boolean(document.querySelector('.new-chat-project-menu'))", 10_000);
  evidence.checkpoints.push(await shot(client, "03a-project-picker"));
  evidence.actions.push(await click(client, '.new-chat-project-menu', projectName));
  await client.waitFor(`document.querySelector('.new-chat-project-picker strong')?.textContent?.trim() === ${JSON.stringify(projectName)}`, 10_000);
  evidence.assertions.push({ name:"composer bound to new project", pass:true, value:projectName });

  evidence.actions.push(await click(client, '[data-testid="composer-input"]'));
  await paste(prompt);
  evidence.actions.push({ at:new Date().toISOString(), method:"Windows clipboard + Ctrl+V", target:"visible composer", text:prompt });
  evidence.checkpoints.push(await shot(client, "04-prompt-entered"));
  evidence.actions.push(await click(client, '[data-testid="composer-send-button"]'));
  await client.waitFor(`document.body.innerText.includes('青石谷清晨入口宣传片')`, 15_000);
  evidence.assertions.push({ name:"submitted prompt visible", pass:true });
  evidence.checkpoints.push(await shot(client, "05-submitted"));

  const deadline = Date.now() + 12 * 60_000;
  let captureIndex = 6;
  let lastBody = "";
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10_000));
    const current = await state(client);
    lastBody = current.body;
    const approval = current.buttons.find((button) => button.text === "批准并继续");
    if (approval) {
      evidence.checkpoints.push(await shot(client, `${String(captureIndex++).padStart(2,"0")}-approval`));
      evidence.actions.push(await click(client, "body", "批准并继续"));
    }
    evidence.progress = current;
    evidence.checkpoints.push(await shot(client, `${String(captureIndex++).padStart(2,"0")}-progress`));
    await writeFile(`${evidenceDir}/evidence.json`, JSON.stringify(evidence, null, 2), "utf8");
    if (/生成异常终止|请求未能完成|本轮执行失败|提交video生成任务失败|媒体工具失败/.test(lastBody)) break;
    const sendVisible = current.buttons.some((button) => button.testid === "composer-send-button" && button.text === "↑");
    const hasExport = /导出|渲染/.test(lastBody) && /SUCCEEDED|已完成|可播放|\.mp4/i.test(lastBody);
    if (sendVisible && hasExport) break;
  }
  evidence.finalState = await state(client);
  evidence.checkpoints.push(await shot(client, "99-final"));
  evidence.result = /生成异常终止|请求未能完成|本轮执行失败|提交video生成任务失败|媒体工具失败/.test(lastBody) ? "FAIL" : "PARTIAL";
} catch (error) {
  evidence.firstFailure = error instanceof Error ? error.stack || error.message : String(error);
  try { evidence.failureState = await state(client); evidence.checkpoints.push(await shot(client, "98-failure")); } catch {}
} finally {
  evidence.finishedAt = new Date().toISOString();
  await writeFile(`${evidenceDir}/evidence.json`, JSON.stringify(evidence, null, 2), "utf8");
  console.log(JSON.stringify({evidenceDir,result:evidence.result,firstFailure:evidence.firstFailure,checkpoints:evidence.checkpoints},null,2));
  await client.close({ preserveWorkspace: true });
}
