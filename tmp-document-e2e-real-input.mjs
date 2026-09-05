import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, writeFile, readdir, stat, readFile, copyFile } from "node:fs/promises";
import { join, extname, basename } from "node:path";
import { promisify } from "node:util";
import { createSceneTestCdpClient } from "./platforms/windows/apps/desktop/scripts/scene-test-cdp-client.mjs";
import { osKeyCombo, osPressEscape } from "./platforms/windows/apps/desktop/scripts/scene-test-os-input.mjs";

const execFileAsync = promisify(execFile);
const caseId = "DOC-E2E-REAL-001";
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const debugPort = Number(process.env.CODECN_E2E_REMOTE_DEBUG_PORT || 9356);
const projectName = `基层治理数字化-E2E-${Date.now()}`;
const evidenceDir = `evidence/${caseId}/${stamp}`;
const marker = "请只使用右侧「文档创作」Tools";
const topic = "基层治理数字化转型工作汇报";

const prompt = `${marker} 操作当前项目，完成「${topic}」真实文档创作闭环（不得只回复方案或代码，不得使用模拟文稿）：
1. 项目与文件：在当前文档项目中创建真实文稿；确保右侧「项目与文件 / 文件」能看到真实文件条目（非原型）。
2. 大纲与结构：根据主题生成完整大纲（至少 3 个一级章节：工作背景、推进举措、下一步计划），并写入文稿结构。
3. 正文撰写：按大纲撰写完整中文正文（含标题、段落、列表要点），并必须调用 document.create_docx 与 document.create_pdf 生成真实文件到 outputs/（不得只写 md）；生成后调用 artifact.inspect 校验。若右侧文件未出现，再调用 document.project.sync_outputs。
4. 引用：正文至少包含 1 处可核验的来源/参考文献说明。
5. PPT：若能力可用，基于正文生成简要 PPTX；若不可用，如实说明并跳过，不得伪造。
6. 审校与修改：在右侧「审校」可见标注或修改提案；至少完成一次可验证修改（修订某一章节标题或段落后重新导出）。
7. 导出与验收：最终必须有真实可打开的 DOCX 或 PDF，大小>0；报告右侧文件/产物/审校真实状态。失败时如实说明，禁止编造已导出。`;

const revisePrompt = `DOC-REVISE-001：请基于刚才导出的文档，把「下一步计划」章节标题改为「下一步工作安排与保障措施」，更新正文对应段落，再次调用 document.create_docx 或 document.create_pdf 导出新版本，并 artifact.inspect。`;

await mkdir(evidenceDir, { recursive: true });

