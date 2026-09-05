import { ipcMain } from "electron";
import type { VideoVoiceAnalysisInput, VideoVoiceCasting } from "@codex-forge/protocol/brain-video-runtime";
import {
  desktopIpcChannels,
  type OpenLogLocationResult,
  type OpenSkillLocationInput,
  type OpenSystemToolInput,
  type RendererDiagnosticInput,
  type RendererFailureInput,
  type SynthesizeNovelSpeechInput,
  type SynthesizeNovelSpeechResult,
  type SystemOpenResult,
  type SystemToolEntry
} from "@codex-forge/protocol";

type MaybePromise<T> = T | Promise<T>;

interface SystemIpcServices {
  analyzeVideoVoices?: (input: VideoVoiceAnalysisInput) => Promise<VideoVoiceCasting>;
  getTools: () => MaybePromise<SystemToolEntry[]>;
  openTool: (input: OpenSystemToolInput) => MaybePromise<SystemOpenResult>;
  openSkillLocation: (input: OpenSkillLocationInput) => MaybePromise<SystemOpenResult>;
  openLogLocation: () => MaybePromise<OpenLogLocationResult>;
  reportRendererFailure: (input: RendererFailureInput) => MaybePromise<{ ok: boolean; id: string }>;
  reportRendererDiagnostic: (input: RendererDiagnosticInput) => MaybePromise<{ ok: boolean; id: string }>;
  synthesizeNovelSpeech: (input: SynthesizeNovelSpeechInput) => MaybePromise<SynthesizeNovelSpeechResult>;
  cancelNovelSpeech: () => MaybePromise<{ ok: boolean }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseOpenToolInput(input: unknown): OpenSystemToolInput {
  if (typeof input === "string") {
    return { toolId: input };
  }
  if (!isRecord(input)
    || typeof input.toolId !== "string"
    || (input.workspaceId !== undefined && typeof input.workspaceId !== "string")) {
    throw new TypeError("System tool input is invalid.");
  }
  return { toolId: input.toolId, workspaceId: input.workspaceId };
}

function parseOpenSkillInput(input: unknown): OpenSkillLocationInput {
  if (!isRecord(input)
    || (input.id !== undefined && typeof input.id !== "string")
    || (input.name !== undefined && typeof input.name !== "string")) {
    throw new TypeError("Skill location input is invalid.");
  }
  return { id: input.id, name: input.name };
}

export function parseRendererFailureInput(input: unknown): RendererFailureInput {
  if (!isRecord(input)
    || !["renderer_error", "renderer_unhandled_rejection", "renderer_bootstrap_error"].includes(String(input.kind))
    || typeof input.message !== "string"
    || (input.stackTrace !== undefined && typeof input.stackTrace !== "string")
    || (input.context !== undefined && !isRecord(input.context))) {
    throw new TypeError("Renderer failure input is invalid.");
  }
  return {
    kind: input.kind as RendererFailureInput["kind"],
    message: input.message,
    stackTrace: input.stackTrace,
    context: input.context
  };
}

export function parseRendererDiagnosticInput(input: unknown): RendererDiagnosticInput {
  if (!isRecord(input)
    || typeof input.kind !== "string"
    || !input.kind.trim()
    || input.kind.length > 80
    || typeof input.message !== "string"
    || (input.stackTrace !== undefined && typeof input.stackTrace !== "string")
    || (input.context !== undefined && !isRecord(input.context))) {
    throw new TypeError("Renderer diagnostic input is invalid.");
  }
  return {
    kind: input.kind.trim(),
    message: input.message,
    stackTrace: input.stackTrace,
    context: input.context
  };
}

export function parseSynthesizeNovelSpeechInput(input: unknown): SynthesizeNovelSpeechInput {
  if (!isRecord(input)
    || typeof input.text !== "string"
    || !input.text.trim()
    || input.text.length > 20_000
    || typeof input.voiceId !== "string"
    || !input.voiceId.trim()
    || input.voiceId.length > 80
    || (input.voiceLabel !== undefined && typeof input.voiceLabel !== "string")
    || (input.playback !== undefined && typeof input.playback !== "boolean")) {
    throw new TypeError("Novel speech input is invalid.");
  }
  return {
    text: input.text,
    voiceId: input.voiceId.trim(),
    voiceLabel: typeof input.voiceLabel === "string" ? input.voiceLabel : undefined,
    playback: typeof input.playback === "boolean" ? input.playback : undefined
  };
}

/** Register native system capabilities behind validated, data-only IPC contracts. */
export function registerSystemIpcHandlers(services: SystemIpcServices) {
  ipcMain.handle(desktopIpcChannels.system.analyzeVideoVoices, (_event, input: unknown) => {
    if (!isRecord(input) || typeof input.script !== "string" || input.script.length > 40000
      || !Array.isArray(input.shots) || input.shots.length > 200
      || input.shots.some(s => !isRecord(s) || typeof s.id !== "string" || typeof s.line !== "string" || s.line.length > 4000 || typeof s.title !== "string")
      || (input.preference !== undefined && (typeof input.preference !== "string" || input.preference.length > 2000))) throw new TypeError("剧本分析输入无效。");
    if (!services.analyzeVideoVoices) throw new Error("当前平台未接入角色配音分析。");
    return services.analyzeVideoVoices(input as unknown as VideoVoiceAnalysisInput);
  });
  const channels = [
    ["system.getTools", desktopIpcChannels.system.getTools],
    ["system.openTool", desktopIpcChannels.system.openTool],
    ["system.openSkillLocation", desktopIpcChannels.system.openSkillLocation],
    ["system.openLogLocation", desktopIpcChannels.system.openLogLocation],
    ["system.reportRendererFailure", desktopIpcChannels.system.reportRendererFailure],
    ["system.reportRendererDiagnostic", desktopIpcChannels.system.reportRendererDiagnostic],
    ["system.synthesizeNovelSpeech", desktopIpcChannels.system.synthesizeNovelSpeech],
    ["system.cancelNovelSpeech", desktopIpcChannels.system.cancelNovelSpeech]
  ] as const;
  for (const [name, channel] of channels) {
    if (typeof channel !== "string" || !channel.trim()) {
      throw new Error(`Missing IPC channel ${name}. Rebuild @codex-forge/protocol before packaging.`);
    }
  }

  ipcMain.handle(desktopIpcChannels.system.getTools, () => services.getTools());
  ipcMain.handle(desktopIpcChannels.system.openTool, (_event, input: unknown) =>
    services.openTool(parseOpenToolInput(input))
  );
  ipcMain.handle(desktopIpcChannels.system.openSkillLocation, (_event, input: unknown) =>
    services.openSkillLocation(parseOpenSkillInput(input))
  );
  ipcMain.handle(desktopIpcChannels.system.openLogLocation, () => services.openLogLocation());
  ipcMain.handle(desktopIpcChannels.system.reportRendererFailure, (_event, input: unknown) =>
    services.reportRendererFailure(parseRendererFailureInput(input))
  );
  ipcMain.handle(desktopIpcChannels.system.reportRendererDiagnostic, (_event, input: unknown) =>
    services.reportRendererDiagnostic(parseRendererDiagnosticInput(input))
  );
  ipcMain.handle(desktopIpcChannels.system.synthesizeNovelSpeech, (_event, input: unknown) =>
    services.synthesizeNovelSpeech(parseSynthesizeNovelSpeechInput(input))
  );
  ipcMain.handle(desktopIpcChannels.system.cancelNovelSpeech, () => services.cancelNovelSpeech());
}
