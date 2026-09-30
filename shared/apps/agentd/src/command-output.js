/**
 * Shell/tool output caps (keep these consistent across Tool Host + registry):
 * - maxCaptureBytes (2 MiB): former execFile maxBuffer; collectors never retain more
 *   than head+tail windows in memory even when processes emit more.
 * - maxVisibleBytes (256 KiB): model-facing stdout/stderr after head+tail assembly.
 * Oversized output returns a truncated result with a Chinese note; workers must not OOM/crash.
 */

export const COMMAND_OUTPUT_LIMITS = Object.freeze({
  /** Former Node execFile maxBuffer; hard capture budget before we stop retaining bytes. */
  maxCaptureBytes: 2 * 1024 * 1024,
  /** Maximum UTF-8 bytes returned to the model per stream (head + tail). */
  maxVisibleBytes: 256 * 1024,
  /** Prefix retained when truncating. */
  headBytes: 192 * 1024,
  /** Suffix retained when truncating. */
  tailBytes: 64 * 1024
});

const TRUNCATION_NOTE_RE = /输出过大，已保留开头与结尾/;

/**
 * Build a Chinese truncation note for the model (not a security deny).
 * @param {number} originalBytes
 * @param {number} visibleBytes
 */
export function formatOutputTruncationNote(originalBytes, visibleBytes) {
  const original = Math.max(0, Number(originalBytes) || 0);
  const visible = Math.max(0, Number(visibleBytes) || 0);
  return `…（输出过大，已保留开头与结尾共约 ${visible} 字节；完整约 ${original} 字节。并非安全策略拦截。请改用 workspace.search / workspace.glob / workspace.grep，或缩小命令输出范围后重试。）`;
}

/**
 * Keep the head and tail of a UTF-8 string/buffer within a byte budget.
 * @param {string | Buffer} value
 * @param {{ headBytes?: number, tailBytes?: number, maxVisibleBytes?: number }} [limits]
 */
export function truncateHeadTail(value, limits = {}) {
  const headBytes = limits.headBytes ?? COMMAND_OUTPUT_LIMITS.headBytes;
  const tailBytes = limits.tailBytes ?? COMMAND_OUTPUT_LIMITS.tailBytes;
  const maxVisibleBytes = limits.maxVisibleBytes ?? COMMAND_OUTPUT_LIMITS.maxVisibleBytes;
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(String(value ?? ""), "utf8");
  const originalBytes = buffer.length;
  if (originalBytes <= maxVisibleBytes && originalBytes <= headBytes + tailBytes) {
    return {
      text: buffer.toString("utf8"),
      truncated: false,
      originalBytes,
      visibleBytes: originalBytes
    };
  }

  const effectiveHead = Math.min(headBytes, Math.max(0, maxVisibleBytes - Math.min(tailBytes, originalBytes)));
  const effectiveTail = Math.min(tailBytes, Math.max(0, maxVisibleBytes - effectiveHead));
  const head = buffer.subarray(0, Math.min(effectiveHead, originalBytes));
  const tailStart = Math.max(head.length, originalBytes - effectiveTail);
  const tail = buffer.subarray(tailStart);
  const note = formatOutputTruncationNote(originalBytes, head.length + tail.length);
  const noteBuffer = Buffer.from(`\n\n${note}`, "utf8");
  const assembled = Buffer.concat([head, Buffer.from("\n\n…\n\n", "utf8"), tail, noteBuffer]);
  // If note pushes past budget, keep head+tail and append a short note only.
  let text;
  if (assembled.length <= maxVisibleBytes + noteBuffer.length + 16) {
    text = assembled.toString("utf8");
  } else {
    text = `${head.toString("utf8")}\n\n…\n\n${tail.toString("utf8")}\n\n${note}`;
  }
  return {
    text,
    truncated: true,
    originalBytes,
    visibleBytes: Buffer.byteLength(text, "utf8")
  };
}

/**
 * Streaming collector that never grows beyond head+tail windows.
 * @param {{ headBytes?: number, tailBytes?: number, maxCaptureBytes?: number }} [limits]
 */
export function createBoundedStreamCollector(limits = {}) {
  const headLimit = limits.headBytes ?? COMMAND_OUTPUT_LIMITS.headBytes;
  const tailLimit = limits.tailBytes ?? COMMAND_OUTPUT_LIMITS.tailBytes;
  const maxCapture = limits.maxCaptureBytes ?? COMMAND_OUTPUT_LIMITS.maxCaptureBytes;
  /** @type {Buffer[]} */
  const headChunks = [];
  /** @type {Buffer[]} */
  const tailChunks = [];
  let headBytes = 0;
  let tailBytes = 0;
  let totalBytes = 0;
  let truncated = false;

  const pushTail = (chunk) => {
    if (!chunk.length) return;
    tailChunks.push(chunk);
    tailBytes += chunk.length;
    while (tailBytes > tailLimit && tailChunks.length > 1) {
      const dropped = tailChunks.shift();
      tailBytes -= dropped.length;
      truncated = true;
    }
    if (tailBytes > tailLimit && tailChunks.length === 1) {
      const only = tailChunks[0];
      const trimmed = only.subarray(only.length - tailLimit);
      tailChunks[0] = trimmed;
      tailBytes = trimmed.length;
      truncated = true;
    }
  };

  return {
    write(chunk) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (!buffer.length) return;
      totalBytes += buffer.length;
      if (totalBytes > maxCapture) truncated = true;

      if (headBytes < headLimit) {
        const remaining = headLimit - headBytes;
        if (buffer.length <= remaining) {
          headChunks.push(buffer);
          headBytes += buffer.length;
          return;
        }
        headChunks.push(buffer.subarray(0, remaining));
        headBytes = headLimit;
        truncated = true;
        pushTail(buffer.subarray(remaining));
        return;
      }

      truncated = true;
      pushTail(buffer);
    },
    finish(decode = (buf) => buf.toString("utf8")) {
      const head = Buffer.concat(headChunks, headBytes);
      const tail = Buffer.concat(tailChunks, Math.min(tailBytes, tailLimit));
      const full = truncated || totalBytes > headLimit + tailLimit
        ? null
        : Buffer.concat([head, tail], head.length + tail.length);
      if (!truncated && full) {
        const text = decode(full);
        return {
          text,
          truncated: false,
          originalBytes: totalBytes,
          visibleBytes: Buffer.byteLength(text, "utf8")
        };
      }
      // Decode head/tail separately then assemble with note.
      const headText = decode(head);
      const tailText = decode(tail);
      const note = formatOutputTruncationNote(totalBytes, Buffer.byteLength(headText, "utf8") + Buffer.byteLength(tailText, "utf8"));
      const text = `${headText}\n\n…\n\n${tailText}\n\n${note}`;
      return {
        text,
        truncated: true,
        originalBytes: totalBytes,
        visibleBytes: Buffer.byteLength(text, "utf8")
      };
    },
    get totalBytes() {
      return totalBytes;
    },
    get truncated() {
      return truncated || totalBytes > headLimit + tailLimit;
    }
  };
}

export function hasTruncationNote(text = "") {
  return TRUNCATION_NOTE_RE.test(String(text ?? ""));
}