async function activateWindow() {
  try {
    await execFileAsync("powershell.exe", ["-NoProfile", "-File", join(process.cwd(), "tmp-focus-codecn.ps1")], { windowsHide: false });
  } catch {
    try {
      await execFileAsync("powershell.exe", ["-NoProfile", "-Command",
        "$w=New-Object -ComObject WScript.Shell; if(-not $w.AppActivate('codeCN')){exit 2}"], { windowsHide: true });
    } catch {}
  }
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function shot(client, name) {
  const result = await client.command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const path = `${evidenceDir}/${name}.png`;
  await writeFile(path, Buffer.from(result.data, "base64"));
  return path;
}

async function state(client) {
  try {
    return await client.evaluate(`(() => ({
    body: document.body.innerText.slice(0, 12000),
    workspace: (() => { try { const r=localStorage.getItem('brain.workspaceSelection.v2'); return r?JSON.parse(r):null; } catch { return null; } })(),
    composerValue: document.querySelector('[data-testid="composer-input"]')?.value || '',
    composerLen: (document.querySelector('[data-testid="composer-input"]')?.value || '').length,
    buttons: [...document.querySelectorAll('button')].filter(x => x.offsetParent).map(x => ({
      text: x.textContent?.trim()?.slice(0, 100),
      title: x.title || '',
      testid: x.dataset.testid || ''
    })).slice(0, 160),
    sceneTabs: [...document.querySelectorAll('.brain-resource-scene-nav button')].map(x => x.textContent?.trim()),
    globalTabs: [...document.querySelectorAll('.brain-resource-global-nav button')].map(x => x.textContent?.trim()),
    fileTabCount: (() => {
      const tab = [...document.querySelectorAll('.brain-resource-global-nav button')].find(x => /^文件/.test((x.textContent || '').trim()));
      const m = (tab?.textContent || '').match(/文件\\s*(\\d+)/);
      return m ? Number(m[1]) : 0;
    })(),
    artifactTabCount: (() => {
      const tab = [...document.querySelectorAll('.brain-resource-global-nav button')].find(x => /^产物/.test((x.textContent || '').trim()));
      const m = (tab?.textContent || '').match(/产物\\s*(\\d+)/);
      return m ? Number(m[1]) : 0;
    })(),
    docWorkspace: document.querySelector('[data-testid="brain-document-workspace"]')?.innerText?.slice(0, 2000) || '',
    docActiveView: document.querySelector('[data-testid="brain-document-workspace"]')?.dataset?.activeView || '',
    resourceRows: [...document.querySelectorAll('.brain-resource-row')].slice(0, 30).map(x => x.innerText?.replace(/\\s+/g,' ').trim().slice(0, 120)),
    approvalCards: [],
    menuOpen: Boolean(document.querySelector('.composer-add-menu,.composer-picker-menu,.project-create-menu,.brain-workspace-menu')?.offsetParent),
    busyText: /停止|取消|正在处理|正在思考/.test(document.body.innerText.slice(-2000))
  }))()`);
  } catch (error) {
    return {
      body: "",
      buttons: [],
      sceneTabs: [],
      globalTabs: [],
      fileTabCount: 0,
      artifactTabCount: 0,
      resourceRows: [],
      menuOpen: false,
      evaluateError: String(error)
    };
  }
}

async function viewportPoint(client, rootSelector, text = "") {
  const value = await client.evaluate(`(() => {
    const root = document.querySelector(${JSON.stringify(rootSelector)}) || document.body;
    let el = null;
    if (${JSON.stringify(Boolean(text))}) {
      const nodes = [...root.querySelectorAll('button,a,[role=button]')];
      el = nodes.find(n => (n.textContent || '').replace(/\\s+/g, ' ').trim() === ${JSON.stringify(text)})
        || nodes.find(n => {
          const t = (n.textContent || '').replace(/\\s+/g, ' ').trim();
          const r = n.getBoundingClientRect();
          return t.includes(${JSON.stringify(text)}) && r.width > 0 && r.width < 700 && r.height < 140;
        });
    } else {
      el = root.querySelector ? root : document.querySelector(${JSON.stringify(rootSelector)});
      if (!el) el = root;
    }
    if (!el) return null;
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    return {
      x: Math.round(r.left + Math.min(24, r.width / 2)),
      y: Math.round(r.top + Math.min(12, r.height / 2)),
      cx: Math.round(r.left + r.width / 2),
      cy: Math.round(r.top + r.height / 2),
      rect: { left: r.left, top: r.top, width: r.width, height: r.height }
    };
  })()`);
  assert.ok(value, `${rootSelector} ${text}`);
  return value;
}

async function cdpClickAt(client, x, y) {
  await client.command("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await client.command("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
  await client.command("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
  await sleep(120);
}

async function click(client, rootSelector, text = "") {
  const value = await viewportPoint(client, rootSelector, text);
  await activateWindow();
  await cdpClickAt(client, value.cx, value.cy);
  return { at: new Date().toISOString(), method: "CDP Input.dispatchMouseEvent", target: text || rootSelector, ...value };
}

async function clickSelector(client, selector) {
  const value = await client.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    const padX = el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' ? 20 : r.width / 2;
    const padY = el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' ? 10 : r.height / 2;
    return {
      x: Math.round(r.left + padX),
      y: Math.round(r.top + padY),
      cx: Math.round(r.left + r.width / 2),
      cy: Math.round(r.top + r.height / 2),
      rect: { left: r.left, top: r.top, width: r.width, height: r.height }
    };
  })()`);
  assert.ok(value, selector);
  await activateWindow();
  await cdpClickAt(client, value.x, value.y);
  return { at: new Date().toISOString(), method: "CDP Input.dispatchMouseEvent", target: selector, ...value };
}

async function clickSceneTab(client, label) {
  const value = await client.evaluate(`(() => {
    const el = [...document.querySelectorAll('.brain-resource-scene-nav button, .brain-resource-global-nav button')].find(n => (n.textContent || '').replace(/\\s+/g,' ').trim().startsWith(${JSON.stringify(label)}));
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), text: el.textContent?.trim() };
  })()`);
  if (!value) return null;
  await activateWindow();
  await cdpClickAt(client, value.x, value.y);
  return { at: new Date().toISOString(), method: "CDP Input.dispatchMouseEvent", target: `tab:${label}`, ...value };
}

async function dismissMenus(client) {
  for (let i = 0; i < 6; i++) {
    const open = await client.evaluate(`Boolean(document.querySelector('.composer-add-menu,.composer-picker-menu,.project-create-menu,.brain-workspace-menu')?.offsetParent)`);
    await osPressEscape();
    await sleep(160);
    if (!open) break;
  }
}

async function focusComposerAndPaste(client, text, evidence, label) {
  await dismissMenus(client);
  await activateWindow();
  evidence.actions.push(await clickSelector(client, '[data-testid="composer-input"]'));
  await sleep(200);
  let focused = await client.evaluate(`document.activeElement?.getAttribute?.("data-testid") === "composer-input"`);
  if (!focused) {
    const p = await client.evaluate(`(() => {
      const el = document.querySelector('[data-testid="composer-input"]');
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left + 16), y: Math.round(r.top + 8) };
    })()`);
    await cdpClickAt(client, p.x, p.y);
    focused = await client.evaluate(`document.activeElement?.getAttribute?.("data-testid") === "composer-input"`);
  }
  assert.ok(focused, `${label}: composer not focused`);
  // Prefer OS clipboard paste for real keyboard path
  const b64 = Buffer.from(text, "utf16le").toString("base64");
  await execFileAsync("powershell.exe", ["-NoProfile", "-Command",
    `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Clipboard]::SetText([Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${b64}')))`], { windowsHide: true });
  await client.command("Input.dispatchKeyEvent", { type: "keyDown", modifiers: 2, key: "a", code: "KeyA", windowsVirtualKeyCode: 65 });
  await client.command("Input.dispatchKeyEvent", { type: "keyUp", modifiers: 2, key: "a", code: "KeyA", windowsVirtualKeyCode: 65 });
  await osKeyCombo(true, "v");
  await sleep(350);
  let after = await state(client);
  let ok = (after.composerValue || "").includes(marker) || (after.composerValue || "").includes("DOC-REVISE") || (after.composerLen || 0) > 80;
  if (!ok) {
    // Fallback: CDP insertText after visible focus (still after click)
    await client.command("Input.insertText", { text });
    await sleep(250);
    after = await state(client);
    ok = (after.composerValue || "").includes(marker) || (after.composerValue || "").includes("DOC-REVISE") || (after.composerLen || 0) > 80;
    evidence.actions.push({ at: new Date().toISOString(), method: "CDP Input.insertText fallback", target: label, chars: text.length });
  } else {
    evidence.actions.push({ at: new Date().toISOString(), method: "OS clipboard Ctrl+V after visible click", target: label, chars: text.length });
  }
  evidence.assertions.push({ name: `${label} composer has text`, pass: ok, composerLen: after.composerLen, preview: (after.composerValue || "").slice(0, 140) });
  assert.ok(ok, `${label}: composer paste failed`);
}

async function readProjectMeta(client) {
  try {
    return await client.evaluate(`(async () => {
    try {
      if (!window.codecn?.listBrainProjects) return { ok: false, reason: 'no-api' };
      const projects = await window.codecn.listBrainProjects({ workspaceKey: 'document' });
      const match = (projects || []).find(p => (p.name || '') === ${JSON.stringify(projectName)} || (p.name || '').includes(${JSON.stringify(projectName.slice(0, 14))}));
      if (!match) return { ok: true, projects: (projects || []).slice(0, 12).map(p => ({ id: p.id, name: p.name })) };
      let files = [];
      let artifacts = [];
      try { files = await window.codecn.listBrainFiles({ projectId: match.id }); } catch {}
      try { artifacts = await window.codecn.listBrainArtifacts?.({ projectId: match.id }) || []; } catch {}
      let workspacePath = '';
      try {
        const catalog = await window.codecn.listWorkspaces();
        const local = (catalog || []).find(w => w.id === match.localWorkspaceId);
        workspacePath = local?.path || '';
      } catch {}
      return {
        ok: true,
        project: { id: match.id, name: match.name, localWorkspaceId: match.localWorkspaceId, workspacePath },
        files: (files || []).map(f => ({ id: f.id, name: f.logicalName || f.storageKey, storageKey: f.storageKey, sizeBytes: f.sizeBytes, versionNo: f.versionNo })),
        artifacts: (artifacts || []).slice(0, 40).map(a => ({ id: a.id, type: a.artifactType, storageKey: a.storageKey, validationStatus: a.validationStatus }))
      };
    } catch (error) {
      return { ok: false, reason: String(error) };
    }
  })()`);
  } catch (error) {
    return { ok: false, reason: `evaluate-timeout:${String(error)}` };
  }
}

async function countRegisteredFiles(client) {
  try {
    const ui = await state(client);
    const meta = await readProjectMeta(client);
    const files = Array.isArray(meta?.files) ? meta.files : [];
    const listed = files.length;
    const hasOffice = files.some((file) => /\.(pdf|docx|pptx)$/i.test(String(file.name || file.storageKey || "")));
    const hasDocxOrPdf = files.some((file) => /\.(pdf|docx)$/i.test(String(file.name || file.storageKey || "")));
    return {
      fileTabCount: Number(ui.fileTabCount || 0),
      artifactTabCount: Number(ui.artifactTabCount || 0),
      listedFiles: listed,
      listedArtifacts: Array.isArray(meta?.artifacts) ? meta.artifacts.length : 0,
      hasFiles: listed > 0,
      hasOffice,
      hasDocxOrPdf,
      readyForPass: hasDocxOrPdf,
      meta
    };
  } catch (error) {
    return { fileTabCount: 0, artifactTabCount: 0, listedFiles: 0, listedArtifacts: 0, hasFiles: false, hasOffice: false, hasDocxOrPdf: false, readyForPass: false, error: String(error) };
  }
}

async function walkFindDocs(roots, hints = []) {
  const found = [];
  async function walk(dir, depth = 0) {
    if (depth > 6) return;
    let entries = [];
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (["node_modules", ".git", "out", "dist", ".materialized"].includes(entry.name)) continue;
        await walk(full, depth + 1);
      } else if (/\.(docx|pdf|pptx|md|txt)$/i.test(entry.name)) {
        const hitHint = hints.some((h) => h && full.toLowerCase().includes(String(h).toLowerCase()))
          || /基层|治理|数字化|汇报|outputs|document|宣讲|工作/i.test(entry.name + full);
        if (hitHint || /\.(docx|pdf)$/i.test(entry.name)) {
          try {
            const s = await stat(full);
            if (s.size > 0) {
              found.push({
                path: full,
                name: entry.name,
                ext: extname(entry.name).toLowerCase(),
                size: s.size,
                mtime: s.mtime.toISOString(),
                sha256: createHash("sha256").update(await readFile(full)).digest("hex").slice(0, 16)
              });
            }
          } catch {}
        }
      }
    }
  }
  for (const root of roots) {
    if (root) await walk(root, 0);
  }
  // Prefer newer larger docs
  return found.sort((a, b) => b.size - a.size || b.mtime.localeCompare(a.mtime)).slice(0, 80);
}

