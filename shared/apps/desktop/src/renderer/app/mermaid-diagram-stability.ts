/**
 * Keep Mermaid markdown previews from flashing loading → SVG → loading when
 * the parent Markdown tree remounts (file preview / collapsible sections).
 */

const svgCache = new Map<string, string>();
let mermaidModulePromise: Promise<typeof import("mermaid")> | null = null;
let initializeCount = 0;

export function peekMermaidSvgCache(source: string) {
  return svgCache.get(source) || "";
}

export function rememberMermaidSvg(source: string, svg: string) {
  if (!source || !svg) return;
  svgCache.set(source, svg);
}

export function clearMermaidSvgCacheForTests() {
  svgCache.clear();
  mermaidModulePromise = null;
  initializeCount = 0;
}

export function mermaidInitializeCountForTests() {
  return initializeCount;
}

/** Load mermaid once and initialize a single shared config. */
export function loadMermaidOnce() {
  if (!mermaidModulePromise) {
    mermaidModulePromise = import("mermaid").then((mod) => {
      mod.default.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        suppressErrorRendering: true,
        theme: "neutral"
      });
      initializeCount += 1;
      return mod;
    });
  }
  return mermaidModulePromise;
}

export function createMermaidDiagramId(reactId: string, attempt: number) {
  const safe = reactId.replace(/[^a-zA-Z0-9_-]/g, "") || "diagram";
  return `newbrain-mermaid-${safe}-${attempt}`;
}
