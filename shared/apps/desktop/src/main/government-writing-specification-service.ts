import { randomUUID } from "node:crypto";
import type { CodexStorage } from "./codex-storage.js";
import {
  analyzeGovernmentSpecificationCompleteness,
  validateGovernmentWritingSpecification,
  applyGovernmentWritingSuggestions,
  type GovernmentWritingSpecificationContent,
  type GovernmentWritingSuggestion
// @ts-ignore Node's strip-types tests load the TypeScript domain module directly.
} from "./government-writing-specification.ts";

export type GovernmentWritingSpecificationVersionSource =
  | "model"
  | "user-structured"
  | "user-markdown"
  | "model-revision"
  | "suggestion-application";

export interface GovernmentWritingSpecificationVersion {
  versionId: string;
  specificationId: string;
  threadId: string;
  goalId: string;
  versionNumber: number;
  source: GovernmentWritingSpecificationVersionSource;
  content: GovernmentWritingSpecificationContent;
  changeSummary: string;
  replacesVersionId?: string;
  createdAtMs: number;
}

export interface GovernmentWritingSpecificationSnapshot {
  specificationId: string;
  threadId: string;
  goalId: string;
  currentVersionId: string;
  confirmedVersionId?: string;
  currentVersion: GovernmentWritingSpecificationVersion;
  versions: GovernmentWritingSpecificationVersion[];
  suggestions: GovernmentWritingSuggestion[];
  updatedAtMs: number;
}

type Row = Record<string, unknown>;

function parseVersion(row: Row): GovernmentWritingSpecificationVersion {
  return {
    versionId: String(row.version_id),
    specificationId: String(row.specification_id),
    threadId: String(row.thread_id),
    goalId: String(row.goal_id),
    versionNumber: Number(row.version_number),
    source: String(row.source) as GovernmentWritingSpecificationVersionSource,
    content: validateGovernmentWritingSpecification(JSON.parse(String(row.content_json))),
    changeSummary: String(row.change_summary),
    replacesVersionId: row.replaces_version_id ? String(row.replaces_version_id) : undefined,
    createdAtMs: Number(row.created_at_ms)
  };
}

export class GovernmentWritingSpecificationService {
  private readonly storage: CodexStorage;

  constructor(storage: CodexStorage) {
    this.storage = storage;
  }

