import type { AppMenuName, ShowAppMenuInput } from "@codex-forge/protocol";

const APP_MENUS = new Set<AppMenuName>(["file", "edit", "view", "window", "help"]);

export function parseShowAppMenuInput(value: unknown): ShowAppMenuInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("App menu input must be an object.");
  const input = value as Record<string, unknown>;
  if (!APP_MENUS.has(input.menu as AppMenuName)) throw new TypeError("App menu name is invalid.");
  if (typeof input.x !== "number" || !Number.isFinite(input.x) || typeof input.y !== "number" || !Number.isFinite(input.y)) {
    throw new TypeError("App menu coordinates are invalid.");
  }
  const x = Math.round(input.x);
  const y = Math.round(input.y);
  if (Math.abs(x) > 100_000 || Math.abs(y) > 100_000) throw new TypeError("App menu coordinates are out of range.");
  return { menu: input.menu as AppMenuName, x, y };
}
