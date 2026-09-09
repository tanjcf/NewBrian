import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createSceneTestCdpClient } from "./scene-test-cdp-client.mjs";

const client = await createSceneTestCdpClient(Number(process.env.NEWBRAIN_E2E_REMOTE_DEBUG_PORT || 9555));
const cases = [
  ["关卡", "关卡列表"],
  ["项目与文件", "项目资产与试玩"],
  ["游戏策划", "定义核心体验"],
  ["角色与世界观", "维护世界规则"],
  ["战斗设计", "管理玩家操作"],
  ["资产与测试", "资产与测试"]
];
const actions = [];
const results = [];
try {
  execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "$s=New-Object -ComObject WScript.Shell; [void]$s.AppActivate('NewBrain')"], { windowsHide: true });
  await new Promise((resolve) => setTimeout(resolve, 500));
  await client.waitForAppReady();
  const selected = await client.getSelectedWorkspaceKey();
  if (selected !== "game") {
    await client.switchWorkspace("game");
    actions.push({ type: "ui-click", target: "游戏制作" });
  }
  for (const [index, [label, expected]] of cases.entries()) {
    const point = await client.evaluate(`(() => { const b = document.querySelector('.brain-resource-scene-nav button:nth-child(${index + 1})'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    assert.ok(point, `tab not found: ${label}`);
    await client.command("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
    await client.command("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
    actions.push({ type: "ui-click", target: label });
    await client.waitFor(`(() => { const active = document.querySelector('.brain-resource-scene-nav button.active'); return active?.textContent?.trim() === ${JSON.stringify(label)}; })()`, 15_000);
    await client.waitFor(`document.body?.innerText?.includes(${JSON.stringify(expected)})`, 20_000);
    const visibleText = await client.evaluate("document.body?.innerText?.slice(-1800) || ''");
    assert.match(visibleText, new RegExp(expected.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")));
    results.push({ tab: label, expected, passed: true });
  }
  console.log(JSON.stringify({ ok: true, caseId: "VISIBLE-GAME-TABS-E2E", actions, results }, null, 2));
} finally {
  await client.close();
}
