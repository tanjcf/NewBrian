import { createRequire } from "node:module";
import { readdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
const require = createRequire(import.meta.url);
const base = resolve(".materialized/windows/node_modules/.pnpm");
const name = (await readdir(base)).find(n => n.startsWith("esbuild@"));
const { build } = require(join(base, name, "node_modules/esbuild"));
const output = await mkdtemp(join(tmpdir(), "brain-voice-tests-"));
for (const [i, entry] of ["shared/apps/desktop/src/main/minimax-tts-gateway.test.ts", "shared/apps/desktop/src/main/video-voice-casting-service.test.ts", "shared/apps/desktop/src/renderer/app/video-voice-audio.test.ts", ".materialized/windows/apps/desktop/src/main/novel-tts-voice-lock.test.ts"].entries()) {
  const outfile = join(output, `${i}.mjs`);
  await build({ entryPoints: [entry], outfile, bundle: true, platform: "node", format: "esm" });
  const result = spawnSync(process.execPath, ["--test", outfile], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status || 1);
}
