export const CUSTOM_MODEL_ID_PREFIX = "custom:";
export const CUSTOM_MODEL_ENDPOINT_LIMIT = 20;

const CUSTOM_MODEL_ID_PATTERN = /^custom:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type CustomModelWireApi = "chat.completions" | "responses";

export interface CustomModelEndpointPublic {
  id: string;
  label: string;
  baseUrl: string;
  model: string;
  wireApi: CustomModelWireApi;
}

export interface CustomModelEndpointSnapshot {
  endpoints: CustomModelEndpointPublic[];
  selectedId: string;
}

export interface CustomModelEndpointDraft {
  label: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export class CustomModelEndpointError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CustomModelEndpointError";
    this.code = code;
  }
}

export function isCustomModelSelection(modelId: string) {
  return modelId.trim().toLowerCase().startsWith(CUSTOM_MODEL_ID_PREFIX);
}

export function isCustomModelEndpointId(modelId: string) {
  return CUSTOM_MODEL_ID_PATTERN.test(modelId.trim());
}

/** Keeps a session selection that is not part of the subscription catalog. */
export function preserveCustomModelSelection(currentModel: string) {
  const trimmed = currentModel.trim();
  return isCustomModelSelection(trimmed) ? trimmed : "";
}

export function normalizeCustomModelBaseUrl(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    throw new CustomModelEndpointError("CUSTOM_MODEL_URL_REQUIRED", "请填写 Base URL。");
  }
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new CustomModelEndpointError("CUSTOM_MODEL_URL_INVALID", "Base URL 不是有效地址。");
  }
  const host = url.hostname.toLowerCase();
  const localHost = host === "localhost" || host === "127.0.0.1" || host === "::1";
  if (url.username || url.password) {
    throw new CustomModelEndpointError("CUSTOM_MODEL_URL_INVALID", "Base URL 不能携带账号或密码。");
  }
  if (url.protocol === "http:") {
    if (!localHost) {
      throw new CustomModelEndpointError(
        "CUSTOM_MODEL_URL_INVALID",
        "地址只接受 https，或本机的 http://127.0.0.1 与 http://localhost。"
      );
    }
  } else if (url.protocol !== "https:") {
    throw new CustomModelEndpointError(
      "CUSTOM_MODEL_URL_INVALID",
      "地址只接受 https，或本机的 http://127.0.0.1 与 http://localhost。"
    );
  }
  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/+$/, "");
}

export function normalizeCustomModelEndpointDraft(input: {
  label: unknown;
  baseUrl: unknown;
  apiKey: unknown;
  model: unknown;
}): CustomModelEndpointDraft {
  if (typeof input.label !== "string" || !input.label.trim()) {
    throw new CustomModelEndpointError("CUSTOM_MODEL_LABEL_REQUIRED", "请填写显示名。");
  }
  if (input.label.trim().length > 80) {
    throw new CustomModelEndpointError("CUSTOM_MODEL_LABEL_REQUIRED", "显示名过长。");
  }
  if (typeof input.model !== "string" || !input.model.trim()) {
    throw new CustomModelEndpointError("CUSTOM_MODEL_ID_REQUIRED", "请填写模型 ID。");
  }
  if (input.model.trim().length > 256 || /[\r\n]/.test(input.model)) {
    throw new CustomModelEndpointError("CUSTOM_MODEL_ID_REQUIRED", "模型 ID 无效。");
  }
  if (typeof input.apiKey !== "string" || !input.apiKey.trim()) {
    throw new CustomModelEndpointError("CUSTOM_MODEL_KEY_REQUIRED", "请填写 API Key。");
  }
  if (input.apiKey.trim().length > 32_768) {
    throw new CustomModelEndpointError("CUSTOM_MODEL_KEY_REQUIRED", "API Key 过长。");
  }
  return {
    label: input.label.trim(),
    baseUrl: normalizeCustomModelBaseUrl(input.baseUrl),
    apiKey: input.apiKey.trim(),
    model: input.model.trim()
  };
}
