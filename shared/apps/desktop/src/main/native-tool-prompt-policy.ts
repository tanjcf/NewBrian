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
        "Never use Bash `&&` / `||`, cmd-only `2>nul`, `echo.`, or `del`. Use PowerShell `;` chaining when shell.exec is necessary.",
        "Never use shell.exec to create or overwrite source/HTML/Markdown (no Set-Content, Out-File, Add-Content, heredoc, cat>, echo>). Call workspace.write_file with a workspace-relative path instead. Absolute paths inside the workspace are accepted and coerced."
      ]
    : [
        "The shell is zsh. Use POSIX-compatible commands.",
        "Never use shell.exec to create or overwrite source files with cat>/tee/heredoc; call workspace.write_file with a workspace-relative path instead."
      ];
  const artifactContract = requestsOutputArtifact(latestUserRequest)
      ? [
        "The user requested a real output artifact. You must create it inside the attached workspace before claiming completion.",
        "Place user-facing output artifacts under the attached project's outputs/ directory. Never place conversation outputs in .newbrain/, skills/, another project, or an absolute path.",
        "For multiline source or scripts, call workspace.write_file instead of embedding source in `python -c` or shell quoting.",
        "Do not probe whether libraries are installed before the first run. Write the script and run it; only install or repair dependencies if that run reports a missing dependency.",
        "Run the generated script with one minimal shell.exec call, then call artifact.inspect on every requested output file.",
        "Do not claim success unless artifact.inspect returns ok with a non-zero byte size and the expected real file signature.",
        "Do not perform cleanup or delete generated scripts during the artifact task, and never delete the requested output artifact.",
        "After successful inspection, stop calling tools immediately and summarize the outcome concisely.",
        "Do not write a manual file-change list or Markdown file link in the final answer. NewBrain appends an authoritative, clickable created/modified file summary from tool results."
      ]
    : [];
  const pdfContract = requestsPdfFile(latestUserRequest)
    ? [
        "For Chinese PDFs, register and use a real CJK font such as Microsoft YaHei or SimSun for every Chinese text style.",
        "Do not place emoji, check marks, decorative bullets, or unsupported symbols in PDFs. Use numbered lines or ASCII hyphens so rendering never shows missing-glyph squares."
      ]
    : [];
  const searchContract = [
    "For workspace retrieval in BRAIN threads, always use built-in workspace tools—not shell.exec—for finding or reading project files (Windows, macOS, and Ubuntu share the same tools).",
    "Find files: workspace.glob (alias glob) with pattern/path/namePattern. Search contents: workspace.grep (alias grep) with pattern/path/glob/context. Read files: workspace.read (alias read) with optional offset/limit.",
    "Use workspace.scan only when you need a shallow directory listing. These tools ignore node_modules/.git/venv and cap depth/hits.",
    platform === "win32"
      ? "Do not use Get-ChildItem -Recurse, Select-String -Recurse, or unbounded dir /s for code search."
      : "Do not use grep -r, find without -maxdepth, or ls -R for code search."
  ];
  const codingFileContract = [
    "For reading source or SKILL.md files, prefer workspace.read (alias: read) with optional offset/limit—do not use shell Get-Content/cat/type for ordinary file reads.",
    "For localized code edits, prefer workspace.edit (alias: edit) with unique oldText→newText replacements.",
    "For multi-file Add/Update/Delete changes, prefer workspace.apply_patch (alias: apply_patch) with a *** Begin Patch envelope.",
    "Prefer workspace.write_file (alias: write) when creating or replacing an entire file. Prefer relative targetPath; in-workspace absolute paths are coerced.",
    "If apply_patch fails twice (bad envelope/format), stop retrying patches and create files with workspace.write_file instead.",
    "If workspace.edit fails once because oldText does not match exactly, immediately workspace.read that file (or a nearby offset), then retry edit with exact text or replace the whole file via workspace.write_file. Do not keep guessing the same stale oldText.",
    "If workspace.write_file fails, fix the relative path and retry write_file—never fall back to shell.exec for whole-file writes.",
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
    "Native NewBrain tool contract:",
    ...shellContract,
    ...searchContract,
    ...codingFileContract,
    ...bootstrapContract,
    "Prefer workspace.read/edit/apply_patch over shell for file IO; use workspace.write_file for whole-file create/replace to avoid shell escaping failures.",
    "Tool failures may include next_action guidance—follow it immediately instead of re-delegating or retrying the same bad shell write.",
    "To open or preview workspace images/videos in the side panel, call workspace.open_image or workspace.open_video (aliases: artifact.open_image / artifact.open_video). Prefer these over shell.open / Start-Process / explorer for media files.",
    "For PDF or DOCX government/writing output, prefer document.create_pdf or document.create_docx with structured { title, sections:[{heading,body,bullets}] }. Never pass HTML/XML.",
    "For PPTX/HTML decks or XLSX, call artifact.create. Do not generate temporary scripts or write fake text files with office extensions.",
    "For Chinese body text in PDF/DOCX/PPTX/HTML/XLSX, use Chinese curly double quotes “…” (U+201C/U+201D), never ASCII straight quotes \"...\". The office generator also normalizes leftover ASCII/fullwidth quotes in Chinese prose.",
    "For presentations: prefer structured slides[{title,body,bullets,layout}]. layout may be title|section|bullets|columns|cards|stat|chart|timeline|process|image|closing. Every deck should include at least one chart slide (chart with categories+values), one timeline/process slide (phases array), and one image slide (imagePath from image_generate or imagePlaceholder). format=pptx also writes companion *.slides.html; format=html is web-first.",
    "document.create_pdf / document.create_docx / artifact.create write under outputs/ (example: outputs/宣讲稿-第一版.pdf). Pass plain Chinese text or Markdown only.",
    "To open an existing DOCX, XLSX, or PPTX in a local Office suite, call office.open with a workspace-relative path. office.status reports LibreOffice first, then WPS, then Microsoft Office. office.convert uses LibreOffice and writes the result under outputs/.",
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
