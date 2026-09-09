/**
 * Multi-genre × multi-format writing delivery matrix for NewBrain.
 *
 * Layer A: native artifact.create for speech / case-study / notice / research / briefing / ledger
 *          across pdf / docx / xlsx / pptx with independent parsers.
 * Layer B: government agent-loop native delivery (confirmed-spec → draft → artifact.create)
 *          for representative genre × format pairs.
 *
 * Usage:
 *   node scripts/test-writing-format-matrix.mjs
 */
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";
import ExcelJS from "exceljs";
import JSZip from "jszip";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const agentdRoot = path.resolve(desktopRoot, "../agentd");
const reportRoot = path.resolve(desktopRoot, "../../../integration-artifacts/writing-format-matrix");
const runId = new Date().toISOString().replace(/[:.]/g, "-");

const { createBuiltinToolRegistry } = await import(pathToFileURL(path.join(agentdRoot, "src/tool-registry.js")).href);
const { createLocalRuntime } = await import(pathToFileURL(path.join(desktopRoot, "src/main/agent-runtime-adapter.ts")).href);
const { ModelChatAgentLoopService } = await import(
  pathToFileURL(path.join(desktopRoot, "src/main/model-chat-agent-loop-service.ts")).href
);
const { requestedArtifactTargetPath } = await import(
  pathToFileURL(path.join(desktopRoot, "src/main/artifact-request-policy.js")).href
);
const { shouldAutomaticallyUseGovernmentWriting } = await import(
  pathToFileURL(path.join(desktopRoot, "src/main/government-skill-routing.js")).href
);

const DRAFTS = {
  speech: [
    "同志们：",
    "过去一年，我们坚持安全生产底线，持续优化现场管理和设备维护，生产组织更加稳健。",
    "一、安全生产。压实责任、排查隐患，全年未发生较大及以上安全事故。",
    "二、稳产保供。围绕重点任务协同发力，保障生产节奏平稳有序。",
    "三、下一步安排。继续压实安全责任，推进智能化建设，强化成本管控和人才培养。",
    "感谢大家一年来的辛勤付出，让我们凝心聚力、稳中求进，共同推动企业高质量发展。"
  ].join("\n"),
  caseStudy: [
    "# 因地制宜发展新质生产力——地方实践探索",
    "",
    "一、背景情况",
    "发展新质生产力没有固定模式，必须立足资源禀赋与产业基础，把特色产业做到极致。",
    "",
    "二、主要做法",
    "（一）科技赋能传统产业。推进育种攻关、农机装备与数字化应用。",
    "（二）深耕先进制造。推动智改数转并布局先进制造业集群。",
    "（三）辨识禀赋开辟新赛道。依托绿电与散热优势建设算力产业集群。",
    "",
    "三、启示意义",
    "因地制宜发展新质生产力，要把创新做实、把产业做强，既培育新动能也更新旧动能。"
  ].join("\n"),
  notice: [
    "关于进一步做好安全生产排查整改工作的通知",
    "",
    "各责任单位：",
    "为压实安全责任、消除隐患，现就有关事项通知如下。",
    "一、全面排查。对照清单逐项检查，做到不留死角。",
    "二、限期整改。对发现的问题明确责任人、时限和验收标准。",
    "三、跟踪问效。定期复盘进展，重大问题及时报告。",
    "请各单位认真组织落实。"
  ].join("\n"),
  research: [
    "# 关于优化政务服务流程的调研报告",
    "",
    "一、调研背景",
    "围绕办事环节多、材料重复提交等问题开展调研，梳理堵点难点。",
    "",
    "二、主要问题",
    "跨部门协同不足，标准口径不够统一，影响企业和群众办事体验。",
    "",
    "三、对策建议",
    "推进事项标准化、材料复用和过程透明，强化责任清单与时限管理。"
  ].join("\n"),
  briefing: [
    "# 季度工作推进会汇报要点",
    "",
    "## 总体进展",
    "重点任务按计划推进，风险总体可控。",
    "",
    "## 下步安排",
    "- 压实责任",
    "- 加快协同",
    "- 强化督导"
  ].join("\n"),
  ledger: [
    "工作台账",
    "序号\t事项\t责任单位\t完成时限\t状态",
    "1\t安全排查\t安环部\t本月底\t进行中",
    "2\t流程优化\t综合办\t下月底\t待启动",
    "3\t培训演练\t人力部\t本季度\t已完成"
  ].join("\n")
};

