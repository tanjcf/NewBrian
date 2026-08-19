import { createInterface } from "node:readline";
import { realpath, stat, readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, extname } from "node:path";

const VERSION = "1";
const MAX_DEFAULT_BYTES = 5 * 1024 * 1024;
const formats = new Map([[".txt", "txt"], [".md", "markdown"], [".markdown", "markdown"]]);
const output = process.stdout;

function response(requestId, values) {
  output.write(`${JSON.stringify({ protocol_version: VERSION, request_id: requestId, ...values })}\n`);
}

async function ingest(request) {
  const requestId = String(request.request_id || "");
  try {
    if (request.protocol_version !== VERSION || !requestId) throw new Error("DOCUMENT_WORKER_BAD_REQUEST");
    const root = await realpath(String(request.project_root || ""));
    const relativePath = String(request.relative_path || "");
    if (!relativePath || isAbsolute(relativePath)) throw new Error("DOCUMENT_WORKER_PATH_FORBIDDEN");
    const target = resolve(root, relativePath);
    const resolvedTarget = await realpath(target);
    const escaped = relative(root, resolvedTarget);
    if (escaped.startsWith("..") || isAbsolute(escaped)) throw new Error("DOCUMENT_WORKER_PATH_FORBIDDEN");
    const format = formats.get(extname(resolvedTarget).toLowerCase());
    if (!format) throw new Error("DOCUMENT_WORKER_FORMAT_UNSUPPORTED");
    const fileStat = await stat(resolvedTarget);
    const maxBytes = Math.min(Math.max(Number(request.max_bytes) || MAX_DEFAULT_BYTES, 1), 20 * 1024 * 1024);
    if (!fileStat.isFile() || fileStat.size > maxBytes) throw new Error("DOCUMENT_WORKER_FILE_TOO_LARGE");
    const text = (await readFile(resolvedTarget)).toString("utf8").replaceAll("\r\n", "\n");
    const lines = text.split("\n");
    const anchors = lines.map((line, index) => ({ format, locator: { line: index + 1 }, selectedText: line }));
    response(requestId, { status: "completed", error_code: "", format, text, anchors, warnings: [] });
  } catch (error) {
    response(requestId, { status: "failed", error_code: error instanceof Error ? error.message : "DOCUMENT_WORKER_FAILED" });
  }
}

createInterface({ input: process.stdin }).on("line", (line) => {
  try { void ingest(JSON.parse(line)); }
  catch { response("unknown", { status: "failed", error_code: "DOCUMENT_WORKER_BAD_JSON" }); }
});
