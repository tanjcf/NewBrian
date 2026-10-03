import { spawn, spawnSync } from "node:child_process";
import { access, mkdir, realpath, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path";

export type OfficeKind = "writer" | "calc" | "impress";
export type OfficeEditorId = "libreoffice" | "wps" | "microsoft";

export type OfficeEditor = {
  id: OfficeEditorId;
  available: boolean;
  executable: string;
  formats: string[];
};

export type OfficeSuiteStatus = {
  editors: OfficeEditor[];
  preferred: OfficeEditorId | null;
};

export type OfficeSuiteDependencies = {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  accessPath: (path: string) => Promise<unknown>;
  lookup: (command: string, args: string[]) => { status: number | null; stdout?: string };
  spawnCommand: (command: string, args: string[], timeoutMs: number) => Promise<{ status: number | null; stdout: string; stderr: string }>;
  openDetached: (command: string, args: string[]) => void;
  realpath: (path: string) => Promise<string>;
  statFile: (path: string) => Promise<{ isFile: () => boolean; size: number }>;
  ensureDir: (path: string) => Promise<unknown>;
};

const WRITER_EXTENSIONS = new Set([".doc", ".docx", ".odt", ".rtf"]);
const CALC_EXTENSIONS = new Set([".xls", ".xlsx", ".ods", ".csv"]);
const IMPRESS_EXTENSIONS = new Set([".ppt", ".pptx", ".odp"]);

export const OFFICE_CONVERT_FORMATS = new Set(["pdf", "docx", "xlsx", "pptx", "odt", "ods", "odp", "csv"]);

export function officeKindForExtension(extension: string): OfficeKind | null {
  const normalized = extension.toLowerCase();
  if (WRITER_EXTENSIONS.has(normalized)) return "writer";
  if (CALC_EXTENSIONS.has(normalized)) return "calc";
  if (IMPRESS_EXTENSIONS.has(normalized)) return "impress";
  return null;
}

export function createDefaultOfficeDependencies(): OfficeSuiteDependencies {
  return {
    platform: process.platform,
    env: process.env,
    accessPath: (path) => access(path),
    lookup: (command, args) => {
      const result = spawnSync(command, args, { encoding: "utf8", windowsHide: true, timeout: 5_000 });
      return { status: result.status, stdout: result.stdout };
    },
    spawnCommand: (command, args, timeoutMs) => new Promise((resolvePromise, reject) => {
      const child = spawn(command, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error("OFFICE_CONVERT_TIMEOUT"));
      }, timeoutMs);
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout = `${stdout}${chunk}`.slice(0, 8_000);
      });
      child.stderr.on("data", (chunk: string) => {
        stderr = `${stderr}${chunk}`.slice(0, 8_000);
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on("close", (status) => {
        clearTimeout(timer);
        resolvePromise({ status, stdout, stderr });
      });
    }),
    openDetached: (command, args) => {
      const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: false });
      child.unref();
    },
    realpath: (path) => realpath(path),
    statFile: (path) => stat(path),
    ensureDir: (path) => mkdir(path, { recursive: true })
  };
}

function programFiles(env: NodeJS.ProcessEnv) {
  return [env.ProgramFiles, env["ProgramFiles(x86)"]].map((value) => String(value ?? "").trim()).filter(Boolean);
}

function whereCommand(platform: NodeJS.Platform) {
  return platform === "win32" ? "where.exe" : "which";
}

async function firstExisting(deps: OfficeSuiteDependencies, candidates: string[]) {
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      await deps.accessPath(candidate);
      return candidate;
    } catch {
      // Try the next known install path.
    }
  }
  return "";
}

function lookupFirst(deps: OfficeSuiteDependencies, name: string) {
  try {
    const result = deps.lookup(whereCommand(deps.platform), [name]);
    if (result.status !== 0) return "";
    return String(result.stdout ?? "").split(/\r?\n/u).map((line) => line.trim()).find(Boolean) ?? "";
  } catch {
    return "";
  }
}

async function resolveExecutable(deps: OfficeSuiteDependencies, names: string[], candidates: string[]) {
  const located = names.flatMap((name) => {
    const found = lookupFirst(deps, name);
    return found ? [found] : [];
  });
  return firstExisting(deps, [...candidates, ...located]);
}

