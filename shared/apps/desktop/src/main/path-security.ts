import { promises as fs } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";

const SKIPPED_BASENAME_SEARCH_DIRS = new Set([
  ".git",
  "node_modules",
  ".newbrain",
  ".desktop-profile",
  "out",
  "dist",
  "build",
  "target",
  ".venv",
  "venv",
  "__pycache__"
]);

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

function normalizeRequestedPath(requestedPath: string) {
  return String(requestedPath || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "");
}

function missingPreviewError(requestedPath: string) {
  const posix = normalizeRequestedPath(requestedPath);
  const name = basename(posix) || posix;
  const looksLikeDocumentArtifact = /\.(pdf|docx)$/i.test(name)
    || /(^|\/)outputs\//i.test(posix);
  if (looksLikeDocumentArtifact) {
    return new Error(
      `文件不存在，无法预览：${requestedPath}。请确认已通过 document.create_pdf / document.create_docx / artifact.create 成功生成 outputs/ 下的文件后重试。`
    );
  }
  return new Error(
    `文件不存在，无法预览：${requestedPath}。请确认文件已写入当前项目目录后重试。`
  );
}

/** Soft aliases when chat/UI opens a generated artifact by basename only. */
export function previewPathFallbacks(requestedPath: string) {
  const trimmed = normalizeRequestedPath(requestedPath);
  if (!trimmed || isAbsolute(trimmed)) return [] as string[];
  if (!trimmed || trimmed === "." || trimmed === "..") return [];
  const name = basename(trimmed);
  if (!name || name === "." || name === "..") return [];
  const generatedMediaFallbacks = [
    `.newbrain/generated-media/image/${name}`,
    `.newbrain/generated-media/video/${name}`,
    `.newbrain/generated-media/music/${name}`
  ];
  if (trimmed.includes("/")) {
    // Also try the bare basename under common roots when a nested relative path misses.
    return [
      name,
      `outputs/${name}`,
      `files/${name}`,
      `artifacts/${name}`,
      `docs/${name}`,
      `notes/${name}`,
      ...generatedMediaFallbacks
    ].filter((candidate, index, all) => candidate !== trimmed && all.indexOf(candidate) === index);
  }
  return [
    `outputs/${name}`,
    `files/${name}`,
    `artifacts/${name}`,
    `docs/${name}`,
    `notes/${name}`,
    ...generatedMediaFallbacks
  ];
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
      throw missingPreviewError(errorPath);
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

/** Bounded basename walk when exact/fallback candidates miss (e.g. explore notes). */
export async function findBasenameUnderRoot(rootPath: string, fileName: string, options?: {
  maxDepth?: number;
  maxVisits?: number;
}) {
  const name = basename(normalizeRequestedPath(fileName));
  if (!name || name === "." || name === "..") return null;
  const maxDepth = Math.max(1, Math.min(6, options?.maxDepth ?? 4));
  const maxVisits = Math.max(8, Math.min(400, options?.maxVisits ?? 200));
  const normalizedRoot = resolve(rootPath);
  let realRoot: string;
  try {
    realRoot = await fs.realpath(normalizedRoot);
  } catch {
    return null;
  }
  const queue: Array<{ dir: string; depth: number }> = [{ dir: realRoot, depth: 0 }];
  let visits = 0;
  while (queue.length > 0 && visits < maxVisits) {
    const current = queue.shift();
    if (!current) break;
    visits += 1;
    let entries;
    try {
      entries = await fs.readdir(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name === name && entry.isFile()) {
        const absolute = join(current.dir, entry.name);
        if (!isPathWithin(realRoot, absolute)) continue;
        return {
          targetPath: absolute,
          relativePath: relative(realRoot, absolute)
        };
      }
      if (!entry.isDirectory() || current.depth >= maxDepth) continue;
      if (SKIPPED_BASENAME_SEARCH_DIRS.has(entry.name)) {
        // Auto media lands under .newbrain/generated-media/; still search there by basename.
        if (entry.name === ".newbrain" && current.depth === 0) {
          queue.push({ dir: join(current.dir, ".newbrain", "generated-media"), depth: current.depth + 1 });
        }
        continue;
      }
      const nextDir = join(current.dir, entry.name);
      if (!isPathWithin(realRoot, nextDir)) continue;
      queue.push({ dir: nextDir, depth: current.depth + 1 });
    }
  }
  return null;
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

  const name = basename(normalizeRequestedPath(requestedPath));
  if (name) {
    const found = await findBasenameUnderRoot(rootPath, name);
    if (found) {
      // Re-validate through the same boundary checks used for direct paths.
      return resolveExistingFileOnce(rootPath, found.relativePath, requestedPath);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : missingPreviewError(requestedPath);
}
