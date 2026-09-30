import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { ensureElectronE2ESession } from "./electron-e2e-session.mjs";

const debugPort = Number(process.env.NEWBRAIN_E2E_REMOTE_DEBUG_PORT || 9333);
const session = await ensureElectronE2ESession(debugPort);
const page = session.pages.find((candidate) => candidate.type === "page" && candidate.webSocketDebuggerUrl);
assert.ok(page, "No debuggable Electron renderer page was found.");

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

if (!session.started) {
  // Reload an already-running renderer so the check always uses the latest production build.
  socket.send(JSON.stringify({ id: 0, method: "Page.reload", params: { ignoreCache: true } }));
  await new Promise((resolve) => setTimeout(resolve, 1_500));
} else {
  await new Promise((resolve) => setTimeout(resolve, 1_500));
}

const result = await new Promise((resolve, reject) => {
  const id = 1;
  const timeout = setTimeout(() => reject(new Error("Composer layout evaluation timed out.")), 10_000);
  socket.addEventListener("message", (event) => {
    const payload = JSON.parse(event.data);
    if (payload.id !== id) return;
    clearTimeout(timeout);
    if (payload.error || payload.result?.exceptionDetails) {
      reject(new Error(payload.error?.message || payload.result.exceptionDetails.text));
      return;
    }
    resolve(payload.result.result.value);
  });
  socket.send(JSON.stringify({
    id,
    method: "Runtime.evaluate",
    params: {
      returnByValue: true,
      expression: `(() => {
        const fixture = document.createElement('section');
        fixture.className = 'task-column';
        fixture.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:2147483647';
        fixture.innerHTML = '<header></header><main class="task-scroll"><section class="assistant-file-context"><button class="assistant-file-context-summary">编辑了 1 个文件</button></section><section class="assistant-file-context expanded"><button class="assistant-file-context-summary">编辑了 1 个文件</button><div class="assistant-file-context-list"><div class="assistant-file-context-item expanded"><div class="assistant-file-context-row"><button class="assistant-file-diff-toggle">›</button><button class="assistant-file-link">docs/report.md</button><span class="assistant-file-stats"><i>+14</i><b>-2</b></span><button class="assistant-file-review">审核</button></div><div class="assistant-inline-diff"><div class="assistant-inline-diff-code"><div class="assistant-inline-diff-row add"><span>1</span><code>+new line</code></div><div class="assistant-inline-diff-row del"><span>2</span><code>-old line</code></div></div></div></div></div></section></main><aside class="delegated-agent-panel"><header class="delegated-agent-panel__header"><div><strong>details</strong><span>0/8</span></div><button>×</button></header><div class="delegated-agent-panel__list">' + '<article class="delegated-agent-item">delegated agent status</article>'.repeat(80) + '</div></aside><footer class="composer-area"><div class="composer-card busy"><button class="delegated-agent-strip"><strong>agents</strong><span>0/8</span></button><div class="composer-busy-note">busy</div><textarea></textarea><div class="composer-tools"></div></div></footer>';
        fixture.querySelector('.composer-tools').innerHTML = '<div class="composer-modern-controls"><div class="composer-picker-wrap"><button class="composer-icon-button">+</button><div class="composer-picker-menu composer-add-menu"><span class="composer-menu-label">add</span><button><svg></svg><span><strong>file</strong><small>file details</small></span><span class="composer-add-option-check"></span></button><button class="active"><svg></svg><span><strong>goal</strong><small>goal details</small></span><span class="composer-add-option-check">✓</span></button><button class="composer-builtin-plugin" data-plugin="documents"><span class="composer-builtin-plugin-icon violet"><svg></svg></span><span><strong>Documents</strong><small>document details</small></span></button></div></div><div class="composer-picker-wrap"><button data-testid="composer-goal-button" class="composer-goal-button"><svg></svg><span>目标</span></button></div><div class="composer-picker-wrap"><button data-testid="composer-plan-button" class="composer-plan-button"><svg></svg><span>计划</span></button></div><div class="composer-picker-wrap"><button class="composer-skill-button"><svg stroke="currentColor"><path d="M2 2h10v10H2z"></path></svg><span>template-creator</span><svg></svg></button><div class="composer-picker-menu composer-skill-menu"><span class="composer-menu-label">skills</span><button><span class="composer-skill-option-icon"><svg></svg></span><span class="composer-skill-option-copy"><strong>government</strong></span><span class="composer-skill-option-check">✓</span></button><button class="composer-skill-clear"><span class="composer-skill-option-icon"><svg></svg></span><span class="composer-skill-option-copy"><strong>关闭技能</strong></span><span class="composer-skill-option-check"></span></button></div></div><div class="composer-picker-wrap"><button class="composer-permission-button permission-approval"><svg></svg><span>请求批准</span><svg></svg></button><div class="composer-picker-menu composer-permission-menu"><span class="composer-menu-label">permissions</span><button class="active" data-permission-option="approval"><span class="permission-option-icon"><svg></svg></span><span class="permission-option-copy"><strong>approval</strong><small>approval details</small></span><span class="permission-option-check">✓</span></button></div></div></div>';
        const selectedPluginFixture = document.createElement('button');
        selectedPluginFixture.className = 'composer-skill-button selected-plugin-fixture';
        selectedPluginFixture.innerHTML = '<span class="composer-builtin-plugin-icon blue" data-plugin="visualize"><svg viewBox="0 0 16 16"><path d="M3 12V8M7 12V4M11 12V6"></path></svg></span><span>visualize</span><svg></svg>';
        fixture.querySelector('.composer-builtin-plugin-icon')?.setAttribute('data-plugin', 'documents');
        const selectedPluginHost = document.createElement('div');
        selectedPluginHost.className = 'new-chat-composer';
        selectedPluginHost.innerHTML = '<div class="composer-modern-controls"></div>';
        selectedPluginHost.querySelector('.composer-modern-controls').append(selectedPluginFixture);
        fixture.append(selectedPluginHost);
        document.body.append(fixture);
        const newChatFixture = document.createElement('section');
        newChatFixture.className = 'new-chat-task';
        newChatFixture.style.cssText = 'position:fixed;left:420px;top:260px;width:728px;z-index:2147483647';
        newChatFixture.innerHTML = '<div class="new-chat-composer-slot"><footer class="composer-area new-chat-composer"><div class="composer-card"><textarea></textarea><div class="composer-tools"><div class="composer-modern-controls"><div class="composer-picker-wrap"><button class="composer-icon-button">+</button><div class="composer-picker-menu composer-add-menu"><span class="composer-menu-label">add</span>' + '<button><svg></svg><span><strong>plugin</strong><small>plugin details</small></span></button>'.repeat(18) + '</div></div></div></div></div></footer></div>';
        document.body.append(newChatFixture);
        const rect = (selector) => {
          const value = fixture.querySelector(selector).getBoundingClientRect();
          return { left: value.left, top: value.top, bottom: value.bottom, width: value.width, height: value.height };
        };
        const rectForElement = (element) => {
          const value = element.getBoundingClientRect();
          return { width: value.width, height: value.height };
        };
        const report = {
          viewportHeight: window.innerHeight,
          area: rect('.composer-area'),
          card: rect('.composer-card'),
          strip: rect('.delegated-agent-strip'),
          panel: rect('.delegated-agent-panel'),
          busy: rect('.composer-busy-note'),
          textarea: rect('textarea'),
          tools: rect('.composer-tools'),
          skillButton: rect('.composer-skill-button'),
          goalButton: rect('.composer-goal-button'),
          planButton: rect('.composer-plan-button'),
          permissionButton: rect('.composer-permission-button'),
          skillButtonStyle: (() => {
            const style = getComputedStyle(fixture.querySelector('.composer-skill-button'));
            return { fontSize: style.fontSize, fontWeight: style.fontWeight, lineHeight: style.lineHeight };
          })(),
          goalButtonStyle: (() => {
            const style = getComputedStyle(fixture.querySelector('.composer-goal-button'));
            return { fontSize: style.fontSize, fontWeight: style.fontWeight, lineHeight: style.lineHeight };
          })(),
          goalButtonSurface: (() => {
            const style = getComputedStyle(fixture.querySelector('.composer-goal-button'));
            return { background: style.backgroundColor, borderRadius: style.borderRadius, borderWidth: style.borderWidth };
          })(),
          planButtonStyle: (() => {
            const style = getComputedStyle(fixture.querySelector('.composer-plan-button'));
            return { fontSize: style.fontSize, fontWeight: style.fontWeight, lineHeight: style.lineHeight };
          })(),
          planButtonSurface: (() => {
            const style = getComputedStyle(fixture.querySelector('.composer-plan-button'));
            return { background: style.backgroundColor, borderRadius: style.borderRadius, borderWidth: style.borderWidth };
          })(),
          permissionButtonStyle: (() => {
            const style = getComputedStyle(fixture.querySelector('.composer-permission-button'));
            return { fontSize: style.fontSize, fontWeight: style.fontWeight, lineHeight: style.lineHeight };
          })(),
          skillIcons: Array.from(fixture.querySelectorAll('.composer-skill-button:not(.selected-plugin-fixture) > svg'), (icon) => rectForElement(icon)),
          skillLeadingIconStroke: getComputedStyle(fixture.querySelector('.composer-skill-button:not(.selected-plugin-fixture) > svg:first-child')).stroke,
          selectedPluginIcon: (() => {
            const icon = fixture.querySelector('.selected-plugin-fixture .composer-builtin-plugin-icon');
            const iconRect = icon.getBoundingClientRect();
            const svgRect = icon.querySelector('svg').getBoundingClientRect();
            const style = getComputedStyle(icon);
            return { width: iconRect.width, height: iconRect.height, svgWidth: svgRect.width, svgHeight: svgRect.height, background: style.backgroundColor, color: style.color };
          })(),
          permissionIcons: Array.from(fixture.querySelectorAll('.composer-permission-button > svg'), (icon) => rectForElement(icon)),
          skillMenuTitleStyle: getComputedStyle(fixture.querySelector('.composer-skill-option-copy strong')).fontSize,
          permissionMenuTitleStyle: getComputedStyle(fixture.querySelector('.permission-option-copy strong')).fontSize,
          skillMenuIcon: rectForElement(fixture.querySelector('.composer-skill-option-icon svg')),
          permissionMenuIcon: rectForElement(fixture.querySelector('.permission-option-icon svg')),
          skillMenuCheckStyle: getComputedStyle(fixture.querySelector('.composer-skill-option-check')).fontSize,
          permissionMenuCheckStyle: getComputedStyle(fixture.querySelector('.permission-option-check')).fontSize,
          addMenuTitleStyle: getComputedStyle(fixture.querySelector('.composer-add-menu strong')).fontSize,
          addMenuIcon: rectForElement(fixture.querySelector('.composer-add-menu button > svg')),
          addMenu: rect('.composer-add-menu'),
          addMenuOption: rect('.composer-add-menu > button'),
          addMenuOverflow: (() => {
            const menu = fixture.querySelector('.composer-add-menu');
            return { clientWidth: menu.clientWidth, scrollWidth: menu.scrollWidth, overflowX: getComputedStyle(menu).overflowX };
          })(),
          addMenuRowBackground: getComputedStyle(fixture.querySelector('.composer-add-menu > button')).backgroundColor,
          addMenuActiveBackground: getComputedStyle(fixture.querySelector('.composer-add-menu > button.active')).backgroundColor,
          addMenuCopyBackground: getComputedStyle(fixture.querySelector('.composer-add-menu > button > span:not(.composer-add-option-check)')).backgroundColor,
          addMenuCheckBackground: getComputedStyle(fixture.querySelector('.composer-add-option-check')).backgroundColor,
          addMenuCheckRadius: getComputedStyle(fixture.querySelector('.composer-add-option-check')).borderRadius,
          newChatAddMenu: (() => {
            const menu = newChatFixture.querySelector('.composer-add-menu');
            const value = menu.getBoundingClientRect();
            return {
              top: value.top,
              bottom: value.bottom,
              clientHeight: menu.clientHeight,
              scrollHeight: menu.scrollHeight,
              overflowY: getComputedStyle(menu).overflowY
            };
          })(),
          builtinPluginIcon: rectForElement(fixture.querySelector('.composer-builtin-plugin-icon')),
          builtinPluginIconBackground: getComputedStyle(fixture.querySelector('.composer-builtin-plugin-icon')).backgroundColor,
          builtinPluginIconColor: getComputedStyle(fixture.querySelector('.composer-builtin-plugin-icon')).color,
          skillMenu: rect('.composer-skill-menu'),
          skillMenuLabel: rect('.composer-skill-menu .composer-menu-label'),
          skillMenuOption: rect('.composer-skill-menu > button'),
          skillMenuClear: rect('.composer-skill-clear'),
          skillMenuClearIcon: rectForElement(fixture.querySelector('.composer-skill-clear svg')),
          skillMenuClearTitleStyle: getComputedStyle(fixture.querySelector('.composer-skill-clear strong')).fontSize,
          collapsedFileContext: rect('.assistant-file-context:not(.expanded)'),
          expandedFileContext: rect('.assistant-file-context.expanded'),
          inlineDiff: rect('.assistant-inline-diff')
        };
        return report;
      })()`
    }
  }));
});

