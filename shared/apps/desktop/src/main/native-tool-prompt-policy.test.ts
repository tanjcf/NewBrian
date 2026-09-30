import assert from "node:assert/strict";
import test from "node:test";

const { buildNativeToolSystemInstruction, requestedArtifactSatisfied } = await import(
  new URL("./native-tool-prompt-policy.ts", import.meta.url).href
);

test("uses platform-specific shell guidance", () => {
  assert.match(buildNativeToolSystemInstruction("inspect the repository", "win32"), /Windows PowerShell/);
  assert.match(buildNativeToolSystemInstruction("inspect the repository", "win32"), /Set-Content/);
  assert.match(buildNativeToolSystemInstruction("inspect the repository", "win32"), /workspace\.write_file/);
  assert.match(buildNativeToolSystemInstruction("inspect the repository", "darwin"), /shell is zsh/);
  assert.match(buildNativeToolSystemInstruction("inspect the repository", "darwin"), /grep -r/);
  assert.match(buildNativeToolSystemInstruction("inspect the repository", "darwin"), /cat>|tee|heredoc|workspace\.write_file/);
  assert.match(buildNativeToolSystemInstruction("inspect the repository", "linux"), /grep -r/);
  assert.match(buildNativeToolSystemInstruction("inspect the repository", "win32"), /Get-ChildItem -Recurse/);
  assert.match(buildNativeToolSystemInstruction("inspect the repository", "win32"), /next_action/);
});

test("bootstrap prompt prefers local entrypoints over docker compose", async () => {
  const { buildProjectBootstrapInstruction, detectLocalProjectBootstrap } = await import(
    new URL("./native-tool-prompt-policy.ts", import.meta.url).href
  );
  const instruction = buildNativeToolSystemInstruction("启动这个项目", "win32");
  assert.match(instruction, /workspace\.glob/);
  assert.match(instruction, /workspace\.grep/);
  assert.match(instruction, /alias glob/);
  assert.match(instruction, /alias grep/);
  assert.match(instruction, /BRAIN threads/);
  assert.match(instruction, /workspace\.read/);
  assert.match(instruction, /workspace\.edit/);
  assert.match(instruction, /workspace\.apply_patch/);
  assert.match(instruction, /workspace\.open_image|artifact\.open_image/);
  assert.match(instruction, /workspace\.open_video|artifact\.open_video/);
  assert.match(instruction, /shell\.process/);
  assert.match(instruction, /Do not default to docker compose/i);
  assert.match(instruction, /package\.json/);
  assert.match(instruction, /pyproject\.toml|requirements\.txt|manage\.py/);

  const nodeHint = detectLocalProjectBootstrap(["package.json", "docker-compose.yml"]);
  assert.equal(nodeHint.kind, "node");
  assert.equal(nodeHint.dockerPresent, true);
  assert.match(nodeHint.guidance, /npm\/pnpm|local npm/i);
  assert.match(nodeHint.guidance, /docker compose/i);

  const pythonHint = detectLocalProjectBootstrap(["requirements.txt", "manage.py"]);
  assert.equal(pythonHint.kind, "python");
  assert.match(buildProjectBootstrapInstruction(["requirements.txt"]), /local py\/python|Prefer local py/i);
});

test("requires a non-empty PDF artifact before a PDF request is satisfied", () => {
  assert.equal(requestedArtifactSatisfied("输出年度总结.pdf", []), false);
  assert.equal(requestedArtifactSatisfied("输出年度总结.pdf", [{ path: "年度总结.txt", size: 20 }]), false);
  assert.equal(requestedArtifactSatisfied("输出年度总结.pdf", [{ path: "年度总结.pdf", size: 20 }]), true);
});

test("requires artifact verification and CJK-safe PDF output when requested", () => {
  const instruction = buildNativeToolSystemInstruction("请生成并保存一份报告.pdf", "win32");
  assert.match(instruction, /must create it inside the attached workspace/);
  assert.match(instruction, /artifact\.inspect/);
  assert.match(instruction, /real CJK font/);
  assert.match(instruction, /Chinese curly double quotes/);
  assert.match(instruction, /U\+201C/);
});

test("forces on-disk write tools when user asks for real implementation", async () => {
  const { requestsWorkspaceMaterialization } = await import(
    new URL("./native-tool-prompt-policy.ts", import.meta.url).href
  );
  assert.equal(requestsWorkspaceMaterialization("我需要完全真实实现"), true);
  assert.equal(requestsWorkspaceMaterialization("inspect the repository"), false);
  const instruction = buildNativeToolSystemInstruction("我需要完全真实实现", "win32");
  assert.match(instruction, /real on-disk implementation/);
  assert.match(instruction, /workspace\.write_file/);
  assert.match(instruction, /Listing file paths/);
});
