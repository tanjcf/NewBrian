import { createSceneTestCdpClient } from "./platforms/windows/apps/desktop/scripts/scene-test-cdp-client.mjs";
const c = await createSceneTestCdpClient(9356);
await c.waitForAppReady();
const info = await c.evaluate(`(() => {
  const task = document.querySelector('.task-column');
  const slot = document.querySelector('.new-chat-composer-slot');
  const composer = document.querySelector('.new-chat-composer-slot .composer-area, .composer-area');
  const card = document.querySelector('.new-chat-composer-slot .composer-card, .composer-card');
  const row = document.querySelector('.new-chat-project-row');
  const cs = (el) => el ? getComputedStyle(el) : null;
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  };
  return {
    taskClass: task?.className || null,
    slotExists: Boolean(slot),
    composerClass: composer?.className || null,
    cardClass: card?.className || null,
    rowClass: row?.className || null,
    composerBox: box(composer),
    cardBox: box(card),
    rowBox: box(row),
    slotBox: box(slot),
    cardRadius: cs(card)?.borderRadius,
    cardBorderBottom: cs(card)?.borderBottomColor,
    rowRadius: cs(row)?.borderRadius,
    rowWidth: cs(row)?.width,
    cardWidth: cs(card)?.width,
    gap: row && card ? Math.round(row.getBoundingClientRect().top - card.getBoundingClientRect().bottom) : null,
    h1: document.querySelector('.new-chat-canvas h1')?.textContent || '',
    placeholder: document.querySelector('[data-testid="composer-input"]')?.placeholder || ''
  };
})()`);
console.log(JSON.stringify(info, null, 2));
await c.close({ keepProcess: true });