assert.ok(result.card.bottom <= result.viewportHeight, "Composer extends below the Electron viewport.");
assert.ok(result.tools.bottom <= result.card.bottom, "Composer children overflow the card boundary.");
assert.ok(result.skillMenu.top >= 0 && result.skillMenu.bottom <= result.viewportHeight, "Skill menu is clipped by the Electron viewport.");
assert.ok(result.skillMenu.bottom <= result.skillButton.top, "Skill menu does not open above the bottom composer toolbar.");
assert.equal(result.permissionButton.height, result.skillButton.height, "Permission and skill controls have different heights.");
assert.equal(result.goalButton.height, result.skillButton.height, "Goal and skill controls have different heights.");
assert.deepEqual(result.goalButtonStyle, result.skillButtonStyle, "Goal and skill controls use different typography.");
assert.deepEqual(result.goalButtonSurface, { background: "rgba(0, 0, 0, 0)", borderRadius: "0px", borderWidth: "0px" }, "Goal control still uses a capsule surface.");
assert.equal(result.planButton.height, result.skillButton.height, "Plan and skill controls have different heights.");
assert.deepEqual(result.planButtonStyle, result.skillButtonStyle, "Plan and skill controls use different typography.");
assert.deepEqual(result.planButtonSurface, { background: "rgba(0, 0, 0, 0)", borderRadius: "0px", borderWidth: "0px" }, "Plan control still uses a capsule surface.");
assert.deepEqual(result.permissionButtonStyle, result.skillButtonStyle, "Permission and skill controls use different typography.");
assert.deepEqual(result.permissionIcons, result.skillIcons, "Permission and skill controls use different icon sizes.");
assert.notEqual(result.skillLeadingIconStroke, "none", "Selected plugin SVG stroke is hidden.");
assert.deepEqual(result.selectedPluginIcon, { width: 16, height: 16, svgWidth: 12, svgHeight: 12, background: "rgb(37, 141, 232)", color: "rgb(255, 255, 255)" }, "Selected visualize plugin does not keep its original icon treatment.");
assert.equal(result.permissionMenuTitleStyle, result.skillMenuTitleStyle, "Permission and skill menu titles use different font sizes.");
assert.deepEqual(result.permissionMenuIcon, result.skillMenuIcon, "Permission and skill menu icons use different sizes.");
assert.equal(result.permissionMenuCheckStyle, result.skillMenuCheckStyle, "Permission and skill menu checks use different font sizes.");
assert.equal(result.addMenuTitleStyle, result.skillMenuTitleStyle, "Add and skill menu titles use different font sizes.");
assert.deepEqual(result.addMenuIcon, result.skillMenuIcon, "Add and skill menu icons use different sizes.");
assert.ok(result.addMenu.width >= 680 && result.addMenu.width <= 720, "Add menu does not match the wide prototype.");
assert.equal(result.addMenuOption.height, 32, "Add menu option does not match the flat prototype row height.");
assert.ok(result.addMenuOverflow.scrollWidth <= result.addMenuOverflow.clientWidth, "Add menu has horizontal overflow.");
assert.equal(result.addMenuOverflow.overflowX, "hidden", "Add menu horizontal overflow is not suppressed.");
assert.equal(result.addMenuRowBackground, "rgba(0, 0, 0, 0)", "Idle add-menu rows still use a capsule background.");
assert.notEqual(result.addMenuActiveBackground, "rgba(0, 0, 0, 0)", "Active add-menu row has no selection background.");
assert.equal(result.addMenuCopyBackground, "rgba(0, 0, 0, 0)", "Add-menu copy still uses a capsule background.");
assert.equal(result.addMenuCheckBackground, "rgba(0, 0, 0, 0)", "Add-menu check still uses a capsule background.");
assert.equal(result.addMenuCheckRadius, "0px", "Add-menu check still has capsule rounding.");
assert.ok(result.newChatAddMenu.top >= 42, "New-chat add menu is hidden behind the desktop title bar.");
assert.ok(result.newChatAddMenu.bottom <= result.viewportHeight, "New-chat add menu extends below the Electron viewport.");
assert.ok(result.newChatAddMenu.scrollHeight > result.newChatAddMenu.clientHeight, "Long new-chat add menu does not scroll internally.");
assert.equal(result.newChatAddMenu.overflowY, "auto", "New-chat add menu does not expose internal vertical scrolling.");
assert.deepEqual(result.builtinPluginIcon, { width: 16, height: 16 }, "Built-in plugin icon container has the wrong size.");
assert.equal(result.builtinPluginIconBackground, "rgb(66, 133, 244)", "Built-in plugin icon background is not visible.");
assert.equal(result.builtinPluginIconColor, "rgb(255, 255, 255)", "Built-in plugin SVG does not contrast with its background.");
assert.ok(result.skillMenu.width >= 140 && result.skillMenu.width <= 160, "Skill menu does not match the compact prototype width.");
assert.ok(result.skillMenu.height >= 80 && result.skillMenu.height <= 120, `Skill menu does not match the compact prototype height: ${JSON.stringify(result)}`);
assert.equal(result.skillMenuClear.height, result.skillMenuOption.height, "Clear-skill row height differs from skill options.");
assert.deepEqual(result.skillMenuClearIcon, result.skillMenuIcon, "Clear-skill icon differs from skill option icons.");
assert.equal(result.skillMenuClearTitleStyle, result.skillMenuTitleStyle, "Clear-skill title differs from skill option titles.");
assert.ok(result.strip.bottom <= result.textarea.top, "Delegated-agent strip overlaps the input.");
assert.ok(result.busy.top >= result.textarea.top && result.busy.bottom <= result.textarea.bottom, "Busy note leaves the padded input status region.");
assert.ok(result.textarea.bottom <= result.tools.top, "Input overlaps the composer toolbar.");
assert.ok(result.panel.bottom <= result.viewportHeight, "Delegated-agent details panel leaves the viewport.");
assert.ok(result.strip.height >= 31 && result.textarea.height >= 55, "Required composer regions collapsed.");
assert.ok(result.collapsedFileContext.height < result.expandedFileContext.height, "Collapsed file context did not progressively disclose its file list.");
assert.ok(result.inlineDiff.height > 0 && result.inlineDiff.bottom <= result.expandedFileContext.bottom, "Inline diff escaped the expanded file context.");