  createVersion(input: {
    threadId: string;
    goalId: string;
    source: GovernmentWritingSpecificationVersionSource;
    changeSummary: string;
    content: GovernmentWritingSpecificationContent;
    replacesVersionId?: string;
  }) {
    const content = validateGovernmentWritingSpecification(input.content);
    const database = this.storage.goals;
    const current = database.prepare(`
      SELECT specification_id, current_version_id FROM government_writing_spec_state
      WHERE thread_id = ? AND goal_id = ?
    `).get(input.threadId, input.goalId) as Row | undefined;
    if (current && input.replacesVersionId && current.current_version_id !== input.replacesVersionId) {
      throw new Error("写作规格基准版本已过期，请刷新后重试。");
    }
    if (current && !input.replacesVersionId) throw new Error("更新写作规格必须提供基准版本。");
    const specificationId = current ? String(current.specification_id) : randomUUID();
    const versionNumberRow = database.prepare(`
      SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version
      FROM government_writing_spec_versions WHERE specification_id = ?
    `).get(specificationId) as Row;
    const version: GovernmentWritingSpecificationVersion = {
      versionId: randomUUID(), specificationId, threadId: input.threadId, goalId: input.goalId,
      versionNumber: Number(versionNumberRow.next_version), source: input.source, content,
      changeSummary: String(input.changeSummary || "保存写作规格").trim().slice(0, 500),
      replacesVersionId: input.replacesVersionId, createdAtMs: Date.now()
    };
    database.exec("BEGIN IMMEDIATE");
    try {
      database.prepare(`
        INSERT INTO government_writing_spec_versions(
          version_id, specification_id, thread_id, goal_id, version_number, source,
          content_json, change_summary, replaces_version_id, created_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        version.versionId, version.specificationId, version.threadId, version.goalId,
        version.versionNumber, version.source, JSON.stringify(version.content), version.changeSummary,
        version.replacesVersionId ?? null, version.createdAtMs
      );
      database.prepare(`
        INSERT INTO government_writing_spec_state(
          specification_id, thread_id, goal_id, current_version_id, confirmed_version_id, updated_at_ms
        ) VALUES (?, ?, ?, ?, NULL, ?)
        ON CONFLICT(thread_id, goal_id) DO UPDATE SET
          current_version_id = excluded.current_version_id,
          suggestions_json = '[]',
          updated_at_ms = excluded.updated_at_ms
      `).run(specificationId, input.threadId, input.goalId, version.versionId, version.createdAtMs);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    return version;
  }

  getVersion(versionId: string) {
    const row = this.storage.goals.prepare(`
      SELECT * FROM government_writing_spec_versions WHERE version_id = ?
    `).get(versionId) as Row | undefined;
    return row ? parseVersion(row) : null;
  }

  listVersions(threadId: string, goalId: string) {
    return (this.storage.goals.prepare(`
      SELECT * FROM government_writing_spec_versions
      WHERE thread_id = ? AND goal_id = ? ORDER BY version_number DESC
    `).all(threadId, goalId) as Row[]).map(parseVersion);
  }

  getSnapshot(threadId: string, goalId: string): GovernmentWritingSpecificationSnapshot | null {
    const state = this.storage.goals.prepare(`
      SELECT * FROM government_writing_spec_state WHERE thread_id = ? AND goal_id = ?
    `).get(threadId, goalId) as Row | undefined;
    if (!state) return null;
    const currentVersion = this.getVersion(String(state.current_version_id));
    if (!currentVersion) throw new Error("写作规格当前版本不存在。");
    return {
      specificationId: String(state.specification_id), threadId, goalId,
      currentVersionId: String(state.current_version_id),
      confirmedVersionId: state.confirmed_version_id ? String(state.confirmed_version_id) : undefined,
      currentVersion,
      versions: this.listVersions(threadId, goalId),
      suggestions: JSON.parse(String(state.suggestions_json ?? "[]")) as GovernmentWritingSuggestion[],
      updatedAtMs: Number(state.updated_at_ms)
    };
  }

  /**
   * Create the first durable version when chat/plan already contains a valid
   * specification payload but SQLite state was never written (renderer race or model-only plan update).
   */
  ensureCurrentVersionFromContent(input: {
    threadId: string;
    goalId: string;
    content: GovernmentWritingSpecificationContent;
    changeSummary?: string;
    source?: GovernmentWritingSpecificationVersionSource;
  }) {
    const existing = this.getSnapshot(input.threadId, input.goalId);
    if (existing?.currentVersionId) return existing;
    this.createVersion({
      threadId: input.threadId,
      goalId: input.goalId,
      source: input.source ?? "model",
      changeSummary: input.changeSummary ?? "从对话内容恢复写作规格",
      content: input.content
    });
    const snapshot = this.getSnapshot(input.threadId, input.goalId);
    if (!snapshot?.currentVersionId) throw new Error("写作规格持久化失败，请重试规格分析。");
    return snapshot;
  }

  confirmVersion(threadId: string, goalId: string, versionId: string) {
    const version = this.getVersion(versionId);
    if (!version || version.threadId !== threadId || version.goalId !== goalId) {
      throw new Error("写作规格版本不属于当前目标。");
    }
    const state = this.getSnapshot(threadId, goalId);
    if (!state || state.currentVersionId !== versionId) throw new Error("只能确认当前写作规格版本。");
    if (version.content.requirements.some((requirement) => requirement.status === "pending")) {
      throw new Error("写作规格仍有待确认要求，请先由用户确认后再开始写作。");
    }
    const analysis = analyzeGovernmentSpecificationCompleteness(version.content);
    if (!analysis.complete) {
      throw new Error(`写作规格分析不完整，请先补齐：${analysis.missing.map((item) => item.label).join("、")}。确认后才能开始正文生成。`);
    }
    if (state.confirmedVersionId === versionId) return state;
    const now = Date.now();
    this.storage.goals.prepare(`
      UPDATE government_writing_spec_state SET confirmed_version_id = ?, updated_at_ms = ?
      WHERE thread_id = ? AND goal_id = ?
    `).run(versionId, now, threadId, goalId);
    return this.getSnapshot(threadId, goalId)!;
  }

  saveSuggestions(
    threadId: string,
    goalId: string,
    baseVersionId: string,
    suggestions: GovernmentWritingSuggestion[]
  ) {
    const state = this.getSnapshot(threadId, goalId);
    if (!state || state.currentVersionId !== baseVersionId) throw new Error("写作规格基准版本已过期，请刷新后重试。");
    const normalized = suggestions.map((suggestion) => ({
      suggestionId: String(suggestion.suggestionId || "").trim(),
      target: suggestion.target,
      reason: String(suggestion.reason || "").trim(),
      proposedValue: String(suggestion.proposedValue || "").trim()
    }));
    if (normalized.some((item) => !item.suggestionId || !item.reason || !item.proposedValue)) throw new Error("修改建议不完整。");
    if (new Set(normalized.map((item) => item.suggestionId)).size !== normalized.length) throw new Error("修改建议标识重复。");
    this.storage.goals.prepare(`
      UPDATE government_writing_spec_state SET suggestions_json = ?, updated_at_ms = ?
      WHERE thread_id = ? AND goal_id = ?
    `).run(JSON.stringify(normalized), Date.now(), threadId, goalId);
    return this.getSnapshot(threadId, goalId)!;
  }

  applySuggestions(threadId: string, goalId: string, baseVersionId: string, suggestionIds: string[]) {
    const state = this.getSnapshot(threadId, goalId);
    if (!state || state.currentVersionId !== baseVersionId) throw new Error("写作规格基准版本已过期，请刷新后重试。");
    const content = applyGovernmentWritingSuggestions(state.currentVersion.content, state.suggestions, suggestionIds);
    this.createVersion({
      threadId, goalId, source: "suggestion-application", changeSummary: `采纳${suggestionIds.length}条修改建议`,
      content, replacesVersionId: baseVersionId
    });
    return this.getSnapshot(threadId, goalId)!;
  }
}
