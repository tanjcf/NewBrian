/**
 * Read-only / light CDP acceptance probes for video pipeline (mute / 本镜 / link / envelope).
 * Connects to already-running Electron (default CDP 9555). Does not kill the app.
 */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const debugPort = Number(process.env.CODECN_E2E_REMOTE_DEBUG_PORT || 9555);
const pipelinePath =
  process.env.BRAIN_PIPELINE_EDITOR_JSON ||
  "I:/py_workerposse/aigc/.brain-video/pipeline-editor.json";

const report = {
  startedAt: new Date().toISOString(),
  debugPort,
  items: []
};

function record(id, item, result, evidence) {
  report.items.push({ id, item, result, evidence });
  console.log(`[${result}] #${id} ${item} — ${evidence}`);
}

const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
const page = pages.find((p) => p.type === "page" && p.webSocketDebuggerUrl);
assert.ok(page, "No Electron page on CDP");
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let nextId = 0;
function command(method, params = {}, timeoutMs = 30_000) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${method} timed out`)), timeoutMs);
    const listener = (event) => {
      const payload = JSON.parse(event.data);
      if (payload.id !== id) return;
      clearTimeout(timeout);
      socket.removeEventListener("message", listener);
      if (payload.error || payload.result?.exceptionDetails) {
        reject(
          new Error(
            payload.error?.message ||
              payload.result?.exceptionDetails?.exception?.description ||
              payload.result?.exceptionDetails?.text ||
              "cdp error"
          )
        );
      } else resolve(payload.result);
    };
    socket.addEventListener("message", listener);
    socket.send(JSON.stringify({ id, method, params }));
  });
}

const evaluate = async (expression) =>
  (await command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.value;

try {
  const pipeline = JSON.parse(readFileSync(pipelinePath, "utf8"));
  const clips = Array.isArray(pipeline.clipInstances) ? pipeline.clipInstances : [];
  record(
    "P1",
    "clipInstances persistence",
    clips.length > 0 ? "PASS" : "FAIL",
    `count=${clips.length} path=${pipelinePath}`
  );

  const linked = clips.filter((c) => c.linkGroupId);
  const peelGroups = new Map();
  for (const c of linked) {
    const g = String(c.linkGroupId);
    if (!peelGroups.has(g)) peelGroups.set(g, []);
    peelGroups.get(g).push(`${c.kind}:${c.trackId}`);
  }
  const peelOk = [...peelGroups.entries()].some(
    ([id, members]) =>
      id.startsWith("peel-") &&
      members.includes("video:v1") &&
      members.some((m) => m.startsWith("audio:a2"))
  );
  record(
    "P2",
    "linkGroupId V↔A2 peel pairs",
    peelOk ? "PASS" : linked.length ? "FAIL" : "SKIP",
    `linked=${linked.length} peelGroups=${JSON.stringify(Object.fromEntries(peelGroups))}`
  );

  const a2Peels = clips.filter(
    (c) => c.kind === "audio" && String(c.trackId) === "a2" && String(c.id).includes("peel")
  );
  const badZero = a2Peels.filter((c) => {
    const kfs = Array.isArray(c.volumeKeyframes) ? c.volumeKeyframes : [];
    return kfs.length > 0 && kfs.every((k) => Number(k.v) === 0);
  });
  record(
    "P3",
    "A2 peel volume keyframes not all-zero",
    a2Peels.length === 0 ? "SKIP" : badZero.length === 0 ? "PASS" : "FAIL",
    `a2Peels=${a2Peels.length} allZero=${badZero.length} sample=${JSON.stringify(a2Peels[0]?.volumeKeyframes || null)}`
  );
} catch (err) {
  record("P1", "clipInstances persistence", "FAIL", String(err));
}

{
  const envelopeMod = join(
    __dirname,
    ".materialized/windows/apps/desktop/src/shared/video-volume-envelope.ts"
  );
  const healProbe = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--input-type=module",
      "-e",
      `import { healAllZeroVolumeEnvelope } from ${JSON.stringify(envelopeMod.replaceAll("\\", "/"))};
       const healed = healAllZeroVolumeEnvelope([{ t: 0, v: 0 }, { t: 1, v: 0 }]);
       console.log(JSON.stringify(healed));`
    ],
    { encoding: "utf8" }
  );
  let healOk = false;
  let healOut = (healProbe.stdout || "").trim() || (healProbe.stderr || "").trim();
  try {
    const healed = JSON.parse((healProbe.stdout || "").trim());
    healOk = Array.isArray(healed) && healed.every((k) => Number(k.v) === 1);
    healOut = JSON.stringify(healed);
  } catch {
    healOk = false;
  }
  record("U-heal", "envelope heal all-zero → 100%", healOk ? "PASS" : "FAIL", healOut);
}

const ui = await evaluate(`(() => {
  const text = document.body?.innerText || "";
  const q = (sel) => document.querySelector(sel);
  const qa = (sel) => [...document.querySelectorAll(sel)];
  const byText = (label) => [...document.querySelectorAll("button,[role=button],a,div,span")]
    .find((el) => (el.textContent || "").trim() === label);
  const muteButtons = qa("button").filter((b) =>
    /^M$/.test((b.textContent || "").trim()) ||
    (b.getAttribute("title") || "").includes("静音") ||
    (b.getAttribute("aria-label") || "").includes("静音")
  );
  const mutePressed = muteButtons.map((b) => ({
    text: (b.textContent || "").trim().slice(0, 8),
    pressed: b.getAttribute("aria-pressed") || b.className,
    title: b.getAttribute("title") || ""
  }));
  const linkedClips = qa(".brain-video-nle__clip--linked, [data-link-group-id]");
  const shotMode = byText("本镜") || byText("本镜预览");
  const seqMode = byText("全片序列");
  const tracksTab = byText("本镜音视频轨");
  const videoScene = /视频制作|本镜音视频|分镜|脚本/.test(text);
  const envelope = q("[data-testid='brain-video-volume-envelope']");
  return {
    videoScene,
    hasTracksTab: Boolean(tracksTab),
    hasShotMode: Boolean(shotMode),
    hasSeqMode: Boolean(seqMode),
    muteButtonCount: muteButtons.length,
    mutePressed,
    linkedClipCount: linkedClips.length,
    hasEnvelopeEditor: Boolean(envelope),
    title: document.title,
    previewHint: /本镜|全片序列/.test(text),
    bodySnippet: text.replace(/\\s+/g, " ").slice(0, 240)
  };
})()`);

if (!ui) {
  record("CDP", "Electron UI probe", "FAIL", "evaluate returned null");
} else {
  record(
    "CDP-ui",
    "Video UI reachable (scene/tabs)",
    ui.videoScene || ui.hasTracksTab ? "PASS" : "SKIP",
    JSON.stringify({
      videoScene: ui.videoScene,
      hasTracksTab: ui.hasTracksTab,
      hasShotMode: ui.hasShotMode,
      hasSeqMode: ui.hasSeqMode,
      title: ui.title,
      snippet: ui.bodySnippet
    })
  );

  if (ui.muteButtonCount >= 2) {
    record(
      "F-mute-dom",
      "Mute controls present per track (DOM)",
      "PASS",
      `muteButtons=${ui.muteButtonCount} sample=${JSON.stringify(ui.mutePressed.slice(0, 4))}`
    );
  } else {
    record(
      "F-mute-dom",
      "Mute controls present per track (DOM)",
      "SKIP",
      `muteButtons=${ui.muteButtonCount}; open 本镜音视频轨 first`
    );
  }

  record(
    "E-link-dom",
    "Linked clips visible (DOM)",
    ui.linkedClipCount > 0 ? "PASS" : "SKIP",
    `linkedClipCount=${ui.linkedClipCount}`
  );

  record(
    "D-filter",
    "本镜/全片 mode controls present",
    ui.hasShotMode || ui.hasSeqMode || ui.previewHint ? "PASS" : "SKIP",
    JSON.stringify({ hasShotMode: ui.hasShotMode, hasSeqMode: ui.hasSeqMode })
  );
}

const interact = await evaluate(`(() => {
  const lanes = [...document.querySelectorAll(".brain-video-nle__lane, .brain-video-nle__track-header, [data-lane-id]")];
  const findMute = (laneLabel) => {
    const lane = lanes.find((el) => (el.textContent || "").includes(laneLabel));
    if (!lane) return null;
    return [...lane.querySelectorAll("button")].find((b) => /^M$/.test((b.textContent || "").trim()));
  };
  const a1 = findMute("A1");
  const a2 = findMute("A2");
  if (!a1 || !a2) return { ok: false, reason: "A1/A2 mute buttons not found", laneCount: lanes.length };
  const snap = (b) => ({
    className: b.className,
    aria: b.getAttribute("aria-pressed"),
    text: (b.textContent || "").trim()
  });
  const before = { a1: snap(a1), a2: snap(a2) };
  a1.click();
  const after = { a1: snap(a1), a2: snap(a2) };
  a1.click();
  const restored = { a1: snap(a1), a2: snap(a2) };
  const a2Unchanged = before.a2.className === after.a2.className && before.a2.aria === after.a2.aria;
  const a1Changed = before.a1.className !== after.a1.className || before.a1.aria !== after.a1.aria;
  return { ok: true, a2Unchanged, a1Changed, before, after, restored };
})()`);

if (interact?.ok) {
  record(
    "F24",
    "Mute isolation click A1 does not change A2 (CDP)",
    interact.a2Unchanged ? "PASS" : "FAIL",
    JSON.stringify(interact)
  );
} else {
  record("F24", "Mute isolation click A1 does not change A2 (CDP)", "SKIP", JSON.stringify(interact));
}

socket.close();
const out = join(__dirname, "tmp-video-acceptance-cdp-report.json");
writeFileSync(out, JSON.stringify(report, null, 2));
console.log("Wrote", out);
const failed = report.items.filter((i) => i.result === "FAIL");
process.exit(failed.length ? 1 : 0);