const MATRIX = [
  { id: "A-SPEECH-PDF", layer: "A", genre: "speech", format: "pdf", mustMatch: [/同志们/, /安全生产/, /高质量发展/] },
  { id: "A-SPEECH-DOCX", layer: "A", genre: "speech", format: "docx", mustMatch: [/同志们/, /安全生产/] },
  { id: "A-CASE-PDF", layer: "A", genre: "caseStudy", format: "pdf", mustMatch: [/新质生产力/, /因地制宜/, /启示/] },
  { id: "A-CASE-DOCX", layer: "A", genre: "caseStudy", format: "docx", mustMatch: [/新质生产力/, /主要做法/] },
  { id: "A-NOTICE-PDF", layer: "A", genre: "notice", format: "pdf", mustMatch: [/通知/, /排查/, /整改/] },
  { id: "A-NOTICE-DOCX", layer: "A", genre: "notice", format: "docx", mustMatch: [/各责任单位/, /跟踪问效/] },
  { id: "A-RESEARCH-PDF", layer: "A", genre: "research", format: "pdf", mustMatch: [/调研报告/, /对策建议/] },
  { id: "A-RESEARCH-DOCX", layer: "A", genre: "research", format: "docx", mustMatch: [/调研背景/, /主要问题/] },
  { id: "A-BRIEF-PPTX", layer: "A", genre: "briefing", format: "pptx", mustMatch: [/季度工作|总体进展|下步安排/] },
  { id: "A-LEDGER-XLSX", layer: "A", genre: "ledger", format: "xlsx", mustMatch: [/工作台账|安全排查|责任单位/] },
  { id: "B-SPEECH-PDF", layer: "B", genre: "speech", format: "pdf", request: "写一个煤炭企业年终总结发言稿，约400字，输出PDF文件。", mustMatch: [/同志们/, /安全生产/] },
  { id: "B-SPEECH-DOCX", layer: "B", genre: "speech", format: "docx", request: "写一个企业内部动员讲话稿，输出Word文档。", mustMatch: [/同志们/, /高质量发展/] },
  { id: "B-CASE-PDF", layer: "B", genre: "caseStudy", format: "pdf", request: "请撰写一篇关于因地制宜发展新质生产力的典型案例研究文章，输出PDF文件。", mustMatch: [/新质生产力/, /因地制宜/] },
  { id: "B-NOTICE-DOCX", layer: "B", genre: "notice", format: "docx", request: "起草一份安全生产排查整改通知，输出docx文件。", mustMatch: [/通知/, /排查/] },
  { id: "B-BRIEF-PPTX", layer: "B", genre: "briefing", format: "pptx", request: "根据季度工作进展整理汇报要点，输出PPT文件。", mustMatch: [/进展|安排|责任/] },
  { id: "B-LEDGER-XLSX", layer: "B", genre: "ledger", format: "xlsx", request: "把重点工作事项整理成工作台账，输出Excel表格。", mustMatch: [/事项|责任|时限|状态|台账/] }
];

function assertContentMatches(text, patterns, caseId) {
  const compact = String(text ?? "").replace(/\s+/g, "");
  for (const pattern of patterns) {
    const source = (typeof pattern === "string" ? pattern : pattern.source).replace(/\\s\+/g, "").replace(/\s+/g, "");
    const flags = typeof pattern === "string" ? "u" : pattern.flags.replace(/g/g, "");
    assert.match(compact, new RegExp(source, flags), `${caseId} missing /${source}/ in: ${compact.slice(0, 240)}`);
  }
}