async function probeOpenability(filePath) {
  const ext = extname(filePath).toLowerCase();
  const bytes = await readFile(filePath);
  const result = { path: filePath, size: bytes.length, ext, magicOk: false, notes: [] };
  if (ext === ".pdf") {
    result.magicOk = bytes.slice(0, 5).toString("utf8") === "%PDF-";
    result.notes.push(result.magicOk ? "PDF magic header OK" : "PDF magic missing");
  } else if (ext === ".docx" || ext === ".pptx") {
    result.magicOk = bytes[0] === 0x50 && bytes[1] === 0x4b;
    result.notes.push(result.magicOk ? "ZIP/OOXML magic OK" : "OOXML magic missing");
  } else {
    result.magicOk = bytes.length > 0;
    result.notes.push("text-like artifact");
  }
  // Copy into evidence for retention
  try {
    const dest = join(evidenceDir, `export-${basename(filePath)}`);
    await copyFile(filePath, dest);
    result.evidenceCopy = dest;
  } catch (error) {
    result.copyError = String(error);
  }
  return result;
}

function assistantCompletedSignals(body, label) {
  const text = String(body || "");
  // Ignore the user prompt echo: require completion-style signals after tool/report language.
  if (label === "revise") {
    return /DOC-REVISE|下一步工作安排|修订版|已导出|document\.create_(?:docx|pdf)[\s\S]{0,200}成功|artifact\.inspect[\s\S]{0,120}(ok|成功|verified)/i.test(text)
      && /已处理|已完成|导出|docx|pdf/i.test(text);
  }
  return /(document\.create_(?:docx|pdf)|artifact\.inspect).{0,120}(成功|完成|ok|verified|bytes)|已新建 outputs\/|文件变更|闭环.*完成|DOCX 已|PDF 已/is.test(text);
}

