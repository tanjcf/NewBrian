import { ipcMain } from "electron";
import type { DesktopWindowControl } from "./desktop-window-control.js";
import {
  desktopWindowControlIpcChannels,
  type DesktopWindowClickInput,
  type DesktopWindowTarget,
  type DesktopWindowTypeTextInput
} from "../shared/desktop-window-control-contract.js";

function requireObject(input: unknown, operation: string) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError(`windowControl.${operation} input must be an object.`);
  }
  return input as Record<string, unknown>;
}

function parseTarget(input: unknown, operation: string): DesktopWindowTarget {
  const value = requireObject(input, operation);
  return {
    processId: value.processId === undefined ? undefined : Number(value.processId),
    processName: value.processName === undefined ? undefined : String(value.processName),
    windowTitle: value.windowTitle === undefined ? undefined : String(value.windowTitle)
  };
}

function parseClick(input: unknown): DesktopWindowClickInput {
  const value = requireObject(input, "click");
  return {
    ...parseTarget(value, "click"),
    name: value.name === undefined ? undefined : String(value.name),
    automationId: value.automationId === undefined ? undefined : String(value.automationId),
    x: value.x === undefined ? undefined : Number(value.x),
    y: value.y === undefined ? undefined : Number(value.y)
  };
}

function parseTypeText(input: unknown): DesktopWindowTypeTextInput {
  const value = requireObject(input, "typeText");
  if (typeof value.text !== "string") throw new TypeError("windowControl.typeText text must be a string.");
  return { ...parseClick(value), text: value.text };
}

export function registerDesktopWindowControlIpc(control: DesktopWindowControl) {
  ipcMain.handle(desktopWindowControlIpcChannels.list, () => control.list());
  ipcMain.handle(desktopWindowControlIpcChannels.activate, (_event, input: unknown) =>
    control.activate(parseTarget(input, "activate"))
  );
  ipcMain.handle(desktopWindowControlIpcChannels.click, (_event, input: unknown) =>
    control.click(parseClick(input))
  );
  ipcMain.handle(desktopWindowControlIpcChannels.typeText, (_event, input: unknown) =>
    control.typeText(parseTypeText(input))
  );
  ipcMain.handle(desktopWindowControlIpcChannels.screenshot, (_event, input: unknown) =>
    control.screenshot(parseTarget(input, "screenshot"))
  );
}