export async function detectOfficeEditors(deps: OfficeSuiteDependencies = createDefaultOfficeDependencies()): Promise<OfficeSuiteStatus> {
  const files = programFiles(deps.env);
  const localAppData = String(deps.env.LOCALAPPDATA ?? "").trim();
  const libreofficeCandidates = deps.platform === "win32"
    ? files.map((root) => join(root, "LibreOffice", "program", "soffice.exe"))
    : deps.platform === "darwin"
      ? ["/Applications/LibreOffice.app/Contents/MacOS/soffice"]
      : ["/usr/bin/soffice", "/usr/bin/libreoffice"];
  const soffice = await resolveExecutable(deps, deps.platform === "win32" ? ["soffice.exe", "soffice"] : ["soffice", "libreoffice"], libreofficeCandidates);

  const wpsNames = deps.platform === "win32"
    ? { writer: ["wps.exe"], calc: ["et.exe"], impress: ["wpp.exe"] }
    : { writer: ["wps"], calc: ["et"], impress: ["wpp"] };
  const wpsRoots = deps.platform === "win32"
    ? [
      ...files.map((root) => join(root, "Kingsoft", "WPS Office", "office6")),
      localAppData ? join(localAppData, "Kingsoft", "WPS Office", "office6") : ""
    ]
    : [];
  const wpsWriter = await resolveExecutable(deps, wpsNames.writer, wpsRoots.map((root) => root ? join(root, "wps.exe") : ""));
  const wpsCalc = await resolveExecutable(deps, wpsNames.calc, wpsRoots.map((root) => root ? join(root, "et.exe") : ""));
  const wpsImpress = await resolveExecutable(deps, wpsNames.impress, wpsRoots.map((root) => root ? join(root, "wpp.exe") : ""));
  const wpsExecutable = wpsWriter || wpsCalc || wpsImpress;

  const officeRoots = deps.platform === "win32"
    ? files.map((root) => join(root, "Microsoft Office", "root", "Office16"))
    : [];
  const word = await resolveExecutable(deps, deps.platform === "win32" ? ["WINWORD.EXE"] : ["winword"], officeRoots.map((root) => join(root, "WINWORD.EXE")));
  const excel = await resolveExecutable(deps, deps.platform === "win32" ? ["EXCEL.EXE"] : ["excel"], officeRoots.map((root) => join(root, "EXCEL.EXE")));
  const powerPoint = await resolveExecutable(deps, deps.platform === "win32" ? ["POWERPNT.EXE"] : ["powerpnt"], officeRoots.map((root) => join(root, "POWERPNT.EXE")));
  const microsoftExecutable = word || excel || powerPoint;

  const editors: OfficeEditor[] = [
    { id: "libreoffice", available: Boolean(soffice), executable: soffice, formats: ["docx", "xlsx", "pptx", "odt", "ods", "odp", "csv", "pdf"] },
    { id: "wps", available: Boolean(wpsExecutable), executable: wpsExecutable, formats: ["docx", "xlsx", "pptx"] },
    { id: "microsoft", available: Boolean(microsoftExecutable), executable: microsoftExecutable, formats: ["docx", "xlsx", "pptx"] }
  ];
  return { editors, preferred: editors.find((editor) => editor.available)?.id ?? null };
}

type KindEditor = { id: OfficeEditorId; executable: string };

async function detectKindEditors(deps: OfficeSuiteDependencies): Promise<{ soffice: string; writer: KindEditor | null; calc: KindEditor | null; impress: KindEditor | null }> {
  const files = programFiles(deps.env);
  const localAppData = String(deps.env.LOCALAPPDATA ?? "").trim();
  const libreofficeCandidates = deps.platform === "win32"
    ? files.map((root) => join(root, "LibreOffice", "program", "soffice.exe"))
    : deps.platform === "darwin"
      ? ["/Applications/LibreOffice.app/Contents/MacOS/soffice"]
      : ["/usr/bin/soffice", "/usr/bin/libreoffice"];
  const soffice = await resolveExecutable(deps, deps.platform === "win32" ? ["soffice.exe", "soffice"] : ["soffice", "libreoffice"], libreofficeCandidates);
  const wpsRoots = deps.platform === "win32"
    ? [
      ...files.map((root) => join(root, "Kingsoft", "WPS Office", "office6")),
      localAppData ? join(localAppData, "Kingsoft", "WPS Office", "office6") : ""
    ]
    : [];
  const officeRoots = deps.platform === "win32"
    ? files.map((root) => join(root, "Microsoft Office", "root", "Office16"))
    : [];
  const writer = await resolveExecutable(deps, deps.platform === "win32" ? ["wps.exe"] : ["wps"], wpsRoots.map((root) => root ? join(root, "wps.exe") : ""))
    || await resolveExecutable(deps, deps.platform === "win32" ? ["WINWORD.EXE"] : ["winword"], officeRoots.map((root) => join(root, "WINWORD.EXE")));
  const calc = await resolveExecutable(deps, deps.platform === "win32" ? ["et.exe"] : ["et"], wpsRoots.map((root) => root ? join(root, "et.exe") : ""))
    || await resolveExecutable(deps, deps.platform === "win32" ? ["EXCEL.EXE"] : ["excel"], officeRoots.map((root) => join(root, "EXCEL.EXE")));
  const impress = await resolveExecutable(deps, deps.platform === "win32" ? ["wpp.exe"] : ["wpp"], wpsRoots.map((root) => root ? join(root, "wpp.exe") : ""))
    || await resolveExecutable(deps, deps.platform === "win32" ? ["POWERPNT.EXE"] : ["powerpnt"], officeRoots.map((root) => join(root, "POWERPNT.EXE")));
  const identify = (executable: string, wpsName: RegExp): KindEditor | null => {
    if (!executable) return null;
    return { id: wpsName.test(executable) ? "wps" : "microsoft", executable };
  };
  return {
    soffice,
    writer: identify(writer, /wps(?:\.exe)?$/i),
    calc: identify(calc, /et(?:\.exe)?$/i),
    impress: identify(impress, /wpp(?:\.exe)?$/i)
  };
}

