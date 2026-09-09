import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { CodexStorage } = await import(new URL("./codex-storage.ts", import.meta.url).href);
const { GovernmentWritingSpecificationService } = await import(new URL("./government-writing-specification-service.ts", import.meta.url).href);

function content(task: string) {
  return {
    task,
    requirements: [
      { key: "theme", label: "主题定位", value: "回答核心问题与实践路径", status: "confirmed" as const },
      { key: "caseSelection", label: "案例选取", value: "选取可核验的地方实践案例", status: "confirmed" as const },
      { key: "caseLogic", label: "案例展开逻辑", value: "按禀赋、困境、做法、成效展开", status: "confirmed" as const },
      { key: "genre", label: "文体", value: "理论案例研究文章", status: "confirmed" as const },
      { key: "language", label: "语言", value: "政务书面语，克制规范", status: "confirmed" as const },
      { key: "data", label: "数据使用", value: "仅使用可考数据，禁止虚构", status: "confirmed" as const },
      { key: "citation", label: "引用规范", value: "引用权威公开文献与讲话摘录", status: "confirmed" as const },
      { key: "length", label: "篇幅", value: "全文约3500字", status: "confirmed" as const }
    ],
    cases: [{
      caseId: "case-1",
      name: "地方实践案例",
      plannedUse: "支撑主题论证",
      status: "verified" as const,
      evidence: [{
        evidenceId: "ev-1",
        title: "官方公开材料",
        authority: "人民政府",
        publishedAt: "2025-01-01",
        url: "https://www.gov.cn/example.html",
        supportedClaims: ["公开材料支持该案例"],
        unsupportedClaims: [],
        readFromOfficialPage: true,
        status: "verified" as const
      }]
    }],
    structure: [{
      sectionId: "intro", level: 1 as const, title: "引言", points: "说明背景",
      evidenceIds: ["ev-1"], targetCharacters: 300, verification: "不引入未核验事实"
    }]
  };
}

function seedGoal(storage: any, threadId = "thread-1", goalId = "goal-1") {
  storage.upsertGoal({
    threadId, goalId, objective: "政务写作", status: "active", tokensUsed: 0,
    timeUsedSeconds: 0, createdAtMs: 1, updatedAtMs: 1
  });
}

test("persists immutable versions and restores the confirmed version", () => {
  const root = mkdtempSync(join(tmpdir(), "newbrain-gov-spec-"));
  try {
    let storage = new CodexStorage(root);
    seedGoal(storage);
    let service = new GovernmentWritingSpecificationService(storage);
    const first = service.createVersion({
      threadId: "thread-1", goalId: "goal-1", source: "model", changeSummary: "初始规格", content: content("原始任务")
    });
    const second = service.createVersion({
      threadId: "thread-1", goalId: "goal-1", source: "user-structured", changeSummary: "修改任务",
      replacesVersionId: first.versionId, content: content("修改后的任务")
    });
    service.confirmVersion("thread-1", "goal-1", second.versionId);
    storage.close();

    storage = new CodexStorage(root);
    service = new GovernmentWritingSpecificationService(storage);
    const snapshot = service.getSnapshot("thread-1", "goal-1");
    assert.equal(snapshot?.confirmedVersionId, second.versionId);
    assert.equal(snapshot?.currentVersion.content.task, "修改后的任务");
    assert.equal(service.getVersion(first.versionId)?.content.task, "原始任务");
    storage.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("confirmation is idempotent and rejects a stale version from another goal", () => {
  const root = mkdtempSync(join(tmpdir(), "newbrain-gov-spec-confirm-"));
  try {
    const storage = new CodexStorage(root);
    seedGoal(storage);
    const service = new GovernmentWritingSpecificationService(storage);
    const version = service.createVersion({
      threadId: "thread-1", goalId: "goal-1", source: "user-structured", changeSummary: "保存", content: content("任务")
    });
    const first = service.confirmVersion("thread-1", "goal-1", version.versionId);
    const repeated = service.confirmVersion("thread-1", "goal-1", version.versionId);
    assert.deepEqual(repeated, first);
    assert.throws(() => service.confirmVersion("thread-2", "goal-2", version.versionId), /不属于当前目标/u);
    storage.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects confirmation while an approximate length requirement is pending user confirmation", () => {
  const root = mkdtempSync(join(tmpdir(), "newbrain-gov-spec-pending-length-"));
  let storage: any;
  try {
    storage = new CodexStorage(root);
    seedGoal(storage);
    const service = new GovernmentWritingSpecificationService(storage);
    const pending: any = content("任务");
    pending.requirements = pending.requirements.map((item: any) =>
      item.key === "length" ? { ...item, status: "pending" } : item
    );
    const version = service.createVersion({ threadId: "thread-1", goalId: "goal-1", source: "model", changeSummary: "待确认篇幅", content: pending });
    assert.throws(() => service.confirmVersion("thread-1", "goal-1", version.versionId), /待确认/u);
  } finally {
    storage?.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects confirmation when specification analysis dimensions are incomplete", () => {
  const root = mkdtempSync(join(tmpdir(), "newbrain-gov-spec-incomplete-"));
  let storage: any;
  try {
    storage = new CodexStorage(root);
    seedGoal(storage);
    const service = new GovernmentWritingSpecificationService(storage);
    const incomplete = {
      task: "写一篇文章",
      requirements: [{ key: "theme", label: "主题定位", value: "回答核心问题", status: "confirmed" as const }],
      cases: [],
      structure: [{
        sectionId: "intro", level: 1 as const, title: "引言", points: "说明背景",
        evidenceIds: [], targetCharacters: 300, verification: "不引入未核验事实"
      }]
    };
    const version = service.createVersion({
      threadId: "thread-1", goalId: "goal-1", source: "model", changeSummary: "不完整分析", content: incomplete
    });
    assert.throws(() => service.confirmVersion("thread-1", "goal-1", version.versionId), /分析不完整|确认后才能开始正文/u);
  } finally {
    storage?.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("stores guidance and applies selected suggestions as a new version", () => {
  const root = mkdtempSync(join(tmpdir(), "newbrain-gov-spec-guidance-"));
  let storage: any;
  try {
    storage = new CodexStorage(root);
    seedGoal(storage);
    const service = new GovernmentWritingSpecificationService(storage);
    const version = service.createVersion({ threadId: "thread-1", goalId: "goal-1", source: "model", changeSummary: "初始", content: content("原始任务") });
    service.saveSuggestions("thread-1", "goal-1", version.versionId, [{
      suggestionId: "s-1", target: { kind: "task" }, reason: "表达更明确", proposedValue: "修改后的任务"
    }]);
    const next = service.applySuggestions("thread-1", "goal-1", version.versionId, ["s-1"]);
    assert.equal(next.currentVersion.content.task, "修改后的任务");
    assert.equal(next.currentVersion.versionNumber, 2);
    assert.deepEqual(next.suggestions, []);
  } finally {
    storage?.close();
    rmSync(root, { recursive: true, force: true });
  }
});
