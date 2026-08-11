import { promises as fs } from "node:fs";

export async function extractTextAttachment(filePath: string, extension: string) {
  if (extension === ".pdf" || extension === ".docx" || extension === ".xlsx" || extension === ".xls") {
    throw new Error(`Attachment extraction for ${extension} is not yet available on macOS desktop.`);
  }
  const maxTextBytes = 512 * 1024;
  const stat = await fs.stat(filePath);
  const handle = await fs.open(filePath, "r");
  try {
    const bytesToRead = Math.min(stat.size, maxTextBytes);
    const buffer = Buffer.alloc(bytesToRead);
    const { bytesRead } = await handle.read(buffer, 0, bytesToRead, 0);
    const content = buffer.subarray(0, bytesRead).toString("utf8");
    return stat.size > maxTextBytes
      ? `${content}\n\n[Attachment truncated after ${maxTextBytes} bytes.]`
      : content;
  } finally {
    await handle.close();
  }
}
