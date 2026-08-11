/** Shared guide / steer payload normalization for mid-run user guidance. */

export type GuideDelivery = "steer" | "followup" | "interrupt";

export interface GuideAttachment {
  name: string;
  path: string;
  url?: string;
}

export interface GuideRequestInput {
  message: string;
  attachments?: GuideAttachment[];
  delivery?: GuideDelivery;
}

export interface NormalizedGuideRequest {
  message: string;
  attachments: GuideAttachment[];
  delivery: GuideDelivery;
}

export type SteerAgentPayload =
  | string
  | {
      content?: string;
      message?: string;
      attachments?: GuideAttachment[];
    };

function normalizeAttachments(value: unknown): GuideAttachment[] {
  if (!Array.isArray(value)) return [];
  const attachments: GuideAttachment[] = [];
  for (const item of value.slice(0, 8)) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const path = typeof record.path === "string" ? record.path.trim() : "";
    if (!path) continue;
    const name = typeof record.name === "string" && record.name.trim()
      ? record.name.trim()
      : path.split(/[\\/]/).pop() || "attachment";
    const url = typeof record.url === "string" ? record.url : undefined;
    attachments.push(url ? { name, path, url } : { name, path });
  }
  return attachments;
}

export function normalizeGuideRequest(input: unknown): NormalizedGuideRequest {
  if (typeof input === "string") {
    return { message: input.trim(), attachments: [], delivery: "steer" };
  }
  if (!input || typeof input !== "object") {
    return { message: "", attachments: [], delivery: "steer" };
  }
  const record = input as Record<string, unknown>;
  const message = typeof record.message === "string"
    ? record.message.trim()
    : typeof record.content === "string"
      ? record.content.trim()
      : "";
  const delivery = record.delivery === "followup" || record.delivery === "interrupt"
    ? record.delivery
    : "steer";
  return {
    message,
    attachments: normalizeAttachments(record.attachments),
    delivery
  };
}

export function toSteerAgentPayload(guide: Pick<NormalizedGuideRequest, "message" | "attachments">): SteerAgentPayload {
  if (!guide.attachments.length) return guide.message;
  return {
    content: guide.message,
    attachments: guide.attachments
  };
}

export function isGuidePayloadEmpty(guide: Pick<NormalizedGuideRequest, "message" | "attachments">) {
  return !guide.message && guide.attachments.length === 0;
}
