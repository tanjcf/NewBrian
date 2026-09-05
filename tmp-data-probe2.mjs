import { createSceneTestCdpClient } from "./platforms/windows/apps/desktop/scripts/scene-test-cdp-client.mjs";
const c = await createSceneTestCdpClient(9356);
await c.waitForAppReady();
const s = await c.evaluate(`(() => ({
  chooseProject: Boolean([...document.querySelectorAll('button')].find(b => (b.textContent||'').includes('Choose project') && b.offsetParent)),
  picker: Boolean(document.querySelector('.new-chat-project-picker')?.offsetParent),
  sendDisabled: document.querySelector('[data-testid="composer-send-button"]')?.disabled,
  sendTitle: document.querySelector('[data-testid="composer-send-button"]')?.getAttribute('title') || '',
  composerTag: document.querySelector('[data-testid="composer-input"]')?.tagName,
  composerLen: (document.querySelector('[data-testid="composer-input"]')?.value || '').length,
  bodyHasOld: document.body.innerText.includes('必须先调用 data.file.import_local'),
  bodyHasLoop3: /DATA-LOOP-003/.test(document.body.innerText),
  visibleButtons: [...document.querySelectorAll('button')].filter(b=>b.offsetParent).map(b=>(b.textContent||'').trim().slice(0,50)).filter(t=>/项目|Choose|聊天|发送|批准|新对话|1787622968401/.test(t))
}))()`);
console.log(JSON.stringify(s, null, 2));
await c.close({ keepProcess: true });
