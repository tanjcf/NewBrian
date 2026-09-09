import { promises as fs } from "node:fs";
import type { AuthorizedModelOption } from "./model-auto-router.ts";
import {
  extractResponsesText,
  extractResponsesTextFromSse
} from "./model-gateway-protocol.ts";
import { IMAGE_DESCRIBE_PROMPT_ZH } from "./turn-image-resolution.ts";

export type ImageDescribeResult = {
  description: string;
  visionModel: string;
  source: "remote" | "local";
};

export type RemoteImageDescribeDependencies = {
  apiUrl: string;
  bearerToken: string;
  model: string;
  dataUrl: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
};

/**
 * Describe an image via spring-app `/v1/responses` using a vision-capable catalog model.
 * Uses non-streaming so the bridge can await a single description.
 */
export async function describeImageWithRemoteVision(
  input: RemoteImageDescribeDependencies
): Promise<ImageDescribeResult> {
  const model = input.model.trim();
  if (!model) {
    throw new Error("远程识图桥接未指定视觉模型。");
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(input.apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.bearerToken}`
      },
      signal: input.signal,
      body: JSON.stringify({
        model,
        stream: false,
        store: false,
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: IMAGE_DESCRIBE_PROMPT_ZH },
              { type: "input_image", image_url: input.dataUrl }
            ]
          }
        ]
      })
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`远程识图桥接请求失败：${detail}`);
  }

  const rawText = await response.text();
  let parsed: unknown = null;
  try {
    parsed = rawText ? JSON.parse(rawText) : null;
  } catch {
    parsed = null;
  }
  if (!response.ok) {
    const message =
      parsed && typeof parsed === "object" && typeof (parsed as { message?: unknown }).message === "string"
        ? String((parsed as { message: string }).message)
        : rawText.slice(0, 400) || `HTTP ${response.status}`;
    throw new Error(`远程识图桥接失败（${response.status}）：${message}`);
  }

  const description =
    extractResponsesText(parsed)
    || extractResponsesTextFromSse(rawText)
    || "";
  const trimmed = description.trim();
  if (!trimmed) {
    throw new Error("远程识图桥接返回了空描述。");
  }
  return { description: trimmed, visionModel: model, source: "remote" };
}

export type LocalImageDescribeDependencies = {
  filePath: string;
  baseUrl?: string;
  visionModel?: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  environment?: NodeJS.ProcessEnv;
};

/** Optional local Ollama (or compatible) vision sidecar — OpenClaw-style fallback bridge. */
export async function describeImageWithLocalVision(
  input: LocalImageDescribeDependencies
): Promise<ImageDescribeResult> {
  const environment = input.environment ?? process.env;
  const baseUrl = (
    input.baseUrl?.trim()
    || environment.NEWBRAIN_VISION_BASE_URL?.trim()
    || "http://127.0.0.1:11434"
  ).replace(/\/+$/, "");
  const visionModel =
    input.visionModel?.trim()
    || environment.NEWBRAIN_VISION_MODEL?.trim()
    || "qwen3.5:latest";
  const image = (await fs.readFile(input.filePath)).toString("base64");
  const fetchImpl = input.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: visionModel,
        stream: false,
        messages: [{
          role: "user",
          content: IMAGE_DESCRIBE_PROMPT_ZH,
          images: [image]
        }]
      }),
      signal: input.signal
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `本地识图服务不可用（${baseUrl}）：${detail}。请改用支持视觉的模型，或启动本地视觉服务。`
    );
  }
  if (!response.ok) {
    throw new Error(`本地识图模型请求失败（${response.status}）。`);
  }
  const payload = await response.json() as { message?: { content?: unknown } };
  const description = typeof payload.message?.content === "string" ? payload.message.content.trim() : "";
  if (!description) {
    throw new Error("本地识图模型返回了空描述。");
  }
  return { description, visionModel, source: "local" };
}

export function isLocalVisionBridgeDisabled(environment: NodeJS.ProcessEnv = process.env): boolean {
  const flag = String(environment.NEWBRAIN_VISION_BRIDGE_LOCAL || "").trim().toLowerCase();
  return flag === "0" || flag === "false" || flag === "off";
}

/**
 * Prefer remote catalog vision model, then optional local Ollama.
 * Never pretends DeepSeek is a remote vision endpoint.
 */
export async function describeImageForBridge(input: {
  filePath: string;
  mimeType: string;
  dataUrl: string;
  bridgeModel?: AuthorizedModelOption;
  remote?: {
    apiUrl: string;
    bearerToken: string;
    signal?: AbortSignal;
    fetchImpl?: typeof fetch;
  };
  local?: {
    enabled?: boolean;
    baseUrl?: string;
    visionModel?: string;
    signal?: AbortSignal;
    fetchImpl?: typeof fetch;
    environment?: NodeJS.ProcessEnv;
  };
}): Promise<ImageDescribeResult> {
  const errors: string[] = [];
  if (input.bridgeModel && input.remote?.apiUrl && input.remote.bearerToken) {
    try {
      return await describeImageWithRemoteVision({
        apiUrl: input.remote.apiUrl,
        bearerToken: input.remote.bearerToken,
        model: input.bridgeModel.model,
        dataUrl: input.dataUrl,
        signal: input.remote.signal,
        fetchImpl: input.remote.fetchImpl
      });
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  } else if (!input.bridgeModel) {
    errors.push("授权模型目录中没有可用的远程视觉模型。");
  }

  const environment = input.local?.environment ?? process.env;
  const localEnabled = input.local?.enabled ?? !isLocalVisionBridgeDisabled(environment);
  if (localEnabled) {
    try {
      return await describeImageWithLocalVision({
        filePath: input.filePath,
        baseUrl: input.local?.baseUrl,
        visionModel: input.local?.visionModel,
        signal: input.local?.signal,
        fetchImpl: input.local?.fetchImpl,
        environment
      });
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  } else {
    errors.push("本地识图桥接已关闭。");
  }

  throw new Error(errors.filter(Boolean).join("；") || "识图桥接不可用。");
}
