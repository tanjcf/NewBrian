import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createSceneTestCdpClient } from "./scene-test-cdp-client.mjs";
import { osKeyCombo, osPressEnter } from "./scene-test-os-input.mjs";
const execFileAsync = promisify(execFile);
const prompt = `请只使用右侧游戏制作 Tools 操作当前游戏项目：创建一个名为“青石谷入口”的新关卡并保存；创建一个 UE5 游戏工程（UE5.4），生成真实 .uproject、Config 和 Content 文件；再通过右侧游戏制作 Tools 读取关卡与 Content 资源，说明 UE5 Editor 的运行入口。不要生成 Web 工程，不要使用 shell，不要只输出代码，不要编造关卡、资产或试玩数据。`;
const client = await createSceneTestCdpClient(Number(process.env.NEWBRAIN_E2E_REMOTE_DEBUG_PORT || 9555));
const actions = [];
try {
  await client.waitForAppReady();
  if (await client.getSelectedWorkspaceKey() !== "game") await client.switchWorkspace("game");
  const beforeText = await client.evaluate("document.body?.innerText || ''");
  await client.mouseClickButtonText("新对话");
  const permissionButtonVisible = await client.evaluate("Boolean(document.querySelector('[data-testid=\"composer-permission-button\"]'))");
  if (permissionButtonVisible) {
    await client.mouseClickSelector('[data-testid="composer-permission-button"]');
    const agentOptionVisible = await client.waitFor("Boolean(document.querySelector('[data-testid=permission-option-agent]'))", 5_000).then(() => true).catch(() => false);
    if (agentOptionVisible) await client.mouseClickSelector('[data-testid="permission-option-agent"]');
  }
  actions.push({ type: "ui-click", target: "新对话" }, { type: "ui-click", target: "替我审批" });
  await client.waitFor(`(() => [...document.querySelectorAll('textarea,[contenteditable="true"]')].some((n) => n.offsetWidth > 0 && n.offsetHeight > 0))()`);
  const composer = await client.evaluate(`(() => { const n = [...document.querySelectorAll('textarea,[contenteditable="true"]')].find((x) => x.offsetWidth > 0 && x.offsetHeight > 0); if (!n) return null; n.setAttribute('data-visible-game-prompt','true'); return n.tagName === 'TEXTAREA' ? 'textarea[data-visible-game-prompt="true"]' : '[contenteditable="true"][data-visible-game-prompt="true"]'; })()`);
  await client.mouseClickSelector(composer);
  const encoded = Buffer.from(prompt, "utf8").toString("base64");
  await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `$v=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')); Set-Clipboard -Value $v`], { windowsHide: true });
  await osKeyCombo(true, "v");
  await osPressEnter();
  actions.push({ type: "os-keyboard-submit", prompt });
  const deadline = Date.now() + 180_000;
  let state;
  while (Date.now() < deadline) {
    state = await client.evaluate(`(() => ({ text: document.body?.innerText?.slice(-12000) || '', busy: Boolean(document.querySelector('[data-generating="true"],.is-generating,button[aria-label*="停止"]')) || /正在思考|进行中|正在继续执行|等待批准/u.test(document.body?.innerText?.slice(-12000) || '') }))()`);
    // Approval is still resolved through the visible page. Agent mode reduces
    // routine prompts, while this keeps explicit high-risk confirmations
    // auditable instead of bypassing them through IPC.
    const approvalVisible = await client.evaluate(`(() => [...document.querySelectorAll('button')].some((button) => {
      const rect = button.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && button.innerText.includes('批准并继续') && !button.disabled;
    }))()`);
    if (approvalVisible) {
      await client.mouseClickButtonText('批准并继续');
      actions.push({ type: "ui-click", target: "批准并继续" });
      await new Promise((resolve) => setTimeout(resolve, 500));
      continue;
    }
    const delta = state.text.slice(Math.max(0, beforeText.length - 120));
    const mentions = (delta.match(/青石谷入口/gu) || []).length;
    const hasAssistantResult = mentions > 1 && /工具调用|工具结果|已处理|已保存到|写入工程|调用/u.test(delta);
    if (!state.busy && hasAssistantResult) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  const delta = state?.text?.slice(Math.max(0, beforeText.length - 120)) || "";
  const mentions = (delta.match(/青石谷入口/gu) || []).length;
  const completed = !state?.busy && mentions > 1 && /工具调用|工具结果|已处理|已保存到|写入工程|调用/u.test(delta);
  console.log(JSON.stringify({ caseId: "VISIBLE-GAME-PROMPT-LEVEL", actions, completed, mentions, tail: state?.text?.slice(-3000) }, null, 2));
} finally { await client.close(); }