async function extractText(format, bytes) {
  if (format === "pdf") {
    const parser = new PDFParse({ data: bytes });
    try {
      return (await parser.getText()).text || "";
    } finally {
      await parser.destroy();
    }
  }
  if (format === "docx") {
    return (await mammoth.extractRawText({ buffer: bytes })).value || "";
  }
  if (format === "xlsx") {
    const workbook = new ExcelJS.Workbook();
    // ExcelJS accepts Buffer in Node; Uint8Array also works via Buffer.from
    await workbook.xlsx.load(Buffer.from(bytes));
    const chunks = [];
    workbook.eachSheet((sheet) => {
      sheet.eachRow((row) => {
        chunks.push(row.values.filter(Boolean).join(" "));
      });
    });
    return chunks.join("\n");
  }
  if (format === "pptx") {
    const zip = await JSZip.loadAsync(bytes);
    const slides = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name));
    const texts = [];
    for (const name of slides.sort()) {
      const xml = await zip.file(name).async("string");
      for (const match of xml.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g)) {
        if (match[1]) texts.push(match[1]);
      }
    }
    return texts.join("\n");
  }
  throw new Error(`Unsupported format: ${format}`);
}

function assertSignatures(format, bytes) {
  if (format === "pdf") {
    assert.equal(bytes.subarray(0, 5).toString("ascii"), "%PDF-");
    assert.match(bytes.subarray(-64).toString("latin1"), /%%EOF/);
  } else {
    assert.equal(bytes.subarray(0, 2).toString("ascii"), "PK", `${format} must be a ZIP/OOXML package`);
  }
  assert.ok(bytes.length > 400, `${format} too small: ${bytes.length}`);
}

async function runLayerA(caseItem, evidenceDir) {
  const registry = createBuiltinToolRegistry();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "newbrain-matrix-a-"));
  const targetPath = `outputs/${caseItem.genre}.${caseItem.format}`;
  const content = DRAFTS[caseItem.genre];
  const result = await registry.invoke("artifact.create", {
    targetPath,
    format: caseItem.format,
    title: `NewBrain ${caseItem.genre}`,
    content
  }, { workspacePath: root, shellEnv: process.env });
  assert.equal(result.ok, true, result.output);
  const absolute = path.join(root, targetPath);
  const bytes = await fs.readFile(absolute);
  assertSignatures(caseItem.format, bytes);
  const text = await extractText(caseItem.format, bytes);
  assertContentMatches(text, caseItem.mustMatch, caseItem.id);
  const saved = path.join(evidenceDir, `${caseItem.id}.${caseItem.format}`);
  await fs.copyFile(absolute, saved);
  await fs.rm(root, { recursive: true, force: true });
  return { path: saved, bytes: bytes.length, preview: text.replace(/\s+/g, " ").slice(0, 160) };
}