function editorForKind(apps: Awaited<ReturnType<typeof detectKindEditors>>, kind: OfficeKind) {
  if (apps.soffice) return { id: "libreoffice" as const, executable: apps.soffice };
  if (kind === "writer") return apps.writer;
  if (kind === "calc") return apps.calc;
  return apps.impress;
}

export async function resolveProjectFile(projectRoot: string, relativePath: string, deps: OfficeSuiteDependencies) {
  const root = await deps.realpath(projectRoot);
  const requested = resolve(root, relativePath);
  const target = await deps.realpath(requested);
  const relativeToRoot = relative(root, target);
  if (!relativeToRoot || relativeToRoot.startsWith("..") || isAbsolute(relativeToRoot)) {
    throw new Error("OFFICE_PATH_OUTSIDE_PROJECT");
  }
  const fileStat = await deps.statFile(target);
  if (!fileStat.isFile()) throw new Error("OFFICE_PATH_NOT_FILE");
  const extension = extname(target).toLowerCase();
  const kind = officeKindForExtension(extension);
  if (!kind) throw new Error("OFFICE_FORMAT_UNSUPPORTED");
  return {
    root,
    target,
    relativePath: relativeToRoot.split(sep).join("/"),
    extension,
    kind,
    size: fileStat.size
  };
}

export async function openOfficeFile(projectRoot: string, relativePath: string, deps: OfficeSuiteDependencies = createDefaultOfficeDependencies()) {
  const file = await resolveProjectFile(projectRoot, relativePath, deps);
  const apps = await detectKindEditors(deps);
  const editor = editorForKind(apps, file.kind);
  if (!editor) {
    return {
      ok: false as const,
      code: "OFFICE_EDITOR_MISSING",
      output: "本机没有可用的 Office 套件。安装免费的 LibreOffice 后即可打开 Word、Excel 和 PPT：https://www.libreoffice.org/download/"
    };
  }
  deps.openDetached(editor.executable, [file.target]);
  return {
    ok: true as const,
    output: JSON.stringify({
      editor: editor.id,
      executable: editor.executable,
      path: file.relativePath,
      kind: file.kind
    })
  };
}

export async function convertOfficeFile(
  projectRoot: string,
  relativePath: string,
  format: string,
  deps: OfficeSuiteDependencies = createDefaultOfficeDependencies()
) {
  const targetFormat = format.trim().toLowerCase().replace(/^\./, "");
  if (!OFFICE_CONVERT_FORMATS.has(targetFormat)) {
    return { ok: false as const, code: "OFFICE_FORMAT_UNSUPPORTED", output: `不支持转换成 ${format}` };
  }
  const file = await resolveProjectFile(projectRoot, relativePath, deps);
  const apps = await detectKindEditors(deps);
  if (!apps.soffice) {
    return {
      ok: false as const,
      code: "OFFICE_LIBREOFFICE_REQUIRED",
      output: "格式转换需要本机 LibreOffice（soffice）。安装免费版后重试：https://www.libreoffice.org/download/"
    };
  }
  const outputDir = join(file.root, "outputs");
  await deps.ensureDir(outputDir);
  const result = await deps.spawnCommand(apps.soffice, [
    "--headless",
    "--norestore",
    "--nolockcheck",
    "--convert-to",
    targetFormat,
    "--outdir",
    outputDir,
    file.target
  ], 120_000);
  if (result.status !== 0) {
    return { ok: false as const, code: "OFFICE_CONVERT_FAILED", output: result.stderr || result.stdout || "LibreOffice 转换失败" };
  }
  const outputName = `${basename(file.target, file.extension)}.${targetFormat}`;
  const outputTarget = join(outputDir, outputName);
  const outputStat = await deps.statFile(outputTarget);
  if (!outputStat.isFile() || outputStat.size <= 0) {
    return { ok: false as const, code: "OFFICE_CONVERT_EMPTY", output: "转换没有生成有效文件" };
  }
  const relativeOutput = relative(file.root, outputTarget).split(sep).join("/");
  return {
    ok: true as const,
    output: JSON.stringify({ path: relativeOutput, size: outputStat.size, format: targetFormat }),
    artifact: { path: relativeOutput, size: outputStat.size, changeType: "created" as const, verified: true }
  };
}
