import {
  isModelAutoSelection,
  isVisionCapableModel,
  modelSupportsImageInput,
  type AuthorizedModelOption
} from "./model-auto-router.ts";

/**
 * Codex: keep image bytes on the message that contained them.
 * The selected model receives them when it supports image input.
 * Otherwise the image is omitted. A later turn does not call a vision model.
 */
export type ImageHandleMode = "native" | "omit";

export type NativeResolvedImage = {
  kind: "native";
  header: string;
  mimeType: string;
  dataUrl: string;
};

export type BridgedResolvedImage = {
  kind: "bridged";
  header: string;
  description: string;
  visionModel: string;
  source: "remote" | "local";
};

export type OmittedResolvedImage = {
  kind: "omitted";
  header: string;
  text: string;
};

export type ResolvedTurnImage = NativeResolvedImage | BridgedResolvedImage | OmittedResolvedImage;

/** Codex `UnsupportedMedia::IMAGE` placeholder. */
export const IMAGE_OMITTED_UNSUPPORTED =
  "image content omitted because you do not support image input";

/** Shown when the main model cannot take images and no remote/local describe bridge works. */
export const NO_IMAGE_BRIDGE_MESSAGE =
  "当前所选模型不支持直接识图，且没有可用的识图桥接（远程视觉模型或本地视觉服务）。请改用支持视觉的模型（如 *-vl* / vision），配置识图桥接模型，或启动本地视觉服务。";

export const IMAGE_DESCRIBE_PROMPT_ZH =
  "请用中文准确描述这张图片中可见的主体、颜色、场景、布局以及所有可读文字。不要推断图片中未直接显示的内容。";

/**
 * Native image parts when the model that will receive this turn supports image input.
 * Auto follows the parent-selected model. A vision model elsewhere in the catalog
 * does not keep image bytes, and does not start a side vision call.
 */
export function resolveImageHandleMode(
  mainModel: Pick<AuthorizedModelOption, "model" | "provider" | "capabilities" | "label" | "routing">,
  options?: {
    requestedModel?: string;
    availableModels?: AuthorizedModelOption[];
    parentSelectedModel?: string;
  }
): ImageHandleMode {
  const requested = String(options?.requestedModel || mainModel.model || "").trim();
  if (isModelAutoSelection(requested)) {
    const parentSelected = String(options?.parentSelectedModel || "").trim();
    if (!parentSelected) return "omit";
    const pool = options?.availableModels ?? [];
    const selected =
      pool.find((item) => item.model.trim().toLowerCase() === parentSelected.toLowerCase())
      ?? { model: parentSelected, provider: "", label: parentSelected };
    return modelSupportsImageInput(selected) ? "native" : "omit";
  }
  return modelSupportsImageInput(mainModel) ? "native" : "omit";
}

/**
 * Prefer an explicitly configured bridge vision model, else the first vision-capable
 * authorized catalog entry. Never returns DeepSeek (filtered by isVisionCapableModel).
 */
export function pickBridgeVisionModel(
  availableModels: AuthorizedModelOption[],
  preferredModel?: string | null
): AuthorizedModelOption | undefined {
  const vision = availableModels.filter((item) => isVisionCapableModel(item));
  if (!vision.length) return undefined;
  const preferred = String(preferredModel || "").trim().toLowerCase();
  if (preferred) {
    const hit = vision.find((item) => item.model.trim().toLowerCase() === preferred);
    if (hit) return hit;
  }
  return vision[0];
}

export function resolvePreferredBridgeVisionModelFromEnv(
  environment: NodeJS.ProcessEnv = process.env
): string | undefined {
  const configured =
    environment.NEWBRAIN_BRIDGE_VISION_MODEL?.trim()
    || environment.NEWBRAIN_DEFAULT_VISION_MODEL?.trim()
    || "";
  return configured || undefined;
}

export type TurnImageInput = {
  name: string;
  path: string;
  mimeType: string;
  header: string;
  readBytes: () => Promise<Buffer>;
};

export type DescribeImageForBridge = (input: {
  filePath: string;
  mimeType: string;
  dataUrl: string;
  bridgeModel?: AuthorizedModelOption;
}) => Promise<{ description: string; visionModel: string; source: "remote" | "local" }>;

/**
 * Resolve current-turn images for the selected main chat model.
 * Does not switch the user's main model — only chooses native parts vs describe-bridge text.
 */
export async function resolveTurnImages(input: {
  mainModel: Pick<AuthorizedModelOption, "model" | "provider" | "capabilities" | "label" | "routing">;
  images: TurnImageInput[];
  availableModels?: AuthorizedModelOption[];
  preferredBridgeModel?: string | null;
  /** Composer / outbound model id (may be {@code auto}). */
  requestedModel?: string;
  /** Parent Auto advisory selection (e.g. kimi-k2.6) used only for native vs bridge. */
  parentSelectedModel?: string;
  describeImage: DescribeImageForBridge;
}): Promise<{ mode: ImageHandleMode; images: ResolvedTurnImage[] }> {
  const mode = resolveImageHandleMode(input.mainModel, {
    requestedModel: input.requestedModel,
    availableModels: input.availableModels,
    parentSelectedModel: input.parentSelectedModel
  });
  if (!input.images.length) {
    return { mode, images: [] };
  }

  if (mode === "native") {
    const images: NativeResolvedImage[] = [];
    for (const image of input.images) {
      const bytes = await image.readBytes();
      images.push({
        kind: "native",
        header: image.header,
        mimeType: image.mimeType,
        dataUrl: `data:${image.mimeType};base64,${bytes.toString("base64")}`
      });
    }
    return { mode, images };
  }

  const images: OmittedResolvedImage[] = input.images.map((image) => ({
    kind: "omitted",
    header: image.header,
    text: IMAGE_OMITTED_UNSUPPORTED
  }));
  return { mode, images };
}

/** Format bridged descriptions into attachment text blocks for the text-only main model. */
export function formatBridgedImageText(image: BridgedResolvedImage): string {
  const sourceLabel = image.source === "remote" ? "远程识图桥接" : "本地识图桥接";
  return `${image.header}\n${sourceLabel}（${image.visionModel}）：\n${image.description}`;
}
