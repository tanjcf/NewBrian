import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";

const ff = realpathSync("C:/Users/Administrator/AppData/Local/Microsoft/WinGet/Links/ffmpeg.exe");

async function trial(label, vf) {
  const out = `I:/py_workerposse/aigc/exports/dt-${label}.mp4`;
  const args = ["-y", "-f", "lavfi", "-i", "color=c=black:s=640x360:d=1", "-vf", vf, "-frames:v", "30", out];
  const p = spawn(ff, args, { cwd: "I:/py_workerposse/aigc", windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
  let err = "";
  p.stderr.on("data", (c) => { err += c; });
  const code = await new Promise((r) => p.on("close", r));
  const hit = err.match(/Error[^\r\n]{0,120}|Conversion failed|Invalid argument/)?.[0] || (code === 0 ? "OK" : `exit=${code}`);
  console.log(label, hit);
}

// In JS source, "C\\:/" becomes the two chars \ : in the actual string passed to ffmpeg.
await trial("simple", "drawtext=fontfile=C\\:/Windows/Fonts/arial.ttf:text=hi:fontsize=24:fontcolor=white:x=10:y=10");
await trial("quotedtext", "drawtext=fontfile=C\\:/Windows/Fonts/arial.ttf:text='dome':fontsize=24:fontcolor=0xffffff:x=10:y=10");
await trial("enable", "drawtext=fontfile=C\\:/Windows/Fonts/arial.ttf:text='dome':fontsize=24:fontcolor=white:x=10:y=10:enable=between(t\\,0\\,1)");
await trial("exprxy", "drawtext=fontfile=C\\:/Windows/Fonts/arial.ttf:text='dome':fontsize=24:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2");
await trial("full", "drawtext=fontfile=C\\:/Windows/Fonts/arial.ttf:text='dome':fontsize=26:fontcolor=0xffffff:x=(w-text_w)*0.3672:y=(h-text_h)*0.8143:box=1:boxcolor=black@0.35:boxborderw=12:enable=between(t\\,0.000\\,17.440)");
await trial("noenable", "drawtext=fontfile=C\\:/Windows/Fonts/arial.ttf:text='dome':fontsize=26:fontcolor=0xffffff:x=(w-text_w)*0.3672:y=(h-text_h)*0.8143:box=1:boxcolor=black@0.35:boxborderw=12");
