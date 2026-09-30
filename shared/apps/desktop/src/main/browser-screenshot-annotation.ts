import { writeFile } from "node:fs/promises";
import type { BrowserAnnotatedScreenshotsMode } from "./browser-agent-policy.ts";

export type BrowserAnnotationAsk = () => Promise<boolean>;

/**
 * Write sidecar metadata next to a browser screenshot.
 * - never: skip
 * - always: write annotated=true
 * - ask: prompt; write annotated based on answer (skip file if user declines)
 */
export async function writeBrowserScreenshotAnnotation(input: {
  mode: BrowserAnnotatedScreenshotsMode;
  path: string;
  url: string;
  title?: string;
  ask?: BrowserAnnotationAsk;
}): Promise<string | null> {
  if (input.mode === "never") return null;
  let annotated = input.mode === "always";
  if (input.mode === "ask") {
    if (!input.ask) return null;
    const approved = await input.ask();
    if (!approved) return null;
    annotated = true;
  }
  const annotationPath = `${input.path}.annotation.json`;
  const payload = {
    url: input.url,
    title: input.title || "",
    capturedAt: new Date().toISOString(),
    path: input.path,
    annotated
  };
  await writeFile(annotationPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return annotationPath;
}
