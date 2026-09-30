import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const args = Object.fromEntries(process.argv.slice(2).map(arg => { const offset = arg.indexOf("="); return [arg.slice(0, offset), arg.slice(offset + 1)]; }));
const cli = args["--cli"] || "codex";
const version = execFileSync(cli, ["--version"], { encoding: "utf8", windowsHide: true }).trim();
const gateway = new URL(args["--gateway"] || "http://203.0.113.10:8790/v1");
let apiKey = process.env.NEWBRAIN_CODEX_API_KEY || "";
if (!apiKey && args["--auth-file"]) apiKey = JSON.parse(await readFile(args["--auth-file"], "utf8")).access_token || "";
if (!apiKey) {
  console.log(JSON.stringify({ cli: version, compatible: false, status: "NOT_VERIFIED", reason: "NEWBRAIN_CODEX_API_KEY_REQUIRED" }));
  process.exitCode = 2;
} else {
  const source = args["--sdk-source"];
  if (!source) throw new Error("--sdk-source is required");
  const temporary = await mkdtemp(join(tmpdir(), "brain-codex-gateway-"));
  const require = createRequire(import.meta.url);
  const esbuild = require(resolve(".materialized/windows/node_modules/.pnpm/esbuild@0.25.12/node_modules/esbuild"));
  const sdkPath = join(temporary, "sdk.mjs");
  await esbuild.build({ entryPoints: [resolve(source, "src/index.ts")], outfile: sdkPath, bundle: true, platform: "node", format: "esm", target: "node20" });
  const { Codex } = await import(pathToFileURL(sdkPath).href);
  const client = new Codex({ codexPathOverride: cli, apiKey, baseUrl: gateway.href.replace(/\/$/, ""),
    env: { ...process.env, CODEX_HOME: temporary }, config: { model_provider: "spring", model_providers: {
      spring: { name: "Spring test", base_url: gateway.href.replace(/\/$/, ""), env_key: "CODEX_API_KEY", wire_api: "responses" }
    } }
  });
  try {
    const result = await client.startThread({ model: args["--model"] || "auto", workingDirectory: temporary,
      skipGitRepoCheck: true, sandboxMode: "read-only", approvalPolicy: "never", webSearchMode: "disabled" })
      .run("Reply with exactly BRAIN_CODEX_GATEWAY_OK. Do not call tools or access files.", { signal: AbortSignal.timeout(60_000) });
    console.log(JSON.stringify({ cli: version, compatible: result.finalResponse.trim() === "BRAIN_CODEX_GATEWAY_OK", status: "COMPLETED", usage: result.usage }));
  } catch (error) {
    const detail = String(error).replaceAll(apiKey, "[REDACTED]").slice(0, 1000);
    console.log(JSON.stringify({ cli: version, compatible: false, status: "FAILED", detail }));
    process.exitCode = 1;
  }
}
