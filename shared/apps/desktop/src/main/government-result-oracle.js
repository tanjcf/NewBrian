/**
 * Builds acceptance checks from a government-writing result oracle document.
 * The oracle is a validation artifact only: runtime writing must not import it as
 * a fixed scene template, and another oracle file can replace it without code edits.
 */
function extractSectionHeadings(text) {
  return [...text.matchAll(/(?:^|\n)\s*((?:[一二三四五六七八九十]+、|（[一二三四五六七八九十]+）|摘要|知识链接|问题讨论)[^\n]{0,40})/gu)]
    .map((match) => String(match[1] ?? "").trim())
    .filter(Boolean);
}

function extractChineseSegments(text) {
  return String(text ?? "").split(/[^\u4e00-\u9fa5]+/u).filter((segment) => segment.length >= 4);
}

/** Prefer longer phrases; drop nested substrings of an already kept phrase. */
function dedupeNestedPhrases(phrases) {
  const sorted = [...phrases].sort((left, right) => right.length - left.length || left.localeCompare(right, "zh"));
  const kept = [];
  for (const phrase of sorted) {
    if (kept.some((owner) => owner.includes(phrase))) continue;
    kept.push(phrase);
  }
  return kept;
}

function phrasesOverlapHeavily(left, right) {
  if (left.includes(right) || right.includes(left)) return true;
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length <= right.length ? right : left;
  const need = Math.max(4, Math.ceil(shorter.length * 0.6));
  for (let index = 0; index + need <= shorter.length; index += 1) {
    if (longer.includes(shorter.slice(index, index + need))) return true;
  }
  return false;
}

/** Sliding Chinese n-grams ranked by full-document frequency (scenario-agnostic). */
function extractRankedPhrases(text, options = {}) {
  const minLen = Number(options.minLen) > 0 ? Number(options.minLen) : 4;
  const maxLen = Number(options.maxLen) > 0 ? Number(options.maxLen) : 6;
  const limit = Number(options.limit) > 0 ? Number(options.limit) : 16;
  const minHits = Number(options.minHits) > 0 ? Number(options.minHits) : 2;
  const stop = options.stop instanceof RegExp
    ? options.stop
    : /这些实践|具有重要|近年来|示范借鉴意义|丰富发展了|重要论述|习近平总书记|习近平|总书记|人民政府|有关部门|生产力的|不是|而是|对于理解/u;
  const seed = String(options.seedText ?? text);
  const candidates = new Set();
  for (const segment of extractChineseSegments(seed)) {
    const upper = Math.min(maxLen, segment.length);
    for (let len = minLen; len <= upper; len += 1) {
      for (let index = 0; index + len <= segment.length; index += 1) {
        candidates.add(segment.slice(index, index + len));
      }
    }
  }
  const ranked = [...candidates]
    .filter((phrase) => !stop.test(phrase))
    .map((phrase) => ({ phrase, hits: text.split(phrase).length - 1 }))
    .filter((item) => item.hits >= minHits)
    .sort((left, right) => right.hits - left.hits || right.phrase.length - left.phrase.length);
  const selected = [];
  for (const item of ranked) {
    if (selected.some((owner) => phrasesOverlapHeavily(owner, item.phrase))) continue;
    selected.push(item.phrase);
    if (selected.length >= limit) break;
  }
  return dedupeNestedPhrases(selected);
}

function extractDistinctivePhrases(text) {
  const abstract = text.match(/摘要[：:\s]*([\s\S]{0,900})/u)?.[1] ?? text.slice(0, 900);
  return extractRankedPhrases(text, { seedText: abstract, limit: 16, minHits: 1 });
}

function extractThemePhrases(text) {
  const titleLine = text.split(/\n+/).map((line) => line.trim()).find(Boolean) ?? "";
  const abstract = text.match(/摘要[：:\s]*([\s\S]{0,900})/u)?.[1] ?? "";
  const head = `${titleLine}\n${abstract}\n${text.slice(0, 1_200)}`;
  return extractRankedPhrases(text, { seedText: head, limit: 8, minHits: 2, minLen: 4, maxLen: 6 });
}

