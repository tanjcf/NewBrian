export function encodeMcpMessage(payload: unknown) {
  return Buffer.from(`${JSON.stringify(payload)}\n`, "utf8");
}

export function decodeMcpMessages(input: Buffer): {
  messages: any[];
  rest: Buffer;
  error?: Error;
} {
  let buffer = input;
  const messages: any[] = [];
  while (buffer.length) {
    if (/^Content-Length:/i.test(buffer.slice(0, Math.min(buffer.length, 32)).toString("utf8"))) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) break;
      const header = buffer.slice(0, headerEnd).toString("utf8");
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (!match) return { messages, rest: buffer, error: new Error("MCP frame is missing Content-Length.") };
      const length = Number(match[1]);
      const end = headerEnd + 4 + length;
      if (buffer.length < end) break;
      const body = buffer.slice(headerEnd + 4, end).toString("utf8");
      buffer = buffer.slice(end);
      try {
        messages.push(JSON.parse(body));
      } catch (error) {
        return { messages, rest: buffer, error: error instanceof Error ? error : new Error(String(error)) };
      }
      continue;
    }

    const newline = buffer.indexOf("\n");
    if (newline === -1) break;
    const line = buffer.slice(0, newline).toString("utf8").trim();
    buffer = buffer.slice(newline + 1);
    if (!line) continue;
    try {
      messages.push(JSON.parse(line));
    } catch (error) {
      return { messages, rest: buffer, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }
  return { messages, rest: buffer };
}
