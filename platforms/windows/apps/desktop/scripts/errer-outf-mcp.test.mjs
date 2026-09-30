import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import test from "node:test";
import { fileURLToPath } from "node:url";

function frame(payload) {
  const body = Buffer.from(JSON.stringify(payload));
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]);
}

function readFrame(stream) {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    const onData = (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const match = buffer.subarray(0, headerEnd).toString().match(/Content-Length:\s*(\d+)/i);
      if (!match || buffer.length < headerEnd + 4 + Number(match[1])) return;
      stream.off("data", onData);
      resolve(JSON.parse(buffer.subarray(headerEnd + 4, headerEnd + 4 + Number(match[1])).toString()));
    };
    stream.on("data", onData);
    stream.once("error", reject);
  });
}

test("errer_outf MCP lists open Spring error reports with admin bearer authentication", async () => {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push({ url: request.url, authorization: request.headers.authorization });
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify([{ id: "err-1", status: "OPEN" }]));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const child = spawn(process.execPath, [fileURLToPath(new URL("../resources/mcp/errer-outf-server.mjs", import.meta.url))], {
    env: { ...process.env, ERRER_OUTF_BASE_URL: `http://127.0.0.1:${address.port}`, ERRER_OUTF_ADMIN_TOKEN: "admin-token" },
    stdio: "pipe"
  });
  try {
    child.stdin.write(frame({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }));
    await readFrame(child.stdout);
    child.stdin.write(frame({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "errer_outf.read_errors", arguments: { status: "OPEN" } } }));
    const result = await readFrame(child.stdout);
    assert.match(result.result.content[0].text, /err-1/);
    assert.deepEqual(requests, [{ url: "/api/admin/desktop-error-reports?status=OPEN&limit=25", authorization: "Bearer admin-token" }]);
  } finally {
    child.kill();
    server.close();
  }
});
