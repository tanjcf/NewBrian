/**
 * Resolve which model id to send for scene / shot media generation.
 * Never invent a hardcoded video model (e.g. hy-video-v1.5) when the caller
 * left model empty — prefer an explicit UI choice, then a video-capable
 * preference from model settings, otherwise leave blank for gateway Auto.
 * Literal aliases like "auto" / "smart" are treated as empty (gateway Auto).
 */
import {
  isImageGenerationCapableModel,
  isMusicCapableModel,
  isVideoCapableModel,
  type AuthorizedModelOption
} from "./model-auto-router.ts";

export type SceneMediaModelKind = "video" | "image" | "music";

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function isAutoAlias(value: string): boolean {
  const normalized = text(value).toLowerCase();
  return !normalized
    || normalized === "auto"
    || normalized === "smart"
    || normalized === "智能路由";
}

function isCapable(kind: SceneMediaModelKind, option: AuthorizedModelOption): boolean {
  if (kind === "video") return isVideoCapableModel(option);
  if (kind === "image") return isImageGenerationCapableModel(option);
  return isMusicCapableModel(option);
}

/**
 * Pick the model id for scene media generation without hardcoding a provider model.
 *
 * @param input.kind media channel
 * @param input.explicitModel value from pipeline UI / tool args (wins when non-empty and not Auto alias)
 * @param input.preferredModel desktop settings / composer model when it is media-capable
 * @param input.availableModels authorized catalog (capability-tagged)
 */
export function resolveSceneMediaModel(input: {
  kind: SceneMediaModelKind;
  explicitModel?: string;
  preferredModel?: string;
  availableModels?: AuthorizedModelOption[];
}): string {
  const explicit = text(input.explicitModel);
  if (explicit && !isAutoAlias(explicit)) return explicit;

  const available = Array.isArray(input.availableModels) ? input.availableModels : [];
  const preferred = text(input.preferredModel);
  if (preferred && !isAutoAlias(preferred)) {
    const match = available.find(
      (item) => text(item.model).toLowerCase() === preferred.toLowerCase()
    );
    if (match && isCapable(input.kind, match)) {
      return text(match.model);
    }
    // Preference string itself looks like a media model id even if catalog is stale.
    if (input.kind === "video" && isVideoCapableModel({ model: preferred, provider: "", label: preferred })) {
      return preferred;
    }
    if (input.kind === "image" && isImageGenerationCapableModel({ model: preferred, provider: "", label: preferred })) {
      return preferred;
    }
    if (input.kind === "music" && isMusicCapableModel({ model: preferred, provider: "", label: preferred })) {
      return preferred;
    }
  }

  // Do not hardcode hy-video-v1.5 (or any single model). Empty → gateway Auto among active models.
  return "";
}

/** Filter authorized models that can serve the given scene media kind. */
export function listSceneMediaModels(
  kind: SceneMediaModelKind,
  availableModels: AuthorizedModelOption[] | undefined
): AuthorizedModelOption[] {
  const available = Array.isArray(availableModels) ? availableModels : [];
  return available.filter((item) => isCapable(kind, item));
}
