import { promises as fs } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

function isPathWithin(rootPath: string, targetPath: string) {
  const relativePath = relative(rootPath, targetPath);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

export async function resolveExistingFileInsideRoot(rootPath: string, requestedPath: string) {
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
    const code = error && typeof error === "object" && "code" in error ? String((error as NodeJS.ErrnoException).code) : "";
    if (code === "ENOENT") {
      throw new Error(
        `文件不存在，无法预览：${requestedPath}。请确认已通过 document.create_pdf / document.create_docx / artifact.create 成功生成 outputs/ 下的文件后重试。`
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
