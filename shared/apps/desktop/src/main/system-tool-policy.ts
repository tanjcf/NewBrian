import { isAbsolute, join } from "node:path";
import type { SystemToolEntry } from "@codex-forge/protocol";

export const systemToolCatalog: SystemToolEntry[] = [
  { id: "vscode", label: "Visual Studio", kind: "developer", icon: "VS", available: false, appName: "Visual Studio Code", commands: ["code"] },
  { id: "finder", label: "Finder", kind: "system", icon: "FD", available: false, appName: "Finder", commands: ["explorer.exe", "xdg-open"] },
  { id: "terminal", label: "Terminal", kind: "system", icon: "TM", available: false, appName: "Terminal", commands: ["wt.exe", "powershell.exe", "cmd.exe", "x-terminal-emulator"] },
  { id: "git-bash", label: "Git Bash", kind: "developer", icon: "GB", available: false, appName: "Git Bash", commands: ["bash.exe", "git-bash.exe"] },
  { id: "idea", label: "IntelliJ IDEA", kind: "developer", icon: "IJ", available: false, appName: "IntelliJ IDEA", commands: ["idea64.exe", "idea.exe", "idea"] },
  { id: "pycharm", label: "PyCharm", kind: "developer", icon: "PC", available: false, appName: "PyCharm", commands: ["pycharm64.exe", "pycharm.exe", "pycharm"] }
];

interface SystemToolPolicyContext {
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  fileExists: (path: string) => boolean;
  runCommand: (command: string, args: string[]) => { status: number | null };
}

export function resolveSystemToolCommand(tool: SystemToolEntry, context: SystemToolPolicyContext) {
  if (context.platform === "darwin") return "";
  if (context.platform === "win32" && tool.id === "vscode") {
    const candidates = [
      join(context.env.LOCALAPPDATA ?? "", "Programs", "Microsoft VS Code", "Code.exe"),
      join(context.env.ProgramFiles ?? "", "Microsoft VS Code", "Code.exe"),
      join(context.env["ProgramFiles(x86)"] ?? "", "Microsoft VS Code", "Code.exe")
    ];
    const installed = candidates.find((candidate) => isAbsolute(candidate) && context.fileExists(candidate));
    if (installed) return installed;
  }
  const lookupCommand = context.platform === "win32" ? "where.exe" : "which";
  return tool.commands.find((command) => context.runCommand(lookupCommand, [command]).status === 0) ?? "";
}

function detectSystemToolAvailability(tool: SystemToolEntry, command: string, context: SystemToolPolicyContext) {
  if (context.platform !== "darwin") return Boolean(command);
  return context.runCommand("osascript", ["-e", `id of app "${tool.appName}"`]).status === 0;
}

export function resolveSystemTools(context: SystemToolPolicyContext) {
  return systemToolCatalog.map((tool) => {
    const command = resolveSystemToolCommand(tool, context);
    const label = tool.id === "finder" && context.platform !== "darwin" ? "File Explorer" : tool.label;
    return { ...tool, label, available: detectSystemToolAvailability(tool, command, context) };
  });
}
