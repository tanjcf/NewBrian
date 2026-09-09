import { promises as fs } from "node:fs";
import path from "node:path";

/** Max chars injected from repo-root Project OS files into the system prompt. */
export const PROJECT_OS_MAX_CHARS = 32_768;

/** Tail size for session-digest / project-knowledge when still injected. */
export const PROJECT_MANAGER_TAIL_CHARS = 4_096;

/**
 * Preference references always injected for project-manager.
 * Digest / project-knowledge are truncated or omitted to avoid context bloat.
 */
export const PROJECT_MANAGER_ALWAYS_INJECT = new Set([
  "user-output-rules.md",
  "learning-open-questions.md",
  // Seeded from programming-skill; keep core coding guardrails always-on.
  "programming-guardrails.md"
]);

export const PROJECT_MANAGER_TAIL_INJECT = new Set([
  "session-digest.md",
  "project-knowledge.md"
]);

/** Priority: NEWBRAIN.md > CLAUDE.md > AGENTS.md (first non-empty wins among equals). */
export const PROJECT_OS_FILE_CANDIDATES = ["NEWBRAIN.md", "CLAUDE.md", "AGENTS.md"] as const;

export type ProjectOsReference = { name: string; content: string };

export type LoadedProjectOs = {
  sourceFile: string | null;
  text: string;
};

async function readUtf8(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return "";
    throw error;
  }
}

/**
 * Detect the stock NEWBRAIN.md template so upgrades do not hide richer legacy files.
 * Exported for unit tests and sync/merge helpers.
 */
export function isDefaultProjectOsScaffold(text: string): boolean {
  const trimmed = String(text || "").trim();
  if (!trimmed) return true;
  return trimmed.includes("_(fill in)_")
    && /Project OS/i.test(trimmed)
    && /repo-root source of truth/i.test(trimmed);
}

/** Truncate from the end while keeping a clear marker when content was cut. */
export function truncateProjectOsText(text: string, maxChars = PROJECT_OS_MAX_CHARS): string {
  const trimmed = String(text || "").trim();
  if (!trimmed) return "";
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars).trimEnd()}\n\n…(Project OS truncated)`;
}

export function truncateReferenceTail(content: string, maxChars = PROJECT_MANAGER_TAIL_CHARS): string {
  const text = String(content || "");
  if (text.length <= maxChars) return text;
  return `…(earlier content omitted)\n${text.slice(-maxChars)}`;
}

/**
 * Choose Project OS source with legacy-project compatibility:
 * prefer real content over stock scaffolds; among equals keep NEWBRAIN > CLAUDE > AGENTS.
 */
export function selectProjectOsSource(
  candidates: Array<{ fileName: string; text: string }>
): LoadedProjectOs {
  const nonEmpty = candidates.filter((item) => String(item.text || "").trim());
  if (!nonEmpty.length) return { sourceFile: null, text: "" };
  const real = nonEmpty.filter((item) => !isDefaultProjectOsScaffold(item.text));
  const chosen = (real.length ? real : nonEmpty)[0];
  return {
    sourceFile: chosen.fileName,
    text: chosen.text
  };
}

/**
 * Loads repo-root Project OS instruction text.
 * Prefer real NEWBRAIN.md; fall back to CLAUDE.md / AGENTS.md when NEWBRAIN is empty or only a scaffold.
 */
export async function loadProjectOsInstruction(
  workspacePath: string,
  options: { maxChars?: number } = {}
): Promise<LoadedProjectOs> {
  const root = path.resolve(workspacePath || "");
  if (!root) return { sourceFile: null, text: "" };
  const maxChars = options.maxChars ?? PROJECT_OS_MAX_CHARS;
  const candidates: Array<{ fileName: string; text: string }> = [];
  for (const fileName of PROJECT_OS_FILE_CANDIDATES) {
    const raw = await readUtf8(path.join(root, fileName));
    candidates.push({ fileName, text: raw });
  }
  const selected = selectProjectOsSource(candidates);
  if (!selected.text.trim()) return { sourceFile: null, text: "" };
  return {
    sourceFile: selected.sourceFile,
    text: truncateProjectOsText(selected.text, maxChars)
  };
}

/** Builds the system-prompt block for Project OS. */
export function buildProjectOsPromptBlock(input: LoadedProjectOs | string): string {
  const loaded = typeof input === "string"
    ? { sourceFile: null, text: String(input || "").trim() }
    : input;
  const text = loaded.text?.trim();
  if (!text) return "";
  const source = loaded.sourceFile ? ` source=${loaded.sourceFile}` : "";
  return [
    `Project OS (repo-root source of truth${source}; agent may update NEWBRAIN.md with workspace tools):`,
    text
  ].join("\n");
}

/**
 * For always-on project-manager skills: inject preference files fully;
 * keep only a short tail of digest / project-knowledge.
 */
export function selectProjectManagerReferences(
  references: ProjectOsReference[] | undefined
): ProjectOsReference[] {
  if (!references?.length) return [];
  const selected: ProjectOsReference[] = [];
  for (const reference of references) {
    const name = String(reference.name || "").toLowerCase();
    if (PROJECT_MANAGER_ALWAYS_INJECT.has(name)) {
      selected.push(reference);
      continue;
    }
    if (PROJECT_MANAGER_TAIL_INJECT.has(name)) {
      const truncated = truncateReferenceTail(reference.content);
      if (truncated.trim()) {
        selected.push({ name: reference.name, content: truncated });
      }
    }
  }
  return selected;
}

export function isProjectManagerSkillName(name: string): boolean {
  return String(name || "").toLowerCase().endsWith("-project-manager");
}
