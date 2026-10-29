import { promises as fs } from "node:fs";
import path from "node:path";

/** Max chars injected from repo-root Project OS files into the system prompt. */
export const PROJECT_OS_MAX_CHARS = 32_768;

/** Tail size for session-digest when still injected. Project knowledge is filtered before this cap. */
export const PROJECT_MANAGER_TAIL_CHARS = 4_096;

const KNOWLEDGE_STATUS_FILES = new Set([
  "user-output-rules.md",
  "project-knowledge.md"
]);

const SECRET_PATTERN = /sk-[A-Za-z0-9_-]{8,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:password|api[_-]?key|secret|token|私钥|密码)\s*[:=：为是]\s*(?!\[已省略\])\S+|bearer\s+[A-Za-z0-9._-]{12,}/i;

function redactInjectedSecrets(value: string): string {
  return String(value || "")
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[已省略私钥]")
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "[已省略密钥]")
    .replace(/(password|api[_-]?key|secret|token|私钥|密码)\s*[:=：为是]\s*(?!\[已省略\])\S+/gi, "$1: [已省略]")
    .replace(/bearer\s+[A-Za-z0-9._-]{12,}/gi, "bearer [已省略]");
}

function knowledgeBullets(content: string): string[] {
  return String(content || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim())
    .filter(Boolean);
}

function knowledgeStatus(line: string): "active" | "proposed" | "deprecated" | "legacy" {
  const match = line.match(/^\[(active|proposed|deprecated)\]/i);
  if (!match) return "legacy";
  return match[1].toLowerCase() as "active" | "proposed" | "deprecated";
}

function knowledgeFact(line: string): string {
  const match = line.match(/事实:\s*([^|]+)/);
  return (match ? match[1] : line).replace(/\s+/g, " ").trim();
}

function durableKnowledgeCount(content: string): number {
  return knowledgeBullets(content).filter((line) => {
    if (SECRET_PATTERN.test(line)) return false;
    const status = knowledgeStatus(line);
    return status === "active" || status === "legacy";
  }).length;
}

/**
 * Inject active and legacy knowledge. Proposed lines become at most five titles.
 * Deprecated lines stay on disk and out of the prompt. Same fact as active hides its proposed copy.
 */
export function filterDurableKnowledgeForPrompt(content: string): string {
  const bullets = knowledgeBullets(content);
  const activeFacts = new Set(
    bullets
      .filter((line) => !SECRET_PATTERN.test(line))
      .filter((line) => {
        const status = knowledgeStatus(line);
        return status === "active" || status === "legacy";
      })
      .map((line) => knowledgeFact(line))
  );
  const kept: string[] = [];
  const proposed: string[] = [];
  for (const bullet of bullets) {
    if (SECRET_PATTERN.test(bullet)) continue;
    const status = knowledgeStatus(bullet);
    if (status === "deprecated") continue;
    if (status === "proposed") {
      const fact = knowledgeFact(bullet);
      if (activeFacts.has(fact) || proposed.length >= 5) continue;
      proposed.push(fact.slice(0, 80));
      continue;
    }
    kept.push(bullet);
  }
  const lines = kept.map((item) => `- ${item}`);
  if (proposed.length) {
    lines.push("", "只提到过一次（还没再次谈起，不能当作已经说定的事实）:");
    for (const title of proposed) lines.push(`- ${title}`);
  }
  return lines.join("\n");
}

function injectKnowledgeReference(reference: ProjectOsReference): ProjectOsReference {
  try {
    const filtered = filterDurableKnowledgeForPrompt(reference.content);
    const before = durableKnowledgeCount(reference.content);
    const after = durableKnowledgeCount(filtered);
    if (before > 0 && after === 0) {
      return { name: reference.name, content: redactInjectedSecrets(reference.content) };
    }
    return { name: reference.name, content: filtered };
  } catch {
    return { name: reference.name, content: redactInjectedSecrets(reference.content) };
  }
}

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
    if (KNOWLEDGE_STATUS_FILES.has(name)) {
      const filtered = injectKnowledgeReference(reference);
      const content = PROJECT_MANAGER_TAIL_INJECT.has(name)
        ? truncateReferenceTail(filtered.content)
        : filtered.content;
      if (content.trim()) selected.push({ name: reference.name, content });
      continue;
    }
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
