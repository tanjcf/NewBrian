import { writeFile } from "node:fs/promises";
import { createSceneTestCdpClient } from "./platforms/windows/apps/desktop/scripts/scene-test-cdp-client.mjs";

const c = await createSceneTestCdpClient(9356);
try {
  await c.waitForAppReady();
} catch (e) {
  console.log("waitForAppReady:", String(e));
}
const info = await c.evaluate(`(() => ({
  title: document.title,
  readySelector: Boolean(document.querySelector('.brain-workspace-switcher')),
  trigger: Boolean(document.querySelector('.brain-workspace-trigger')),
  bodyHead: (document.body?.innerText || '').slice(0, 2500),
  buttons: [...document.querySelectorAll('button')].filter(x => x.offsetParent).map(x => (x.textContent||'').replace(/\\s+/g,' ').trim().slice(0,80)).slice(0,40),
  classes: [...document.querySelectorAll('[class*=workspace],[class*=brain]')].slice(0,30).map(el => el.className)
}))()`);
const shot = await c.command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
await writeFile("evidence/SOFTWARE-AUTOMATION-E2E/probe-ui.png", Buffer.from(shot.data, "base64"));
await writeFile("evidence/SOFTWARE-AUTOMATION-E2E/probe-ui.json", JSON.stringify(info, null, 2));
console.log(JSON.stringify(info, null, 2));
await c.close({ keepProcess: true });
