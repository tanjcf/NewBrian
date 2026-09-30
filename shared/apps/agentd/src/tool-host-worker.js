import readline from "node:readline";
import { createBuiltinToolRegistry } from "./tool-registry.js";

const registry = createBuiltinToolRegistry();
const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

function reply(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

lines.on("line", async (line) => {
  let request;
  try {
    request = JSON.parse(line);
    if (!request?.id || typeof request.name !== "string" || typeof request.context?.workspacePath !== "string") {
      throw new Error("Invalid Tool Host request.");
    }
    const result = await registry.invoke(request.name, request.input ?? {}, {
      workspacePath: request.context.workspacePath,
      shellEnv: request.context.shellEnv ?? {}
    });
    reply({ id: request.id, result });
  } catch (error) {
    reply({ id: request?.id ?? "unknown", error: error instanceof Error ? error.message : String(error) });
  }
});
