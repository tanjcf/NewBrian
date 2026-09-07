import { writeFile } from "node:fs/promises";
import { createSceneTestCdpClient } from "./platforms/windows/apps/desktop/scripts/scene-test-cdp-client.mjs";

const c = await createSceneTestCdpClient(9356);
await c.waitForAppReady();

async function clickText(text) {
  const p = await c.evaluate(`(() => {
    const el = [...document.querySelectorAll('button')].find(n => (n.textContent||'').trim() === ${JSON.stringify(text)} && n.offsetParent);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) };
  })()`);
  if (!p) return false;
  await c.command("Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button: "left", buttons: 1, clickCount: 1 });
  await c.command("Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x, y: p.y, button: "left", buttons: 0, clickCount: 1 });
  return true;
}

// Prefer new chat surface
await clickText("新对话");
await new Promise((r) => setTimeout(r, 1200));

const info = await c.evaluate(`(() => {
  const shell = document.querySelector('.new-chat-composer-shell');
  const card = document.querySelector('.new-chat-composer-shell .composer-card');
  const row = document.querySelector('.new-chat-composer-shell .new-chat-project-row');
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  };
  const cs = (el) => el ? getComputedStyle(el) : null;
  return {
    shell: Boolean(shell),
    shellBox: box(shell),
    cardBox: box(card),
    rowBox: box(row),
    cardRadius: cs(card)?.borderRadius,
    rowRadius: cs(row)?.borderRadius,
    widthMatch: card && row ? Math.abs(card.getBoundingClientRect().width - row.getBoundingClientRect().width) < 2 : false,
    gap: card && row ? Math.round(row.getBoundingClientRect().top - card.getBoundingClientRect().bottom) : null,
    composerClass: document.querySelector('.new-chat-composer-shell .composer-area')?.className || null,
    h1: document.querySelector('.new-chat-canvas h1')?.textContent || ''
  };
})()`);

const shot = await c.command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
await writeFile("evidence/ui-newchat-composer-shell.png", Buffer.from(shot.data, "base64"));
console.log(JSON.stringify(info, null, 2));
await c.close({ keepProcess: true });
