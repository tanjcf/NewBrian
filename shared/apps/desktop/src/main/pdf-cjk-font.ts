import { access, readFile } from "node:fs/promises";
import { platform } from "node:os";

const WINDOWS_CANDIDATES = [
  "C:/Windows/Fonts/simhei.ttf",
  "C:/Windows/Fonts/Noto Sans SC (TrueType).otf",
  "C:/Windows/Fonts/msyh.ttc",
  "C:/Windows/Fonts/simsun.ttc",
  "C:/Windows/Fonts/NotoSansSC-VF.ttf"
];

const UNIX_CANDIDATES = [
  "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
  "/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf",
  "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
  "/System/Library/Fonts/PingFang.ttc",
  "/Library/Fonts/Arial Unicode.ttf"
];

async function firstExisting(paths: string[]): Promise<string | null> {
  for (const candidate of paths) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // try next
    }
  }
  return null;
}

/** Resolves a system CJK font path suitable for pdf-lib + fontkit embedding. */
export async function resolveDesktopCjkFontPath(
  candidates: string[] = platform() === "win32" ? WINDOWS_CANDIDATES : UNIX_CANDIDATES
): Promise<string | null> {
  return firstExisting(candidates);
}

/** Loads CJK font bytes for PDF embedding. Returns null when no system font is available. */
export async function loadDesktopCjkFontBytes(): Promise<{ path: string; bytes: Uint8Array } | null> {
  const path = await resolveDesktopCjkFontPath();
  if (!path) return null;
  const buffer = await readFile(path);
  return { path, bytes: new Uint8Array(buffer) };
}