export function buildGovernmentResultOracle(goldText) {
  const text = String(goldText ?? "").replace(/\r/g, "").trim();
  if (!text) throw new Error("结果校验文件为空。");

  const headings = extractSectionHeadings(text);
  const distinctivePhrases = extractDistinctivePhrases(text);
  const themePhrases = extractThemePhrases(text);
  const requiredPhrases = [...new Set([...themePhrases, ...distinctivePhrases.slice(0, 8)])];

  return {
    sourceKind: "result-oracle",
    characterCount: Array.from(text).length,
    headings,
    distinctivePhrases,
    themePhrases,
    requiredPhrases,
    forbiddenCrossScene: [],
    structuralHints: {
      hasAbstract: /摘要/.test(text),
      hasBackground: /一、背景|背景情况/.test(text),
      hasPractices: /二、主要做法|主要做法/.test(text),
      hasImplications: /三、启示|启示意义/.test(text),
      hasKnowledgeLink: /知识链接/.test(text),
      hasDiscussion: /问题讨论/.test(text)
    }
  };
}

export function scoreGovernmentResultAgainstOracle(candidateText, oracle, options = {}) {
  const candidate = String(candidateText ?? "");
  const compact = candidate.replace(/\s+/g, "");
  const forbidden = Array.isArray(options.forbiddenCrossScene)
    ? options.forbiddenCrossScene
    : oracle.forbiddenCrossScene;
  const hitRequired = oracle.requiredPhrases.filter((phrase) => candidate.includes(phrase));
  const missingRequired = oracle.requiredPhrases.filter((phrase) => !candidate.includes(phrase));
  const leakedForbidden = forbidden.filter((phrase) => candidate.includes(phrase));
  const structureHits = {
    abstract: oracle.structuralHints.hasAbstract ? /摘要/.test(candidate) : null,
    background: oracle.structuralHints.hasBackground ? /背景/.test(candidate) : null,
    practices: oracle.structuralHints.hasPractices ? /做法|实践/.test(candidate) : null,
    implications: oracle.structuralHints.hasImplications ? /启示|经验/.test(candidate) : null
  };
  const requiredHitRate = oracle.requiredPhrases.length
    ? hitRequired.length / oracle.requiredPhrases.length
    : 0;
  const structurePass = Object.values(structureHits).every((value) => value !== false);
  const minCharacters = Number(options.minCharacters) > 0
    ? Number(options.minCharacters)
    : Math.min(2_000, Math.floor(oracle.characterCount * 0.35));
  return {
    pass: requiredHitRate >= 0.5 && leakedForbidden.length === 0 && structurePass && compact.length >= minCharacters,
    requiredHitRate,
    hitRequired,
    missingRequired,
    leakedForbidden,
    structureHits,
    candidateCharacters: Array.from(candidate).length,
    minCharacters
  };
}

/** Independent file-level check: final delivery must score against the result-oracle gold file. */
export async function assertGovernmentDeliveryMatchesOracle(input) {
  const { readFile } = await import("node:fs/promises");
  const candidatePath = String(input.candidatePath ?? "").trim();
  const oraclePath = String(input.oraclePath ?? "").trim();
  if (!candidatePath) throw new Error("缺少待校验交付文件路径。");
  if (!oraclePath) throw new Error("缺少结果校验金标路径。");
  let candidateText = "";
  if (/\.docx$/i.test(candidatePath)) {
    const mammoth = await import("mammoth");
    candidateText = String((await mammoth.extractRawText({ path: candidatePath })).value || "");
  } else if (/\.pdf$/i.test(candidatePath)) {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: await readFile(candidatePath) });
    candidateText = String((await parser.getText()).text || "");
    await parser.destroy();
  } else {
    candidateText = await readFile(candidatePath, "utf8");
  }
  let goldText = "";
  if (/\.docx$/i.test(oraclePath)) {
    const mammoth = await import("mammoth");
    goldText = String((await mammoth.extractRawText({ path: oraclePath })).value || "");
  } else {
    goldText = await readFile(oraclePath, "utf8");
  }
  const oracle = buildGovernmentResultOracle(goldText);
  const scored = scoreGovernmentResultAgainstOracle(candidateText, oracle, input.options);
  if (!scored.pass) {
    throw new Error(
      `交付文件未通过金标校验：hitRate=${scored.requiredHitRate.toFixed(2)} missing=${scored.missingRequired.slice(0, 5).join("|")} leaked=${scored.leakedForbidden.join("|")}`
    );
  }
  return { oracle, scored, candidatePath, oraclePath };
}
