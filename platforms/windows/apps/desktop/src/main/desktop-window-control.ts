import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type {
  DesktopWindowClickInput,
  DesktopWindowInfo,
  DesktopWindowTarget,
  DesktopWindowTypeTextInput
} from "../shared/desktop-window-control-contract.js";

type DriverResult = Record<string, unknown> | Record<string, unknown>[];

export interface DesktopWindowControlOptions {
  driverPath: string;
  scenarioPath: string;
  captureDirectory: string;
  runDriver?: (args: string[]) => Promise<string>;
}

const PERMISSION_HINT =
  "请确认当前 Windows 桌面会话可交互，并尝试以与目标应用相同的权限级别运行 NewBrain；若目标应用以管理员身份运行，请也以管理员身份运行 NewBrain。";

function requireText(value: unknown, field: string) {
  const text = String(value ?? "").trim();
  if (!text) throw new TypeError(`${field} is required.`);
  return text;
}

function appendTargetArgs(args: string[], target: DesktopWindowTarget) {
  if (target.processId !== undefined) {
    const processId = Number(target.processId);
    if (!Number.isInteger(processId) || processId <= 0) throw new TypeError("processId must be a positive integer.");
    args.push("-ProcessId", String(processId));
  }
  if (target.processName !== undefined) args.push("-ProcessName", requireText(target.processName, "processName"));
  if (target.windowTitle !== undefined) args.push("-WindowTitle", requireText(target.windowTitle, "windowTitle"));
  if (target.processId === undefined && target.processName === undefined && target.windowTitle === undefined) {
    throw new TypeError("A processId, processName, or windowTitle is required.");
  }
}

function parseDriverJson(output: string): DriverResult {
  const text = output.trim();
  if (!text) return {};
  try {
    return JSON.parse(text) as DriverResult;
  } catch {
    throw new Error(`Windows UI driver returned invalid JSON: ${text.slice(0, 300)}`);
  }
}

function runPowerShellDriver(driverPath: string, args: string[]) {
  return new Promise<string>((resolvePromise, reject) => {
    const child = spawn("powershell.exe", [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      driverPath,
      ...args
    ], { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolvePromise(stdout);
      else reject(new Error((stderr || stdout || `PowerShell exited with code ${code}`).trim()));
    });
  });
}

/** Windows-only adapter over the repository's UI Automation/SendInput driver. */
export class DesktopWindowControl {
  private readonly options: DesktopWindowControlOptions;
  private readonly runDriver: (args: string[]) => Promise<string>;

  constructor(options: DesktopWindowControlOptions) {
    this.options = options;
    this.runDriver = options.runDriver ?? ((args) => runPowerShellDriver(options.driverPath, args));
  }

  get scriptPaths() {
    return {
      driver: this.options.driverPath,
      scenario: this.options.scenarioPath
    };
  }

  private async invoke(action: string, target?: DesktopWindowTarget, extraArgs: string[] = []) {
    const args = ["-Action", action];
    if (target) appendTargetArgs(args, target);
    args.push(...extraArgs);
    try {
      return parseDriverJson(await this.runDriver(args));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Windows 窗口操控失败：${detail} ${PERMISSION_HINT}`, { cause: error });
    }
  }

  async list(): Promise<DesktopWindowInfo[]> {
    const result = await this.invoke("list");
    return (Array.isArray(result) ? result : [result])
      .filter((item) => Number(item.processId) > 0 && String(item.title ?? "").trim())
      .map((item) => ({
        processId: Number(item.processId),
        processName: String(item.processName ?? ""),
        title: String(item.title ?? ""),
        handle: Number(item.handle ?? 0),
        bounds: {
          left: Number((item.bounds as Record<string, unknown> | undefined)?.left ?? 0),
          top: Number((item.bounds as Record<string, unknown> | undefined)?.top ?? 0),
          width: Number((item.bounds as Record<string, unknown> | undefined)?.width ?? 0),
          height: Number((item.bounds as Record<string, unknown> | undefined)?.height ?? 0)
        }
      }));
  }

  async activate(target: DesktopWindowTarget) {
    return this.invoke("activate", target) as Promise<{ activated: true; targetWindow: number }>;
  }

  async click(input: DesktopWindowClickInput) {
    const args: string[] = [];
    let action = "click";
    if (input.name !== undefined) args.push("-Name", requireText(input.name, "name"));
    if (input.automationId !== undefined) args.push("-AutomationId", requireText(input.automationId, "automationId"));
    if (input.x !== undefined || input.y !== undefined) {
      if (!Number.isFinite(input.x) || !Number.isFinite(input.y)) throw new TypeError("x and y must both be finite numbers.");
      action = "clickrelative";
      args.push("-X", String(Math.round(input.x!)), "-Y", String(Math.round(input.y!)));
    } else if (input.name === undefined && input.automationId === undefined) {
      throw new TypeError("Click requires x/y, name, or automationId.");
    }
    return this.invoke(action, input, args) as Promise<Record<string, unknown>>;
  }

  async typeText(input: DesktopWindowTypeTextInput) {
    if (typeof input.text !== "string") throw new TypeError("text must be a string.");
    const args = ["-Text", input.text];
    let action = "type";
    if (input.name !== undefined) args.push("-Name", requireText(input.name, "name"));
    if (input.automationId !== undefined) args.push("-AutomationId", requireText(input.automationId, "automationId"));
    if (input.x !== undefined || input.y !== undefined) {
      if (!Number.isFinite(input.x) || !Number.isFinite(input.y)) throw new TypeError("x and y must both be finite numbers.");
      action = "typerelative";
      args.push("-X", String(Math.round(input.x!)), "-Y", String(Math.round(input.y!)));
    } else if (input.name === undefined && input.automationId === undefined) {
      throw new TypeError("typeText requires x/y, name, or automationId.");
    }
    return this.invoke(action, input, args) as Promise<Record<string, unknown>>;
  }

  async screenshot(target: DesktopWindowTarget) {
    await mkdir(this.options.captureDirectory, { recursive: true });
    const outputPath = join(this.options.captureDirectory, `window-${Date.now()}.png`);
    return this.invoke("screenshot", target, ["-OutputPath", outputPath]) as Promise<{ outputPath: string }>;
  }
}
