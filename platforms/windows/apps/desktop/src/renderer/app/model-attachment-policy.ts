import type { ComposerAttachment } from "@codex-forge/protocol";

/** Keeps renderer previews local while sending only a bounded managed URL across model IPC. */
export function compactModelAttachment(attachment: ComposerAttachment): ComposerAttachment {
  if (!attachment.url.startsWith("data:")) return attachment;
  const fileName = attachment.path.split(/[\\/]/).pop() || attachment.name;
  return {
    ...attachment,
    url: `newbrain-attachment://media/${encodeURIComponent(fileName)}`
  };
}