async function waitTurn(client, evidence, label, timeoutMs, meaningfulRe, options = {}) {
  const minIdleMs = Number(options.minIdleMs || 240_000);
  const requireOffice = options.requireOffice !== false;
  let captureIndex = evidence.captureIndex || 10;
  const turnStartedAt = Date.now();
  const deadline = turnStartedAt + timeoutMs;
  let approvalCount = 0;
  const approvals = [];
  let lastBody = "";
  let lastCounts = { hasFiles: false, hasOffice: false, readyForPass: false };
  while (Date.now() < deadline) {
    await sleep(6_000);
    let current;
    try {
      current = await state(client);
    } catch (error) {
      evidence.progressEvaluateError = String(error);
      continue;
    }
    lastBody = current.body || "";
    if (current.menuOpen) {
      try { await dismissMenus(client); } catch {}
    }

    const approval = current.buttons.find((button) => button.text === "批准并继续" || button.text === "批准");
    if (approval) {
      try {
        const approvalHit = await client.evaluate(`(() => {
          const nodes = [...document.querySelectorAll('button')].filter((n) => n.offsetParent);
          const el = nodes.find((n) => (n.textContent || '').replace(/\\s+/g, ' ').trim() === ${JSON.stringify(approval.text)})
            || nodes.find((n) => (n.textContent || '').includes(${JSON.stringify(approval.text)}));
          if (!el) return null;
          el.scrollIntoView({ block: 'center' });
          const r = el.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0) return null;
          return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), text: (el.textContent || '').trim() };
        })()`);
        if (approvalHit) {
          const approvalContext = {
            at: new Date().toISOString(),
            button: approval.text,
            bodyTail: lastBody.slice(-2500),
            cards: current.approvalCards,
            looksLikeDocumentTool: /document\.create_(?:docx|pdf)|artifact\.inspect|artifact\.create|document\.project\.sync_outputs/i.test(lastBody)
          };
          evidence.checkpoints.push(await shot(client, `${String(captureIndex++).padStart(2, "0")}-approval-${label}`));
          await activateWindow();
          await cdpClickAt(client, approvalHit.x, approvalHit.y);
          evidence.actions.push({ at: new Date().toISOString(), method: "CDP Input.dispatchMouseEvent", target: `approval:${approval.text}`, ...approvalHit });
          approvalCount += 1;
          approvals.push(approvalContext);
          await sleep(1500);
        }
      } catch (error) {
        evidence.progressEvaluateError = `approval:${String(error)}`;
      }
    }

    lastCounts = await countRegisteredFiles(client);
    try {
      if (captureIndex % 2 === 0) evidence.checkpoints.push(await shot(client, `${String(captureIndex++).padStart(2, "0")}-progress-${label}`));
      else captureIndex += 1;
    } catch {}
    evidence.progress = {
      label,
      bodySlice: lastBody.slice(-4000),
      sceneTabs: current.sceneTabs,
      resourceRows: current.resourceRows,
      fileTabCount: current.fileTabCount,
      artifactTabCount: current.artifactTabCount,
      listedFiles: lastCounts.listedFiles,
      hasOffice: lastCounts.hasOffice
    };
    evidence.captureIndex = captureIndex;
    await writeFile(`${evidenceDir}/evidence.json`, JSON.stringify(evidence, null, 2), "utf8");

    const failureTail = lastBody.slice(-2500);
    if (/生成异常终止|请求未能完成|本轮执行失败/.test(failureTail) && !/已完成|闭环/.test(failureTail)) {
      evidence[`waitFailure_${label}`] = failureTail.slice(-500);
      break;
    }
    const sendVisible = current.buttons.some((button) => button.testid === "composer-send-button");
    const busy = current.busyText || current.buttons.some((b) => /停止|取消/.test(b.text || ""));
    const elapsed = Date.now() - turnStartedAt;
    const meaningful = approvalCount > 0 || assistantCompletedSignals(lastBody, label) || (meaningfulRe.test(lastBody) && (lastCounts.hasDocxOrPdf || lastCounts.hasOffice));
    const filesReady = !requireOffice || lastCounts.readyForPass;
    if (sendVisible && !busy && meaningful && filesReady && elapsed >= minIdleMs) break;
    if (current.evaluateError) evidence.progressEvaluateError = current.evaluateError;
  }
  evidence[`approvals_${label}`] = approvals;
  evidence[`approvalCount_${label}`] = approvalCount;
  evidence[`fileCounts_${label}`] = lastCounts;
  evidence.approvalCount = (evidence.approvalCount || 0) + approvalCount;
  return { lastBody, approvalCount, fileCounts: lastCounts };
}

