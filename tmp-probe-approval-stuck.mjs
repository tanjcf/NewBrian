import { writeFile } from "node:fs/promises";
import { createSceneTestCdpClient } from "./platforms/windows/apps/desktop/scripts/scene-test-cdp-client.mjs";

const c = await createSceneTestCdpClient(9356);
const s = await c.evaluate(`(() => {
  const text = document.body.innerText || "";
  return {
    hasWaitingReview: /等待审核|等待批准|正在继续执行|批准并继续/.test(text),
    bodyTail: text.slice(-7000),
    approvalBanner: document.querySelector('[data-testid="conversation-approval-dialog"]')?.innerText?.slice(0, 2500) || "",
    buttons: [...document.querySelectorAll("button")].filter((x) => x.offsetParent).map((x) => ({
      text: (x.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 100),
      testid: x.dataset.testid || "",
      disabled: Boolean(x.disabled)
    })).filter((b) => /批准|拒绝|继续|停止|取消|审核|等待|允许/.test(b.text) || /approval/i.test(b.testid)),
    badges: [...document.querySelectorAll(".thread-approval-badge, .approval-request-banner, [class*=approval]")].map((x) => ({
      cls: String(x.className || "").slice(0, 120),
      text: (x.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 240)
    })).slice(0, 30),
    statusBits: [...document.querySelectorAll("[class*=status], .conversation-item-meta, .assistant-live-status")].map((x) => (x.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 160)).filter(Boolean).slice(0, 40)
  };
})()`);

const live = await c.evaluate(`(async () => {
  try {
    const snap = await window.codecn?.getSessionSnapshot?.();
    return {
      ok: true,
      approval: snap?.approval || null,
      pendingTool: snap?.pendingTool || null,
      sessionStatus: snap?.session?.status || snap?.status || null,
      runs: (snap?.runs || []).slice(0, 8).map((r) => ({ id: r.id, status: r.status, name: r.name || r.tool || r.title }))
    };
  } catch (error) {
    return { ok: false, reason: String(error) };
  }
})()`);

const shot = await c.command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
await writeFile("evidence/SOFTWARE-AUTOMATION-E2E/approval-stuck.png", Buffer.from(shot.data, "base64"));
await writeFile("evidence/SOFTWARE-AUTOMATION-E2E/approval-stuck.json", JSON.stringify({ s, live }, null, 2));
console.log(JSON.stringify({ s, live }, null, 2));
await c.close({ keepProcess: true });