async function runLayerB(caseItem, evidenceDir) {
  const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "newbrain-matrix-b-"));
  const runtime = await createLocalRuntime({
    runtimeId: `matrix-${caseItem.id}`,
    workspacePath,
    platformLabel: "Windows",
    shellLabel: "PowerShell"
  });
  const draft = DRAFTS[caseItem.genre];
  const request = caseItem.request;
  const government = shouldAutomaticallyUseGovernmentWriting(request);
  const writtenArtifacts = [];
  const service = new ModelChatAgentLoopService({
    executeStep: async () => ({ content: draft, toolCalls: [] }),
    projectEvent: (projection, event) => {
      const artifact = event.payload?.result?.artifact;
      if (event.type === "tool_result" && event.payload?.result?.ok && artifact?.path && artifact?.size
        && !projection.writtenArtifacts.some((item) => item.path === artifact.path)) {
        projection.writtenArtifacts.push({
          path: artifact.path,
          size: artifact.size,
          changeType: artifact.changeType ?? "created"
        });
      }
    },
    runOutline: async (input) => input,
    runFinalization: async (input) => input,
    buildResult: (input) => ({
      skillDisclosure: "",
      canonicalContent: input.generatedContent,
      result: input
    })
  });
  const snapshot = {
    goal: { status: "active" },
    runtime: { phase: "running" },
    pendingQuestion: null,
    plan: [
      { stepId: "specification-confirmation", title: "确认写作规格", status: "completed", result: "confirmed" },
      { stepId: "draft", title: "起草正文", status: "completed", result: "done" },
      { stepId: "delivery", title: "交付", status: "completed", result: "ready" }
    ]
  };
  const output = await service.run({
    modelInput: { requestId: caseItem.id, permissionMode: "full" },
    runtime,
    abortController: new AbortController(),
    requestMessages: [{ role: "user", content: request }],
    effectiveSystemPrompt: "system",
    centralSkillNames: government ? ["government-research-writing"] : [],
    disclosedSkills: [],
    nativeWebSearches: [],
    writtenArtifacts,
    workspacePath,
    threadId: `thread-${caseItem.id}`,
    latestUserRequest: request,
    goalSnapshot: snapshot,
    reasoningSummaryParts: [],
    emitReasoningSummary: () => undefined,
    emitStream: () => undefined,
    publishRetry: () => undefined,
    publishWebSearch: () => undefined,
    publishActivity: () => undefined,
    recordTokens: () => undefined,
    setModelCallback: () => undefined,
    getGoalSnapshot: () => snapshot,
    governmentSpecificationSnapshot: government
      ? { currentVersionId: "v1", confirmedVersionId: "v1", currentVersion: { content: { task: caseItem.genre } } }
      : null
  });
  const relative = requestedArtifactTargetPath(request, caseItem.format, { government });
  const absolute = path.join(workspacePath, relative);
  const bytes = await fs.readFile(absolute);
  assertSignatures(caseItem.format, bytes);
  const text = await extractText(caseItem.format, bytes);
  assertContentMatches(text, caseItem.mustMatch, caseItem.id);
  assert.equal(
    output.writtenArtifacts.some((artifact) => artifact.path.endsWith(`.${caseItem.format}`)),
    true
  );
  const saved = path.join(evidenceDir, `${caseItem.id}.${caseItem.format}`);
  await fs.copyFile(absolute, saved);
  await fs.rm(workspacePath, { recursive: true, force: true });
  return {
    path: saved,
    bytes: bytes.length,
    government,
    preview: text.replace(/\s+/g, " ").slice(0, 160)
  };
}

const evidenceDir = path.join(reportRoot, runId);
await fs.mkdir(evidenceDir, { recursive: true });
const results = [];

console.log(`[writing-matrix] cases=${MATRIX.length} evidence=${evidenceDir}`);

for (const caseItem of MATRIX) {
  const started = Date.now();
  try {
    const detail = caseItem.layer === "A"
      ? await runLayerA(caseItem, evidenceDir)
      : await runLayerB(caseItem, evidenceDir);
    results.push({
      id: caseItem.id,
      status: "PASS",
      layer: caseItem.layer,
      genre: caseItem.genre,
      format: caseItem.format,
      elapsedMs: Date.now() - started,
      ...detail
    });
    console.log(`PASS ${caseItem.id} (${Date.now() - started}ms)`);
  } catch (error) {
    results.push({
      id: caseItem.id,
      status: "FAIL",
      layer: caseItem.layer,
      genre: caseItem.genre,
      format: caseItem.format,
      elapsedMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error)
    });
    console.error(`FAIL ${caseItem.id}: ${error instanceof Error ? error.message : error}`);
  }
}

const summary = {
  runId,
  generatedAt: new Date().toISOString(),
  totals: {
    pass: results.filter((item) => item.status === "PASS").length,
    fail: results.filter((item) => item.status === "FAIL").length,
    total: results.length
  },
  results
};
const reportPath = path.join(evidenceDir, "report.json");
await fs.writeFile(reportPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(`[writing-matrix] report=${reportPath}`);
console.log(`[writing-matrix] PASS=${summary.totals.pass} FAIL=${summary.totals.fail}`);

if (summary.totals.fail > 0) {
  process.exitCode = 1;
}
