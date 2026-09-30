export function boundSoftwareOutput(stdout: string, stderr: string, maxBytes = 64 * 1024) {
  const output = `${stdout}\n${stderr}`.trim();
  const bytes = Buffer.from(output, "utf8");
  if (bytes.byteLength <= maxBytes) return output;
  let start = bytes.byteLength - maxBytes;
  while (start < bytes.byteLength && (bytes[start]! & 0xc0) === 0x80) start += 1;
  return bytes.subarray(start).toString("utf8");
}
export function mapSoftwareResponse(status: string, success: unknown, _errorCode = "") { if (status === "cancelled") return "CANCELLED" as const; if (status !== "completed" || success === false) return "FAILED" as const; return "SUCCEEDED" as const; }