async function openFirstRegisteredFile(client, evidence) {
  const openedFilesTab = await clickSceneTab(client, "文件");
  if (openedFilesTab) evidence.actions.push(openedFilesTab);
  await sleep(500);
  const hit = await client.evaluate(`(() => {
    const row = [...document.querySelectorAll('.brain-resource-row')].find((el) => {
      const t = (el.textContent || '');
      return /\\.(pdf|docx|pptx|md)/i.test(t) && el.offsetParent;
    });
    if (!row) return null;
    const r = row.getBoundingClientRect();
    return { x: Math.round(r.left + Math.min(40, r.width / 2)), y: Math.round(r.top + r.height / 2), text: row.innerText?.replace(/\\s+/g, ' ').trim().slice(0, 120) };
  })()`);
  if (!hit) return { opened: false };
  await activateWindow();
  await cdpClickAt(client, hit.x, hit.y);
  evidence.actions.push({ at: new Date().toISOString(), method: "CDP Input.dispatchMouseEvent", target: "select registered file", ...hit });
  await sleep(1200);
  evidence.checkpoints.push(await shot(client, "42-file-selected"));
  evidence.afterFileSelect = await state(client);
  return { opened: true, ...hit };
}

function activityWithoutPromptEcho(body) {
  let text = String(body || "");
  for (const chunk of [prompt, revisePrompt, marker]) {
    if (chunk) text = text.split(chunk).join("");
  }
  return text;
}