const hoverX = result.goalButton.left + result.goalButton.width / 2;
const hoverY = result.goalButton.top + result.goalButton.height / 2;
socket.send(JSON.stringify({ id: 2, method: "Input.dispatchMouseEvent", params: { type: "mouseMoved", x: hoverX, y: hoverY } }));
await new Promise((resolve) => setTimeout(resolve, 150));
const hoverResult = await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("Goal hover evaluation timed out.")), 10_000);
  socket.addEventListener("message", (event) => {
    const payload = JSON.parse(event.data);
    if (payload.id !== 3) return;
    clearTimeout(timeout);
    resolve(payload.result.result.value);
  });
  socket.send(JSON.stringify({ id: 3, method: "Runtime.evaluate", params: { returnByValue: true, expression: `(() => { const button = document.querySelector('[data-testid="composer-goal-button"]'); const style = getComputedStyle(button); return { exists: Boolean(button), text: button?.textContent, background: style.backgroundColor, borderRadius: style.borderRadius }; })()` } }));
});
assert.deepEqual(hoverResult, { exists: true, text: "目标", background: "rgba(0, 0, 0, 0)", borderRadius: "0px" }, "Goal control disappears or regains a capsule surface on hover.");

const planHoverX = result.planButton.left + result.planButton.width / 2;
const planHoverY = result.planButton.top + result.planButton.height / 2;
socket.send(JSON.stringify({ id: 5, method: "Input.dispatchMouseEvent", params: { type: "mouseMoved", x: planHoverX, y: planHoverY } }));
await new Promise((resolve) => setTimeout(resolve, 150));
const planHoverResult = await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("Plan hover evaluation timed out.")), 10_000);
  socket.addEventListener("message", (event) => {
    const payload = JSON.parse(event.data);
    if (payload.id !== 6) return;
    clearTimeout(timeout);
    resolve(payload.result.result.value);
  });
  socket.send(JSON.stringify({ id: 6, method: "Runtime.evaluate", params: { returnByValue: true, expression: `(() => { const button = document.querySelector('[data-testid="composer-plan-button"]'); const style = getComputedStyle(button); return { exists: Boolean(button), text: button?.textContent, background: style.backgroundColor, borderRadius: style.borderRadius }; })()` } }));
});
assert.deepEqual(planHoverResult, { exists: true, text: "计划", background: "rgba(0, 0, 0, 0)", borderRadius: "0px" }, "Plan control disappears or regains a capsule surface on hover.");

const screenshot = await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("Composer screenshot timed out.")), 10_000);
  socket.addEventListener("message", (event) => {
    const payload = JSON.parse(event.data);
    if (payload.id !== 4) return;
    clearTimeout(timeout);
    resolve(payload.result.data);
  });
  socket.send(JSON.stringify({ id: 4, method: "Page.captureScreenshot", params: { format: "png" } }));
});
mkdirSync("tmp/e2e", { recursive: true });
writeFileSync("tmp/e2e/composer-goal-plan-hover.png", Buffer.from(screenshot, "base64"));

socket.close();
session.close();
console.log(JSON.stringify({ ok: true, ...result }, null, 2));
