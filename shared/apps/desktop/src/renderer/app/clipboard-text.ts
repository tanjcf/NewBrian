const CLIPBOARD_CHANNEL_LIMIT = 2_000_000;

type ClipboardBridge = {
  writeClipboardText?: (text: string) => Promise<unknown>;
};

function clipboardBridge(): ClipboardBridge | null {
  const host = globalThis as typeof globalThis & {
    window?: { newbrain?: ClipboardBridge };
    newbrain?: ClipboardBridge;
  };
  return host.window?.newbrain ?? host.newbrain ?? null;
}

function copyWithSelection(value: string) {
  const doc = globalThis.document;
  if (!doc?.body || typeof doc.execCommand !== "function") return false;
  const area = doc.createElement("textarea");
  area.value = value;
  area.setAttribute("readonly", "true");
  area.style.position = "fixed";
  area.style.top = "0";
  area.style.left = "0";
  area.style.opacity = "0";
  doc.body.appendChild(area);
  area.focus();
  area.select();
  let copied = false;
  try {
    copied = doc.execCommand("copy");
  } catch {
    copied = false;
  }
  area.remove();
  return copied;
}

/** Copy text without requiring the page to own focus. */
export async function copyTextToClipboard(text: string) {
  const value = String(text ?? "");
  if (value.length > CLIPBOARD_CHANNEL_LIMIT) {
    throw new Error("内容太长，无法复制。");
  }
  const bridge = clipboardBridge();
  if (typeof bridge?.writeClipboardText === "function") {
    await bridge.writeClipboardText(value);
    return;
  }
  const nav = globalThis.navigator;
  if (nav?.clipboard?.writeText && globalThis.document?.hasFocus?.() !== false) {
    try {
      await nav.clipboard.writeText(value);
      return;
    } catch {
      // Fall through when the document is not focused.
    }
  }
  if (!copyWithSelection(value)) {
    throw new Error("复制失败，请先点一下窗口再试。");
  }
}
