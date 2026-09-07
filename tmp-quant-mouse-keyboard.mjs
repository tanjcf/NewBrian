import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createSceneTestCdpClient } from "./platforms/windows/apps/desktop/scripts/scene-test-cdp-client.mjs";
import { osPressEnter, osMouseClick, osKeyCombo } from "./platforms/windows/apps/desktop/scripts/scene-test-os-input.mjs";
const execFileAsync = promisify(execFile);
async function pasteText(text) {
  const base64 = Buffer.from(text, "utf16le").toString("base64");
  await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Clipboard]::SetText([Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${base64}')))`], { windowsHide: true });
  await osKeyCombo(true, "v");
}
async function cdpTextClick(client, text, root = "body") {
  const point = await client.evaluate(`(() => { const root=document.querySelector(${JSON.stringify(root)})||document.body; const el=[...root.querySelectorAll('button,a,[role=button]')].find((item)=>item.textContent?.trim()===${JSON.stringify(text)}); if(!el)return null; const r=el.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}; })()`);
  assert.ok(point, text);
  await client.command("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
  await client.command("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, x: point.x, y: point.y });
  await client.command("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, x: point.x, y: point.y });
  return { action: "cdpMouseClick", text, point };
}
await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "$w=New-Object -ComObject WScript.Shell; $w.AppActivate('codeCN') | Out-Null"], { windowsHide: true });

const client = await createSceneTestCdpClient(Number(process.env.CODECN_E2E_REMOTE_DEBUG_PORT || 9344));
const evidence = { caseId: "QUANT-MOUSE-KEYBOARD-001", actions: [], status: "FAIL" };
try {
  await client.waitForAppReady();
  const buttons = await client.evaluate(`(() => ([...document.querySelectorAll('button')].map((button) => ({ text: button.textContent?.trim(), testid: button.getAttribute('data-testid'), cls: button.className })).filter((item) => item.text || item.testid).slice(0, 40)))()`);
  evidence.buttons = buttons;
  console.log(JSON.stringify(buttons, null, 2));
  const trigger = await client.evaluate(`(() => { const r=document.querySelector('.brain-workspace-trigger')?.getBoundingClientRect(); return r ? {x:r.left+r.width/2,y:r.top+r.height/2} : null; })()`);
  assert.ok(trigger);
  await client.command("Input.dispatchMouseEvent", { type: "mouseMoved", x: trigger.x, y: trigger.y });
  await client.command("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, x: trigger.x, y: trigger.y });
  await client.command("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, x: trigger.x, y: trigger.y });
  await client.waitFor("Boolean(document.querySelector('.brain-workspace-menu'))", 10_000);
  evidence.actions.push(await cdpTextClick(client, "量化交易", ".brain-workspace-menu"));
  await client.waitFor("document.body.innerText.includes('行情') && document.body.innerText.includes('组合')", 20_000);
  evidence.actions.push(await client.mouseClickButtonText("行情", ".brain-resource-scene-nav"));
  await client.waitFor("document.querySelector('[data-testid=brain-quant-workspace]')?.getAttribute('data-active-view') === 'market'");
  evidence.actions.push(await client.mouseClickButtonText("组合", ".brain-resource-scene-nav"));
  await client.waitFor("document.querySelector('[data-testid=brain-quant-workspace]')?.getAttribute('data-active-view') === 'portfolio'");
  evidence.actions.push(await client.mouseClickButtonText("雷达", ".brain-resource-scene-nav"));
  await client.waitFor("document.querySelector('[data-testid=brain-quant-workspace]')?.getAttribute('data-active-view') === 'radar'");
  evidence.actions.push(await client.mouseClickButtonText("研究笔记", ".brain-resource-scene-nav"));
  await client.waitFor("document.body.innerText.includes('尚无研究笔记')");

  const composer = await client.evaluate(`(() => [...document.querySelectorAll('textarea,input,[contenteditable=true]')].map((el) => ({ tag: el.tagName, placeholder: el.getAttribute('placeholder'), testid: el.getAttribute('data-testid'), aria: el.getAttribute('aria-label') })).slice(-10))()`);
  evidence.composerCandidates = composer;
  const selector = await client.evaluate(`(() => { const el = [...document.querySelectorAll('textarea,input,[contenteditable=true]')].find((item) => /消息|聊|输入|message|prompt/i.test(item.getAttribute('placeholder') || '') || item.getAttribute('data-testid')?.includes('composer')); if (!el) return null; el.scrollIntoView({block:'center'}); const r=el.getBoundingClientRect(); return { selector: el.tagName.toLowerCase() + (el.getAttribute('data-testid') ? '[data-testid="'+el.getAttribute('data-testid')+'"]' : ''), x: r.left+r.width/2, y: r.top+r.height/2 }; })()`);
  console.log(JSON.stringify({ composerCandidates: composer, selector }, null, 2));
  assert.ok(selector, JSON.stringify(composer));
  assert.ok(Number.isFinite(selector.x) && Number.isFinite(selector.y), JSON.stringify(selector));
  await client.mouseClickSelector('[data-testid="composer-input"]');
  await pasteText("请在量化交易右侧工具中完成以下操作：行情切换到 000001，分别查询日线、周线和月线，并分别切换前复权、后复权、不复权，比较最近三个月走势；然后在组合中创建一个名为趋势回测测试的 Skill，基于 600519 最近一年历史走势进行模拟交易，禁止真实下单；再在雷达中创建趋势回测测试雷达模拟计划；最后总结结果并添加到研究笔记。每一步都展示实际工具执行结果和可复核记录。");
  await client.waitFor("document.querySelector('[data-testid=composer-input]')?.value.includes('量化交易右侧工具')", 10_000);
  const send = await client.mouseClickSelector('[data-testid="composer-send-button"]');
  evidence.actions.push({ action: "osClipboardPaste+osMouseClick", input: selector.selector, sendButton: send });
  await client.waitFor("document.body.innerText.includes('请在量化交易右侧工具中完成以下操作')", 15_000);
  evidence.visibleSubmittedMessage = true;
  evidence.status = "PASS";
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  await client.close({ keepProcess: true });
}
