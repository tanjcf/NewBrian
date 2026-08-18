import assert from "node:assert/strict";
import test from "node:test";

const { resolveSystemTools } = await import(new URL("./system-tool-policy.ts", import.meta.url).href);

test("uses known Windows installations before PATH lookup", () => {
  const commands: string[] = [];
  const tools = resolveSystemTools({
    platform: "win32",
    env: { LOCALAPPDATA: "C:/Users/test/AppData/Local" },
    fileExists: (path: string) => path.endsWith("Microsoft VS Code\\Code.exe"),
    runCommand: (command: string, args: string[]) => { commands.push(`${command} ${args.join(" ")}`); return { status: 1 }; }
  });
  assert.equal(tools.find((tool: { id: string }) => tool.id === "vscode").available, true);
  assert.equal(tools.find((tool: { id: string }) => tool.id === "finder").label, "File Explorer");
  assert.equal(commands.includes("where.exe code"), false);
});

test("detects macOS applications through osascript", () => {
  const tools = resolveSystemTools({
    platform: "darwin", env: {}, fileExists: () => false,
    runCommand: (command: string, args: string[]) => ({ status: command === "osascript" && args.join(" ").includes("Finder") ? 0 : 1 })
  });
  assert.equal(tools.find((tool: { id: string }) => tool.id === "finder").available, true);
  assert.equal(tools.find((tool: { id: string }) => tool.id === "finder").label, "Finder");
});

test("uses PATH lookup for Linux tools", () => {
  const tools = resolveSystemTools({
    platform: "linux", env: {}, fileExists: () => false,
    runCommand: (command: string, args: string[]) => ({ status: command === "which" && args[0] === "idea" ? 0 : 1 })
  });
  assert.equal(tools.find((tool: { id: string }) => tool.id === "idea").available, true);
  assert.equal(tools.find((tool: { id: string }) => tool.id === "pycharm").available, false);
});
