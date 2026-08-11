import { requestsOutputArtifact, requestsPdfFile } from "./artifact-request-policy.js";
import { detectLocalProjectBootstrap } from "./project-bootstrap-heuristics.ts";
export { requestsOutputArtifact, requestsPdfFile, requestedArtifactFormats, requestedArtifactSatisfied } from "./artifact-request-policy.js";
export { detectLocalProjectBootstrap } from "./project-bootstrap-heuristics.ts";

/** Builds platform and artifact safety requirements for native model tools. */
export function buildNativeToolSystemInstruction(latestUserRequest: string, platform = process.platform) {
  const shellContract = platform === "win32"
    ? [
        "The shell is Windows PowerShell, not cmd.exe and not Bash.",
        "Submit only the PowerShell command body to shell.exec. Never wrap it in powershell -Command or pwsh -Command because the host starts exactly one PowerShell process.",
        "Never use Bash `&&` / `||`, cmd-only `2>nul`, `echo.`, or `del`. Use PowerShell `;` chaining when shell.exec is necessary."
      ]
    : ["The shell is zsh. Use POSIX-compatible commands."];
  const artifactContract = requestsOutputArtifact(latestUserRequest)
      ? [
        "The user requested a real output artifact. You must create it inside the attached workspace before claiming completion.",
        "Place user-facing output artifacts under the attached project's outputs/ directory. Never place conversation outputs in .codecn/, skills/, another project, or an absolute path.",
        "For multiline source or scripts, call workspace.write_file instead of embedding source in `python -c` or shell quoting.",
        "Do not probe whether libraries are installed before the first run. Write the script and run it; only install or repair dependencies if that run reports a missing dependency.",
        "Run the generated script with one minimal shell.exec call, then call artifact.inspect on every requested output file.",
        "Do not claim success unless artifact.inspect returns ok with a non-zero byte size and the expected real file signature.",
        "Do not perform cleanup or delete generated scripts during the artifact task, and never delete the requested output artifact.",
        "After successful inspection, stop calling tools immediately and summarize the outcome concisely.",
        "Do not write a manual file-change list or Markdown file link in the final answer. CodeCN appends an authoritative, clickable created/modified file summary from tool results."
      ]
    : [];
  const pdfContract = requestsPdfFile(latestUserRequest)
    ? [
        "For Chinese PDFs, register and use a real CJK font such as Microsoft YaHei or SimSun for every Chinese text style.",
        "Do not place emoji, check marks, decorative bullets, or unsupported symbols in PDFs. Use numbered lines or ASCII hyphens so rendering never shows missing-glyph squares."
      ]
    : [];
  const searchContract = [
    "For finding files, use workspace.glob (pattern/path/namePattern). For searching code contents, use workspace.grep (pattern/path/glob/context). They ignore node_modules/.git/venv and cap depth/hits—like OpenClaw find/grep.",
    "Use workspace.scan only when you need a shallow directory listing.",
    "Avoid PowerShell Get-ChildItem -Recurse unless scoped to a subfolder with -Filter/-Include or -Depth; unbounded recurse can crash the tool host."
  ];
  const codingFileContract = [
    "For reading source or SKILL.md files, prefer workspace.read (alias: read) with optional offset/limit—do not use shell Get-Content/cat/type for ordinary file reads.",
    "For localized code edits, prefer workspace.edit (alias: edit) with unique oldText→newText replacements.",
    "For multi-file Add/Update/Delete changes, prefer workspace.apply_patch (alias: apply_patch) with a *** Begin Patch envelope.",
    "Prefer workspace.write_file (alias: write) only when creating or replacing an entire file.",
    "If apply_patch fails twice (bad envelope/format), stop retrying patches and create files with workspace.write_file instead.",
    "If workspace.edit fails once because oldText does not match exactly, immediately workspace.read that file (or a nearby offset), then retry edit with exact text or replace the whole file via workspace.write_file. Do not keep guessing the same stale oldText.",
    "Do not narrate long plans between every file. Call tools immediately; keep user-visible text short.",
    "For long-running commands, use shell.exec with background=true or yieldMs, then shell.process (alias: process) to poll/log/kill."
  ];
  const bootstrapContract = [
    "When starting or running a project: detect package.json → local npm/pnpm/node; detect pyproject.toml / requirements.txt / manage.py → local py/python/uvicorn.",
    "Do not default to docker compose unless the user explicitly asks for containers or no local entrypoint exists."
  ];
  const materializationContract = requestsWorkspaceMaterialization(latestUserRequest)
    ? [
        "The user asked for a real on-disk implementation in the attached workspace.",
        "Listing file paths, Markdown trees, or numbered plans such as “第一步：创建目录结构” is not completion.",
        "In this same turn you must call workspace.write_file and/or workspace.apply_patch (and shell.mkdir only when needed) until every required path exists on disk.",
        "Do not claim the project is created unless tools actually wrote the files. Prefer writing real source over describing what you would write.",
        "Prefer many workspace.write_file calls over one giant apply_patch when scaffolding a new project."
      ]
    : [];
  return [
    "Native CodeCN tool contract:",
    ...shellContract,
    ...searchContract,
    ...codingFileContract,
    ...bootstrapContract,
    "Prefer workspace.read/edit/apply_patch over shell for file IO; use workspace.write_file for whole-file create/replace to avoid shell escaping failures.",
    "To open or preview workspace images/videos in the side panel, call workspace.open_image or workspace.open_video (aliases: artifact.open_image / artifact.open_video). Prefer these over shell.open / Start-Process / explorer for media files.",
    "For PDF or DOCX government/writing output, prefer document.create_pdf or document.create_docx with structured { title, sections:[{heading,body,bullets}] }. Never pass HTML/XML.",
    "For PPTX/XLSX, call artifact.create. Do not generate temporary scripts or write fake text files with office extensions.",
    "document.create_pdf / document.create_docx / artifact.create write under outputs/ (example: outputs/宣讲稿-第一版.pdf). Pass plain Chinese text or Markdown only.",
    "Use artifact.inspect to verify generated files instead of merely asserting that they exist.",
    ...artifactContract,
    ...pdfContract,
    ...materializationContract
  ].join("\n");
}

/** True when the user wants real workspace files, not a textual file list. */
export function requestsWorkspaceMaterialization(content: string) {
  const text = String(content || "");
  if (!text.trim()) return false;
  return /真实实现|完全真实|落到磁盘|落地实现|写出到仓库|实际创建文件|真正创建|materialize|scaffold\b|write\s+(?:the\s+)?files?\b|create\s+(?:the\s+)?(?:project|directories|files)\b/i.test(text)
    || /(?:创建|生成|写出|落地|搭建)[\s\S]{0,28}(?:目录结构|目录和文件|源码|工程文件|项目文件|完整项目)/i.test(text)
    || /不要只(?:有)?[\s\S]{0,8}(?:文字|列表|计划)/i.test(text);
}

/**
 * Optional prep helper: refine bootstrap guidance once workspace.scan names are known.
 * @param entryNames Root or relative names from a scan result.
 */
export function buildProjectBootstrapInstruction(entryNames: Iterable<string> = []) {
  const hint = detectLocalProjectBootstrap(entryNames);
  return [
    "Project bootstrap preference (local first, docker last):",
    hint.guidance,
    hint.preferredCommands.length
      ? `Preferred local commands: ${hint.preferredCommands.join("; ")}.`
      : "",
    hint.dockerPresent
      ? "Docker compose files are present but must not be the default start path."
      : ""
  ].filter(Boolean).join("\n");
}
