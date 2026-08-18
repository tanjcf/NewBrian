import { promises as fs } from "node:fs";
import { basename, isAbsolute, relative, resolve } from "node:path";

function isPathWithin(rootPath: string, targetPath: string) {
  const relativePath = relative(rootPath, targetPath);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function isMissingPathError(error: unknown) {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && String((error as NodeJS.ErrnoException).code) === "ENOENT"
  );
}

/** Soft aliases when chat/UI opens a generated artifact by basename only. */
export function previewPathFallbacks(requestedPath: string) {
  const trimmed = String(requestedPath || "").trim();
  if (!trimmed || isAbsolute(trimmed)) return [] as string[];
  const posix = trimmed.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!posix || posix === "." || posix === "..") return [];
  const name = basename(posix);
  if (!name || name === "." || name === "..") return [];
  if (posix.includes("/")) return [];
  return [`outputs/${name}`];
}

async function resolveExistingFileOnce(rootPath: string, requestedPath: string, errorPath: string) {
  const normalizedRoot = resolve(rootPath);
  const normalizedTarget = isAbsolute(requestedPath)
    ? resolve(requestedPath)
    : resolve(normalizedRoot, requestedPath);

  if (!isPathWithin(normalizedRoot, normalizedTarget) || normalizedRoot === normalizedTarget) {
    throw new Error("File must stay inside the selected project.");
  }

  let realRoot: string;
  let realTarget: string;
  try {
    [realRoot, realTarget] = await Promise.all([
      fs.realpath(normalizedRoot),
      fs.realpath(normalizedTarget)
    ]);
  } catch (error) {
    if (isMissingPathError(error)) {
      throw new Error(
        `文件不存在，无法预览：${errorPath}。请确认已通过 document.create_pdf / document.create_docx / artifact.create 成功生成 outputs/ 下的文件后重试。`
      );
    }
    throw error;
  }
  if (!isPathWithin(realRoot, realTarget) || realRoot === realTarget) {
    throw new Error("File must stay inside the selected project.");
  }

  const stat = await fs.stat(realTarget);
  if (!stat.isFile()) throw new Error("Selected path is not a file.");
  return { targetPath: realTarget, relativePath: relative(realRoot, realTarget) };
}

export async function resolveExistingFileInsideRoot(rootPath: string, requestedPath: string) {
  const candidates = [requestedPath, ...previewPathFallbacks(requestedPath)];
  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      return await resolveExistingFileOnce(rootPath, candidate, requestedPath);
    } catch (error) {
      lastError = error;
      if (!(error instanceof Error) || !/文件不存在，无法预览/.test(error.message)) {
        throw error;
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(
      `文件不存在，无法预览：${requestedPath}。请确认已通过 document.create_pdf / document.create_docx / artifact.create 成功生成 outputs/ 下的文件后重试。`
    );
}
