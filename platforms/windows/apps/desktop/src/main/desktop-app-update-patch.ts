/**
 * Detect and schedule NewBrain "ulit" patch packages (bsdiff of app.asar).
 * Full Electron MSIs stay on the msiexec path; this module only handles patch zips
 * and documents how tiny ulit applicator MSIs are still installed via msiexec.
 */

export type DesktopUpdatePackageKind = "full-msi" | "ulit-msi" | "ulit-zip";

/** Strip confusing admin suffixes such as `.ulit` / `-ulit` from a release version. */
export function normalizeDesktopUpdateVersionLabel(version: string): string {
  return String(version || "")
    .trim()
    .replace(/^v/i, "")
    .replace(/\.ulit$/i, "")
    .replace(/[-_]?ulit$/i, "")
    .replace(/[^0-9A-Za-z._-]/g, "_")
    || "update";
}

function fileNameFromUrlOrPath(value: string): string {
  const cleaned = String(value || "").trim().toLowerCase().split("?")[0] || "";
  const parts = cleaned.split(/[/\\]/);
  return parts[parts.length - 1] || cleaned;
}

/** Infer package kind from release metadata + download URL/path/version. */
export function resolveDesktopUpdatePackageKind(input: {
  packageKind?: string;
  downloadUrl?: string;
  localPath?: string;
  version?: string;
}): DesktopUpdatePackageKind {
  const declared = String(input.packageKind || "").trim().toLowerCase();
  const url = String(input.downloadUrl || "").trim().toLowerCase();
  const local = String(input.localPath || "").trim().toLowerCase();
  const version = String(input.version || "").trim().toLowerCase();
  const fileName = fileNameFromUrlOrPath(url || local);
  const haystack = `${declared} ${fileName} ${url} ${local} ${version}`;
  const looksUlit =
    declared === "patch"
    || declared === "ulit"
    || declared === "ulit-msi"
    || declared === "ulit-zip"
    || haystack.includes("ulit")
    || fileName.endsWith(".ulit.zip")
    || /\.ulit$/i.test(version);

  if (!looksUlit) return "full-msi";

  // Prefer MSI applicator when the artifact is clearly an installer (1.2.7 path).
  if (
    declared === "ulit-msi"
    || fileName.endsWith(".msi")
    || /ulit\.msi\b/.test(fileName)
    || /\.msi(\b|$)/.test(url)
    || /\.msi(\b|$)/.test(local)
  ) {
    return "ulit-msi";
  }
  if (
    declared === "ulit-zip"
    || fileName.endsWith(".zip")
    || fileName.endsWith(".ulit.zip")
    || /ulit\.zip\b/.test(fileName)
  ) {
    return "ulit-zip";
  }
  // Declared patch but URL has no extension: default to MSI applicator (msiexec-compatible).
  if (declared === "patch" || declared === "ulit") return "ulit-msi";
  return "ulit-zip";
}

/** Local download file name for a release artifact. */
export function safeDesktopUpdateFileName(input: {
  version: string;
  packageKind?: string;
  downloadUrl?: string;
}): string {
  const safeVersion = normalizeDesktopUpdateVersionLabel(input.version);
  const kind = resolveDesktopUpdatePackageKind({
    packageKind: input.packageKind,
    downloadUrl: input.downloadUrl,
    version: input.version
  });
  if (kind === "ulit-zip") return `${safeVersion}ulit.zip`;
  if (kind === "ulit-msi") return `${safeVersion}ulit.msi`;
  return `NewBrain-${safeVersion}.msi`;
}

/**
 * Hidden PowerShell wait: never `tasklist | find /I` (blank console titled find /I).
 * Times out with a Chinese message, then continues so msiexec/apply still run.
 */
export function buildDeferredProcessExitWaitPowerShell(input: {
  processImageName?: string;
  maxWaitSeconds?: number;
}): string {
  const image = String(input.processImageName || "NewBrain.exe").replace(/['"`]/g, "");
  const processName = image.replace(/\.exe$/i, "") || "NewBrain";
  const maxWait = Math.max(15, Math.min(300, Number(input.maxWaitSeconds) || 90));
  return (
    `powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command `
    + `"$ErrorActionPreference='SilentlyContinue'; `
    + `$name='${processName}'; $deadline=(Get-Date).AddSeconds(${maxWait}); `
    + `while ((Get-Date) -lt $deadline) { `
    + `if (-not (Get-Process -Name $name -ErrorAction SilentlyContinue)) { exit 0 }; `
    + `Start-Sleep -Seconds 1 }; `
    + `Write-Host '等待 NewBrain 退出超时（${maxWait}s），仍将继续安装/补丁。请确认已完全退出应用。'; `
    + `exit 0"`
  );
}

/**
 * Build a deferred .cmd that waits for NewBrain.exe to exit, expands a ulit zip
 * (if needed), then runs apply.cmd against the install root.
 */
export function buildDeferredUlitZipApplyScript(input: {
  zipPath: string;
  installRoot: string;
  stagingDir: string;
  processImageName?: string;
  maxWaitSeconds?: number;
}): string {
  const waitLine = buildDeferredProcessExitWaitPowerShell({
    processImageName: input.processImageName,
    maxWaitSeconds: input.maxWaitSeconds
  });
  const installRoot = quoteCmd(input.installRoot);
  const stagingDir = quoteCmd(input.stagingDir);
  return [
    "@echo off",
    "setlocal EnableExtensions",
    "title NewBrain update",
    "echo NewBrain update: waiting for app exit...",
    waitLine,
    "title NewBrain update: applying patch",
    `if exist ${stagingDir} rmdir /S /Q ${stagingDir}`,
    `mkdir ${stagingDir} >NUL 2>&1`,
    `powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command "Expand-Archive -LiteralPath '${escapePsSingle(input.zipPath)}' -DestinationPath '${escapePsSingle(input.stagingDir)}' -Force"`,
    `if errorlevel 1 exit /B 1`,
    `call ${quoteCmd(`${input.stagingDir}\\apply.cmd`)} ${installRoot}`,
    "exit /B %ERRORLEVEL%",
    ""
  ].join("\r\n");
}

function quoteCmd(value: string): string {
  const text = String(value ?? "");
  if (!/[ \t&<>|^"%]/.test(text) && text !== "") return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function escapePsSingle(value: string): string {
  return String(value ?? "").replace(/'/g, "''");
}
