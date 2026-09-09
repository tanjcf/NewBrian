import { access, constants } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  NOVEL_TTS_KOKORO_VOICE_FILES,
  resolveNovelTtsVoice
} from "../shared/novel-tts-policy.js";

export const NOVEL_TTS_KOKORO_HF_MODEL_ID = "onnx-community/Kokoro-82M-v1.1-zh-ONNX";
/** Keep warm onnx child across voice switches; hard-kill mid-load crashes GPUs. */
export const NOVEL_TTS_KOKORO_IDLE_RELEASE_MS = 10 * 60_000;

export type NovelTtsKokoroLayout = {
  rootDir: string;
  modelDir: string;
  voicesDir: string;
};

function tryElectronUserDataPath() {
  try {
    // Lazy require so unit tests can run without initializing Electron.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require("electron") as typeof import("electron");
    if (electron.app?.getPath) return electron.app.getPath("userData");
  } catch {
    // ignore
  }
  return "";
}

/** Stable offline pack roots used by fetch script + Electron variants. */
export function listNovelTtsKokoroRootHints(options?: {
  resourcesPath?: string;
  userDataPath?: string;
  env?: NodeJS.ProcessEnv;
  homedir?: string;
}): string[] {
  const env = options?.env ?? process.env;
  const home = options?.homedir ?? os.homedir();
  const localAppData = env.LOCALAPPDATA || path.join(home, "AppData", "Local");
  const appData = env.APPDATA || path.join(home, "AppData", "Roaming");
  const resourcesPath = options?.resourcesPath
    ?? (typeof process.resourcesPath === "string" ? process.resourcesPath : "");
  const userDataPath = options?.userDataPath ?? tryElectronUserDataPath();

  return [
    userDataPath ? path.join(userDataPath, "novel-tts", "kokoro") : "",
    path.join(localAppData, ".newbrain", "novel-tts", "kokoro"),
    path.join(home, ".newbrain", "novel-tts", "kokoro"),
    path.join(appData, "NewBrain", "novel-tts", "kokoro"),
    path.join(appData, "newbrain", "novel-tts", "kokoro"),
    path.join(appData, "@codex-forge", "desktop", "novel-tts", "kokoro"),
    resourcesPath ? path.join(resourcesPath, "novel-tts", "kokoro") : ""
  ].filter(Boolean);
}

export function resolveNovelTtsKokoroCandidates(options?: {
  resourcesPath?: string;
  userDataPath?: string;
  env?: NodeJS.ProcessEnv;
  homedir?: string;
}): NovelTtsKokoroLayout[] {
  const seen = new Set<string>();
  const roots: string[] = [];
  for (const rootDir of listNovelTtsKokoroRootHints(options)) {
    const key = rootDir.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    roots.push(rootDir);
  }
  return roots.map((rootDir) => ({
    rootDir,
    modelDir: path.join(rootDir, "model"),
    voicesDir: path.join(rootDir, "voices")
  }));
}

async function pathExists(target: string) {
  try {
    await access(target, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function findReadyNovelTtsKokoroLayout(options?: {
  resourcesPath?: string;
  userDataPath?: string;
  voiceId?: string;
  env?: NodeJS.ProcessEnv;
  homedir?: string;
}): Promise<NovelTtsKokoroLayout | null> {
  const voice = resolveNovelTtsVoice(options?.voiceId);
  const requiredVoices = [`${voice.kokoroVoice}.bin`];
  for (const layout of resolveNovelTtsKokoroCandidates(options)) {
    const modelMarker = path.join(layout.modelDir, "config.json");
    if (!(await pathExists(modelMarker))) continue;
    let allVoices = true;
    for (const voiceFile of requiredVoices) {
      if (!(await pathExists(path.join(layout.voicesDir, voiceFile)))) {
        allVoices = false;
        break;
      }
    }
    if (allVoices) return layout;
  }
  return null;
}

export function listRequiredKokoroVoiceFiles() {
  return [...NOVEL_TTS_KOKORO_VOICE_FILES];
}
