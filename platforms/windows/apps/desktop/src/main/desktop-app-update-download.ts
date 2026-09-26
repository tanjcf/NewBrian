import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { rm, stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

/** Parsed `Content-Range: bytes start-end/total` values. */
export interface ParsedContentRange {
  start: number;
  end: number;
  total: number;
}

/** Progress snapshot while streaming an update package to disk. */
export interface ResumableDownloadProgress {
  receivedBytes: number;
  totalBytes: number;
  resumedFrom: number;
}

/** Result of a resumable download attempt. */
export interface ResumableDownloadResult {
  bytesOnDisk: number;
  totalBytes: number;
  resumedFrom: number;
  httpStatus: number;
}

/** Parse a single HTTP Content-Range header into byte offsets. */
export function parseContentRange(header: string | null | undefined): ParsedContentRange | null {
  const match = /^bytes\s+(\d+)-(\d+)\/(\d+|\*)\s*$/i.exec(String(header || "").trim());
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = match[3] === "*" ? 0 : Number(match[3]);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start) {
    return null;
  }
  return {
    start,
    end,
    total: Number.isFinite(total) && total > 0 ? total : 0
  };
}

/** Read existing partial byte length; missing/empty files return 0. */
export async function readPartialByteLength(partialPath: string): Promise<number> {
  try {
    const info = await stat(partialPath);
    if (!info.isFile() || info.size <= 0) return 0;
    return info.size;
  } catch {
    return 0;
  }
}

/** Stream a file through SHA-256 without buffering the whole payload in memory. */
export async function sha256FileStreaming(path: string): Promise<string> {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    digest.update(chunk as Buffer);
  }
  return digest.digest("hex");
}

function buildDownloadHeaders(
  existingBytes: number,
  url = "",
  packagePreference?: "msi" | "nsis"
): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/octet-stream,*/*"
  };
  if (existingBytes > 0) {
    headers.Range = `bytes=${existingBytes}-`;
  }
  // Match Spring dual-pack download to the running install layout.
  if (/\/api\/desktop\/v1\/app-releases\/[^/]+\/download/i.test(url) && !/[?&]package=/i.test(url)) {
    headers["X-Desktop-Package-Preference"] = packagePreference || "msi";
  }
  return headers;
}

async function cancelBody(response: Response) {
  try {
    await response.body?.cancel();
  } catch {
    // ignore
  }
}

async function fetchInstallerResponse(
  fetchImpl: typeof fetch,
  url: string,
  existingBytes: number,
  packagePreference?: "msi" | "nsis"
): Promise<Response> {
  return fetchImpl(url, {
    method: "GET",
    headers: buildDownloadHeaders(existingBytes, url, packagePreference)
  });
}

/**
 * Download a large installer to a stable `.partial` path with HTTP Range resume.
 * Streams to disk (append on 206, rewrite on 200). Never loads the whole body into RAM.
 */
export async function downloadResumableToFile(input: {
  url: string;
  partialPath: string;
  fetchImpl?: typeof fetch;
  onProgress?: (progress: ResumableDownloadProgress) => void;
  packagePreference?: "msi" | "nsis";
}): Promise<ResumableDownloadResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  let existingBytes = await readPartialByteLength(input.partialPath);

  let response = await fetchInstallerResponse(
    fetchImpl,
    input.url,
    existingBytes,
    input.packagePreference
  );

  // Range not satisfiable (stale/oversized partial) → discard and restart.
  if (response.status === 416 && existingBytes > 0) {
    await cancelBody(response);
    await rm(input.partialPath, { force: true }).catch(() => undefined);
    existingBytes = 0;
    response = await fetchInstallerResponse(fetchImpl, input.url, 0, input.packagePreference);
  }

  if (!(response.status === 200 || response.status === 206) || !response.body) {
    await cancelBody(response);
    throw new Error(`下载更新失败：HTTP ${response.status}`);
  }

  let append = false;
  let resumedFrom = 0;

  if (response.status === 206) {
    const contentRange = parseContentRange(response.headers.get("content-range"));
    if (contentRange && contentRange.start !== existingBytes) {
      await cancelBody(response);
      await rm(input.partialPath, { force: true }).catch(() => undefined);
      existingBytes = 0;
      response = await fetchInstallerResponse(fetchImpl, input.url, 0, input.packagePreference);
      if (!(response.status === 200 || response.status === 206) || !response.body) {
        await cancelBody(response);
        throw new Error(`下载更新失败：HTTP ${response.status}`);
      }
      append = false;
      resumedFrom = 0;
    } else {
      append = existingBytes > 0;
      resumedFrom = existingBytes;
    }
  } else {
    // 200: server ignored Range or full body — rewrite from byte 0.
    if (existingBytes > 0) {
      await rm(input.partialPath, { force: true }).catch(() => undefined);
    }
    append = false;
    resumedFrom = 0;
  }

  const contentRange = parseContentRange(response.headers.get("content-range"));
  const contentLength = Number(response.headers.get("content-length") || 0);
  const totalBytes = contentRange?.total
    || (append ? resumedFrom + contentLength : contentLength)
    || 0;

  let receivedBytes = resumedFrom;
  let lastEmitted = -1;
  const emit = () => {
    if (receivedBytes === lastEmitted) return;
    lastEmitted = receivedBytes;
    try {
      input.onProgress?.({
        receivedBytes,
        totalBytes,
        resumedFrom
      });
    } catch {
      // Progress UI must never abort the download stream.
    }
  };
  emit();

  const body = response.body;
  if (!body) {
    throw new Error("下载更新失败：响应体为空");
  }
  const nodeStream = Readable.fromWeb(body as import("node:stream/web").ReadableStream);
  nodeStream.on("data", (chunk: Buffer | string) => {
    receivedBytes += typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.length;
    emit();
  });

  await pipeline(
    nodeStream,
    createWriteStream(input.partialPath, { flags: append ? "a" : "w" })
  );

  return {
    bytesOnDisk: receivedBytes,
    totalBytes,
    resumedFrom,
    httpStatus: response.status
  };
}