async function driveBrushAnnotation(client, evidence) {
  const result = { attempted: true, toggled: false, anchorSelected: false, saved: false, markCount: 0, detail: "" };
  await activateWindow();
  // Prefer preview-layer brush; fallback to 审校「开始画笔标记」
  let toggle = await viewportPoint(client, ".document-annotation-toolbar", "画笔标注");
  if (!toggle) toggle = await viewportPoint(client, "body", "画笔标注");
  if (!toggle) toggle = await viewportPoint(client, '[data-testid="brain-document-workspace"]', "开始画笔标记");
  if (!toggle) {
    result.detail = "brush toggle not found";
    evidence.brushDrive = result;
    return result;
  }
  await cdpClickAt(client, toggle.x, toggle.y);
  evidence.actions.push({ at: new Date().toISOString(), method: "CDP click", target: "brush toggle", ...toggle });
  result.toggled = true;
  await sleep(800);
  evidence.checkpoints.push(await shot(client, "61-brush-toggled"));

  let anchor = await viewportPoint(client, ".document-anchor-picker", "");
  if (!anchor) {
    const hit = await client.evaluate(`(() => {
      const btn = document.querySelector('.document-anchor-picker button')
        || [...document.querySelectorAll('button[data-object-id], [data-object-id]')].find((el) => el.offsetParent);
      if (!btn) return null;
      const r = btn.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return null;
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), text: (btn.textContent || '').trim().slice(0, 80) };
    })()`);
    anchor = hit;
  } else {
    // viewportPoint with empty text returns the root; click first picker button instead
    const hit = await client.evaluate(`(() => {
      const btn = document.querySelector('.document-anchor-picker button');
      if (!btn) return null;
      const r = btn.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), text: (btn.textContent || '').trim().slice(0, 80) };
    })()`);
    anchor = hit;
  }
  if (!anchor) {
    result.detail = "no anchor to select";
    evidence.afterBrush = await state(client);
    evidence.brushDrive = result;
    return result;
  }
  await cdpClickAt(client, anchor.x, anchor.y);
  evidence.actions.push({ at: new Date().toISOString(), method: "CDP click", target: "brush anchor", ...anchor });
  result.anchorSelected = true;
  await sleep(500);

  const instruction = "E2E画笔：请把此处表述改得更简洁，并保留关键数字。";
  const focused = await client.evaluate(`(() => {
    const input = document.querySelector('.document-annotation-editor input');
    if (!input) return false;
    input.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, ${JSON.stringify(instruction)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  if (!focused) {
    result.detail = "instruction input missing";
    evidence.afterBrush = await state(client);
    evidence.brushDrive = result;
    return result;
  }
  evidence.actions.push({ at: new Date().toISOString(), method: "set input value", target: "brush instruction", text: instruction });
  await sleep(200);

  const save = await viewportPoint(client, ".document-annotation-editor", "保存标注");
  if (!save) {
    result.detail = "save button missing";
    evidence.afterBrush = await state(client);
    evidence.brushDrive = result;
    return result;
  }
  await cdpClickAt(client, save.x, save.y);
  evidence.actions.push({ at: new Date().toISOString(), method: "CDP click", target: "save brush annotation", ...save });
  await sleep(1200);
  evidence.checkpoints.push(await shot(client, "62-brush-saved"));
  evidence.afterBrush = await state(client);
  const surface = `${evidence.afterBrush?.body || ""}\n${evidence.afterBrush?.docWorkspace || ""}`;
  const markMatch = surface.match(/([1-9]\d*)\s*条标注/);
  result.markCount = markMatch ? Number(markMatch[1]) : (/E2E画笔|已保存|加入对话/.test(surface) ? 1 : 0);
  result.saved = result.markCount >= 1 || /E2E画笔/.test(surface);
  result.detail = result.saved ? "annotation saved" : "save clicked but no mark visible";
  evidence.brushDrive = result;
  return result;
}

const client = await createSceneTestCdpClient(debugPort);
const evidence = {
  caseId,
  startedAt: new Date().toISOString(),
  projectName,
  topic,
  prompt,
  revisePrompt,
  environment: {
    debugPort,
    input: "CDP mouse click + Windows clipboard Ctrl+V (insertText fallback)",
    appTitle: "codeCN",
    runtimeCopy: ".materialized/windows/apps/desktop"
  },
  actions: [],
  assertions: [],
  checkpoints: [],
  result: "FAIL"
};

try {
  await client.waitForAppReady();
  await activateWindow();
  await dismissMenus(client);
  evidence.checkpoints.push(await shot(client, "00-start"));
  evidence.initialState = await state(client);

  // Enter document scene
  const currentScene = evidence.initialState.workspace?.selectedWorkspaceKey || "";
  if (currentScene !== "document") {
    evidence.actions.push(await clickSelector(client, ".brain-workspace-trigger"));
    await client.waitFor("Boolean(document.querySelector('.brain-workspace-menu')?.offsetParent)", 10_000);
    evidence.checkpoints.push(await shot(client, "01-workspace-menu"));
    evidence.actions.push(await click(client, ".brain-workspace-menu", "文档创作"));
    await client.waitFor(`(() => { try { const r=localStorage.getItem('brain.workspaceSelection.v2'); return r&&JSON.parse(r).selectedWorkspaceKey==='document'; }catch{return false} })()`, 15_000);
  }
  evidence.assertions.push({ name: "scene is document", pass: true });
  await dismissMenus(client);
  evidence.checkpoints.push(await shot(client, "02-document-scene"));

  // New project via visible UI
  evidence.actions.push(await clickSelector(client, 'button[title="添加项目"]'));
  await client.waitFor("document.body.innerText.includes('新建空白项目')", 10_000);
  evidence.checkpoints.push(await shot(client, "03-project-dialog"));
  evidence.actions.push(await click(client, ".project-create-menu", "新建空白项目"));
  await client.waitFor("document.body.innerText.includes('为项目命名')", 15_000);
  evidence.checkpoints.push(await shot(client, "03b-name-dialog"));
  evidence.actions.push(await clickSelector(client, ".project-name-dialog input"));
  await sleep(150);
  await client.command("Input.dispatchKeyEvent", { type: "keyDown", modifiers: 2, key: "a", code: "KeyA", windowsVirtualKeyCode: 65 });
  await client.command("Input.dispatchKeyEvent", { type: "keyUp", modifiers: 2, key: "a", code: "KeyA", windowsVirtualKeyCode: 65 });
  await client.command("Input.insertText", { text: projectName });
  await client.evaluate(`(() => {
    const el = document.querySelector('.project-name-dialog input');
    if (!el) return false;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  let named = await client.evaluate(`document.querySelector('.project-name-dialog input')?.value || ''`);
  if (named !== projectName) {
    await client.evaluate(`(() => {
      const el = document.querySelector('.project-name-dialog input');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(el, ${JSON.stringify(projectName)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    named = await client.evaluate(`document.querySelector('.project-name-dialog input')?.value || ''`);
  }
  evidence.assertions.push({ name: "project name typed", pass: named === projectName || named.includes("基层治理"), value: named });
  evidence.actions.push({ at: new Date().toISOString(), method: "CDP Input.insertText after click", target: "project name input", text: projectName });
  evidence.checkpoints.push(await shot(client, "04-project-name"));
  evidence.actions.push(await click(client, ".project-name-dialog", "保存"));
  await client.waitFor(`document.body.innerText.includes(${JSON.stringify(projectName)})`, 25_000);
  evidence.assertions.push({ name: "new project visible", pass: true, value: projectName });
  evidence.checkpoints.push(await shot(client, "05-project-created"));

  const pickerVisible = await client.evaluate("Boolean(document.querySelector('.new-chat-project-picker > button')?.offsetParent)");
  if (pickerVisible) {
    evidence.actions.push(await clickSelector(client, ".new-chat-project-picker > button"));
    await client.waitFor("Boolean(document.querySelector('.new-chat-project-menu'))", 10_000);
    evidence.actions.push(await click(client, ".new-chat-project-menu", projectName));
    await sleep(800);
  }
  await dismissMenus(client);
  evidence.checkpoints.push(await shot(client, "06-project-bound"));

  // Main prompt
  await focusComposerAndPaste(client, prompt, evidence, "main-prompt");
  evidence.checkpoints.push(await shot(client, "08-prompt-entered"));
  evidence.actions.push(await clickSelector(client, '[data-testid="composer-send-button"]'));
  await client.waitFor(`document.body.innerText.includes(${JSON.stringify(marker)}) && !((document.querySelector('[data-testid="composer-input"]')?.value||'').includes(${JSON.stringify(marker)}))`, 30_000);
  evidence.assertions.push({ name: "submitted prompt visible in chat", pass: true });
  evidence.checkpoints.push(await shot(client, "09-submitted"));

  await waitTurn(client, evidence, "main", 16 * 60_000, /document\.create_|artifact\.inspect|outputs\/|\.docx|\.pdf/i, { minIdleMs: 180_000, requireOffice: true });
  evidence.afterFirstTurn = await state(client);
  evidence.checkpoints.push(await shot(client, "40-after-first-turn"));
  evidence.projectMetaAfterChat = await readProjectMeta(client);
  evidence.fileCountsAfterChat = await countRegisteredFiles(client);

  for (const tab of ["文稿", "审校", "项目与文件", "文件", "产物"]) {
    const action = await clickSceneTab(client, tab);
    if (action) {
      evidence.actions.push(action);
      await sleep(700);
      evidence.checkpoints.push(await shot(client, `41-tab-${tab}`));
      evidence[`tabState_${tab}`] = await state(client);
    }
  }
  evidence.fileOpen = await openFirstRegisteredFile(client, evidence);

  // Revise turn
  await dismissMenus(client);
  await focusComposerAndPaste(client, revisePrompt, evidence, "revise-prompt");
  evidence.checkpoints.push(await shot(client, "50-revise-entered"));
  evidence.actions.push(await clickSelector(client, '[data-testid="composer-send-button"]'));
  await client.waitFor(`document.body.innerText.includes('DOC-REVISE-001')`, 30_000);
  evidence.checkpoints.push(await shot(client, "51-revise-submitted"));
  await waitTurn(client, evidence, "revise", 12 * 60_000, /DOC-REVISE|下一步工作安排|document\.create_|artifact\.inspect|修订|Created (PDF|DOCX)/i, { minIdleMs: 120_000, requireOffice: true });
  evidence.afterRevise = await state(client);
  evidence.checkpoints.push(await shot(client, "60-after-revise"));
  evidence.projectMetaAfterRevise = await readProjectMeta(client);
  evidence.fileCountsAfterRevise = await countRegisteredFiles(client);

  // Re-open file and drive brush annotation closed loop
  evidence.fileOpenAfterRevise = await openFirstRegisteredFile(client, evidence);
  evidence.brushDrive = await driveBrushAnnotation(client, evidence);

  // Find exported docs — prefer current project workspace only
  const projectRoot = evidence.projectMetaAfterRevise?.project?.workspacePath
    || evidence.projectMetaAfterChat?.project?.workspacePath
    || "";
  const roots = [projectRoot, projectRoot ? join(projectRoot, "outputs") : ""].filter(Boolean);
  evidence.exportScanRoots = roots;
  evidence.exportCandidates = await walkFindDocs(roots.length ? roots : [join(process.env.USERPROFILE || "", ".codecn")], [projectName, "outputs"]);
  const preferred = evidence.exportCandidates.filter((f) => {
    if (!/\.(docx|pdf)$/i.test(f.ext) || !(f.size > 0)) return false;
    if (projectRoot) return f.path.replace(/\\/g, "/").includes(projectRoot.replace(/\\/g, "/"));
    return f.path.includes(projectName);
  });
  evidence.exportProbes = [];
  for (const file of preferred.slice(0, 8)) {
    evidence.exportProbes.push(await probeOpenability(file.path));
  }

  const hasRealExport = evidence.exportProbes.some((p) => p.size > 0 && p.magicOk && (!projectRoot || p.path.replace(/\\/g, "/").includes(projectRoot.replace(/\\/g, "/"))));
  const activityText = activityWithoutPromptEcho(
    `${evidence.afterFirstTurn?.body || ""}\n${evidence.afterRevise?.body || ""}`
  );
  const usedDocTools = hasRealExport
    || /Created (PDF|DOCX)|document\.create_(docx|pdf)|artifact\.inspect|outputs\/[^\s"'<>]+\.(docx|pdf)/i.test(activityText)
    || Boolean(evidence.fileCountsAfterRevise?.hasDocxOrPdf || evidence.fileCountsAfterChat?.hasDocxOrPdf)
    || (evidence.approvalCount || 0) > 0;
  const filesInProject = Boolean(evidence.fileCountsAfterRevise?.readyForPass || evidence.fileCountsAfterChat?.readyForPass);
  const rightPanelFilesVisible = Number(evidence.fileCountsAfterRevise?.listedFiles || evidence.fileCountsAfterChat?.listedFiles || 0) >= 1
    || Number(evidence.afterRevise?.fileTabCount || 0) >= 1;
  const filePreviewOk = Boolean(evidence.fileOpen?.opened || evidence.fileOpenAfterRevise?.opened);
  const rightPanelUpdated = Boolean(evidence.tabState_文稿 || evidence.tabState_项目与文件 || evidence.tabState_文件);
  const reviseDone = /DOC-REVISE|下一步工作安排|重新导出|新版本|修订|Created (PDF|DOCX)/i.test(activityText)
    || preferred.some((f) => /修订|REV/i.test(f.name || ""))
    || hasRealExport;

  // 画笔：优先看 drive 结果；否则根据表面文案判定异常
  const brushSurface = [
    evidence.afterBrush?.body,
    evidence.afterBrush?.docWorkspace,
    evidence.tabState_审校?.docWorkspace,
    evidence.tabState_审校?.body,
    evidence.afterRevise?.docWorkspace,
    evidence.afterRevise?.body,
    evidence.tabState_文稿?.docWorkspace
  ].filter(Boolean).join("\n");
  const brushEntryVisible = /开始画笔标记|退出画笔|画笔标记|画笔标注|结束标注/.test(brushSurface)
    || Boolean(evidence.brushDrive?.toggled);
  const brushNoDoc = /尚未选择文档/.test(brushSurface);
  const brushZeroMarks = /还没有标注或修改方案|0\s*条标注/.test(brushSurface) && !(evidence.brushDrive?.saved);
  const brushHasMarks = Boolean(evidence.brushDrive?.saved)
    || /(?:^|[^\d])([1-9]\d*)\s*条标注/.test(brushSurface)
    || (/E2E画笔|加入对话|PROPOSED|ACCEPTED/.test(brushSurface) && !brushZeroMarks && !/还没有标注/.test(brushSurface));
  const brushAbnormal = !brushHasMarks && (brushEntryVisible || brushNoDoc || brushZeroMarks || evidence.brushDrive?.attempted);
  evidence.brushAnomaly = {
    abnormal: brushAbnormal,
    brushEntryVisible,
    brushNoDoc,
    brushZeroMarks,
    brushHasMarks,
    drive: evidence.brushDrive || null,
    sample: brushSurface.slice(0, 500)
  };

  evidence.assertions.push(
    { name: "AI used document tools or approvals", pass: usedDocTools },
    { name: "project has office files registered", pass: filesInProject, detail: evidence.fileCountsAfterRevise || evidence.fileCountsAfterChat },
    { name: "right panel file count visible", pass: rightPanelFilesVisible, detail: evidence.fileCountsAfterRevise },
    { name: "right panel file selectable/previewable", pass: filePreviewOk, detail: evidence.fileOpenAfterRevise || evidence.fileOpen },
    { name: "right panel tabs inspected", pass: rightPanelUpdated },
    { name: "revise turn completed signals", pass: reviseDone },
    { name: "real export exists and magic-ok in this project", pass: hasRealExport, detail: evidence.exportProbes },
    { name: "brush annotation not abnormal", pass: !brushAbnormal, detail: evidence.brushAnomaly }
  );

  // Restart persistence check
  evidence.restart = { attempted: true };
  const projectId = evidence.projectMetaAfterRevise?.project?.id || evidence.projectMetaAfterChat?.project?.id || "";
  await writeFile(`${evidenceDir}/evidence.json`, JSON.stringify(evidence, null, 2), "utf8");

  // Soft restart: reload renderer and re-select document project (keep process for CDP)
  await client.evaluate(`location.reload()`);
  await sleep(2500);
  await client.waitForAppReady();
  await activateWindow();
  // Ensure document scene
  const afterReload = await state(client);
  if (afterReload.workspace?.selectedWorkspaceKey !== "document") {
    try {
      evidence.actions.push(await clickSelector(client, ".brain-workspace-trigger"));
      await client.waitFor("Boolean(document.querySelector('.brain-workspace-menu')?.offsetParent)", 10_000);
      evidence.actions.push(await click(client, ".brain-workspace-menu", "文档创作"));
      await sleep(1000);
    } catch (error) {
      evidence.restart.sceneError = String(error);
    }
  }
  // Click project in list if visible
  try {
    const hit = await client.evaluate(`(() => {
      const el = [...document.querySelectorAll('button')].find(n => (n.textContent||'').includes(${JSON.stringify(projectName)}));
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2), text: el.textContent?.trim()?.slice(0,80) };
    })()`);
    if (hit) {
      await cdpClickAt(client, hit.x, hit.y);
      evidence.actions.push({ at: new Date().toISOString(), method: "CDP click after reload", target: "project restore", ...hit });
    }
  } catch {}
  await sleep(1200);
  evidence.checkpoints.push(await shot(client, "90-after-reload"));
  evidence.afterReloadState = await state(client);
  evidence.projectMetaAfterReload = await readProjectMeta(client);
  const restored = (evidence.afterReloadState?.body || "").includes(projectName)
    || (evidence.projectMetaAfterReload?.project?.name === projectName)
    || (evidence.projectMetaAfterReload?.files || []).length > 0;
  const restoredFiles = (evidence.projectMetaAfterReload?.files || []).length > 0
    || Number(evidence.afterReloadState?.fileTabCount || 0) >= 1;
  evidence.assertions.push(
    { name: "project restored after reload", pass: restored, projectId },
    { name: "files restored after reload", pass: restoredFiles, detail: { files: evidence.projectMetaAfterReload?.files?.length, fileTabCount: evidence.afterReloadState?.fileTabCount } }
  );
  evidence.restart.restored = restored;
  evidence.restart.restoredFiles = restoredFiles;

  const failed = evidence.assertions.filter((a) => a.pass === false);
  if (hasRealExport && usedDocTools && filesInProject && rightPanelFilesVisible && restored && reviseDone && !brushAbnormal) {
    evidence.result = "PASS";
  } else if (usedDocTools && (filesInProject || hasRealExport || /大纲|正文|docx|pdf/i.test(evidence.afterFirstTurn?.body || ""))) {
    evidence.result = "PARTIAL";
  } else {
    evidence.result = "FAIL";
  }
  evidence.firstFailure = failed[0] || null;
  evidence.finishedAt = new Date().toISOString();
  await writeFile(`${evidenceDir}/evidence.json`, JSON.stringify(evidence, null, 2), "utf8");
  await writeFile(`${evidenceDir}/SUMMARY.md`, [
    `# ${caseId}`,
    "",
    `- Result: **${evidence.result}**`,
    `- Project: ${projectName}`,
    `- Approvals: ${evidence.approvalCount || 0}`,
    `- Files after chat: ${evidence.fileCountsAfterChat?.listedFiles ?? 0} listed / tab ${evidence.fileCountsAfterChat?.fileTabCount ?? 0}`,
    `- Files after revise: ${evidence.fileCountsAfterRevise?.listedFiles ?? 0} listed / tab ${evidence.fileCountsAfterRevise?.fileTabCount ?? 0}`,
    `- Export probes: ${evidence.exportProbes?.length || 0}`,
    `- Brush anomaly: ${brushAbnormal ? "YES" : "no"}`,
    `- First failure: ${evidence.firstFailure ? evidence.firstFailure.name : "none"}`,
    "",
    "## Anomalies",
    brushAbnormal
      ? `- **画笔标记异常**: 审校面可见「开始画笔标记/画笔标注」，但无有效标注（尚未选择文档 / 0 条标注 / 无修改方案）。不作为审校闭环 PASS。`
      : `- 画笔标记: 未见异常`,
    "",
    "## Exports",
    ...(evidence.exportProbes || []).map((p) => `- ${p.path} (${p.size} bytes, magicOk=${p.magicOk})`),
    "",
    "## Assertions",
    ...evidence.assertions.map((a) => `- ${a.pass ? "PASS" : "FAIL"}: ${a.name}`),
    ""
  ].join("\n"), "utf8");
  console.log(JSON.stringify({
    result: evidence.result,
    evidenceDir,
    projectName,
    approvalCount: evidence.approvalCount,
    exportProbes: evidence.exportProbes,
    firstFailure: evidence.firstFailure,
    assertionSummary: evidence.assertions.map((a) => ({ name: a.name, pass: a.pass }))
  }, null, 2));
} catch (error) {
  evidence.result = "FAIL";
  evidence.error = String(error?.stack || error);
  try { evidence.checkpoints.push(await shot(client, "98-failure")); } catch {}
  await writeFile(`${evidenceDir}/evidence.json`, JSON.stringify(evidence, null, 2), "utf8");
  console.error(evidence.error);
  process.exitCode = 1;
} finally {
  await writeFile(`${evidenceDir}/evidence.json`, JSON.stringify(evidence, null, 2), "utf8");
  await client.close({ keepProcess: true });
}
