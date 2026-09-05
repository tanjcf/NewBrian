import { extname } from "node:path";
import type {
  OpenComposerAttachmentInput,
  SaveComposerClipboardFileInput
} from "@codex-forge/protocol";
import { getAttachmentByteLimit } from "./attachment-security.ts";

function assertClipboardPayloadSize(data: ArrayBuffer, fileName: string) {
  const limit = getAttachmentByteLimit(extname(String(fileName || "")));
  if (data.byteLength > limit) {
    throw new Error(`Clipboard attachment exceeds the ${limit} byte limit.`);
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string") throw new TypeError(`${label} must be a string.`);
  if (value.length > maxLength) throw new TypeError(`${label} is too long.`);
  return value;
}

export function parseOpenComposerAttachmentInput(value: unknown): OpenComposerAttachmentInput {
  const input = record(value, "Open attachment input");
  const path = text(input.path, "Attachment path", 4_096).trim();
  if (!path) throw new TypeError("Attachment path is required.");
  return { path };
}

export function parseSaveComposerClipboardFileInput(value: unknown): SaveComposerClipboardFileInput {
  const input = record(value, "Clipboard file input");
  const name = text(input.name, "Clipboard file name", 512);
  const mimeType = text(input.mimeType, "Clipboard MIME type", 255);
  if (!(input.data instanceof ArrayBuffer)) throw new TypeError("Clipboard data must be an ArrayBuffer.");
  assertClipboardPayloadSize(input.data, name);
  return { name, mimeType, data: input.data };
}
