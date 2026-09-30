/**
 * Delivery Preference OS — typed document.style preferences for NewBrain.
 * Authoritative source is structured JSON; markdown rules only mirror a summary.
 */

export const DELIVERY_PREFERENCES_VERSION = 1;
export const DOCUMENT_STYLE_DOMAIN = "document.style";
export const DELIVERY_PREFERENCES_FILENAME = "delivery-preferences.json";

const SCOPES = new Set(["turn", "thread", "project"]);
const SOURCES = new Set(["user_explicit", "user_correction", "learning_answer", "inferred"]);

/** Map Chinese / friendly names to Word/PDF font family names. */
const FONT_ALIASES = {
  宋体: "SimSun",
  新宋体: "NSimSun",
  仿宋: "FangSong",
  楷体: "KaiTi",
  黑体: "SimHei",
  微软雅黑: "Microsoft YaHei",
  雅黑: "Microsoft YaHei",
  simsun: "SimSun",
  nsimsun: "NSimSun",
  fangsong: "FangSong",
  kaiti: "KaiTi",
  simhei: "SimHei",
  "microsoft yahei": "Microsoft YaHei",
  msyh: "Microsoft YaHei"
};

export function emptyDeliveryPreferences() {
  return { version: DELIVERY_PREFERENCES_VERSION, domains: {} };
}

export function normalizeFontFamily(name) {
  const raw = String(name || "").trim();
  if (!raw) return "";
  const mapped = FONT_ALIASES[raw] || FONT_ALIASES[raw.toLowerCase()];
  return mapped || raw;
}

/** Windows / Linux font file candidates for PDFKit. */
export function fontFileCandidates(fontFamily, platform = process.platform) {
  const family = normalizeFontFamily(fontFamily) || "Microsoft YaHei";
  const key = family.toLowerCase();
  if (platform === "win32") {
    if (key.includes("simsun") || key === "nsimsun") {
      return ["C:/Windows/Fonts/simsun.ttc", "C:/Windows/Fonts/simsun.ttf", "C:/Windows/Fonts/msyh.ttc"];
    }
    if (key.includes("simhei") || key.includes("hei")) {
      return ["C:/Windows/Fonts/simhei.ttf", "C:/Windows/Fonts/msyh.ttc"];
    }
    if (key.includes("kaiti") || key.includes("kai")) {
      return ["C:/Windows/Fonts/simkai.ttf", "C:/Windows/Fonts/msyh.ttc"];
    }
    if (key.includes("fangsong")) {
      return ["C:/Windows/Fonts/simfang.ttf", "C:/Windows/Fonts/msyh.ttc"];
    }
    return ["C:/Windows/Fonts/msyh.ttc", "C:/Windows/Fonts/simhei.ttf", "C:/Windows/Fonts/simsun.ttc"];
  }
  return [
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
  ];
}

function clampConfidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0.5;
  return Math.max(0, Math.min(1, number));
}

function cleanText(value, limit = 120) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

export function normalizeDocumentStyleValues(input = {}) {
  const values = {};
  const fontFamily = normalizeFontFamily(input.fontFamily);
  if (fontFamily) values.fontFamily = fontFamily;
  const fontSizePt = Number(input.fontSizePt);
  if (Number.isFinite(fontSizePt) && fontSizePt > 0 && fontSizePt <= 72) {
    values.fontSizePt = Math.round(fontSizePt * 10) / 10;
  }
  const lineSpacing = Number(input.lineSpacing);
  if (Number.isFinite(lineSpacing) && lineSpacing >= 1 && lineSpacing <= 3) {
    values.lineSpacing = Math.round(lineSpacing * 100) / 100;
  }
  if (typeof input.headingBold === "boolean") values.headingBold = input.headingBold;
  const titleFontSizePt = Number(input.titleFontSizePt);
  if (Number.isFinite(titleFontSizePt) && titleFontSizePt > 0 && titleFontSizePt <= 96) {
    values.titleFontSizePt = Math.round(titleFontSizePt * 10) / 10;
  }
  if (input.marginsMm && typeof input.marginsMm === "object") {
    const margins = {};
    for (const edge of ["top", "right", "bottom", "left"]) {
      const mm = Number(input.marginsMm[edge]);
      if (Number.isFinite(mm) && mm >= 0 && mm <= 80) margins[edge] = Math.round(mm);
    }
    if (Object.keys(margins).length) values.marginsMm = margins;
  }
  return values;
}

export function summarizeDocumentStyle(values = {}) {
  const parts = [];
  if (values.fontFamily) parts.push(values.fontFamily);
  if (values.fontSizePt) parts.push(`${values.fontSizePt}pt`);
  if (values.lineSpacing) parts.push(`行距${values.lineSpacing}`);
  if (values.headingBold === true) parts.push("标题加粗");
  if (values.headingBold === false) parts.push("标题不加粗");
  if (values.titleFontSizePt) parts.push(`标题${values.titleFontSizePt}pt`);
  if (values.marginsMm) {
    const { top, right, bottom, left } = values.marginsMm;
    parts.push(`页边距${[top, right, bottom, left].filter((item) => item != null).join("/")}mm`);
  }
  return parts.join(" ") || "默认版式";
}

export function normalizeDocumentStyleDomain(input = {}) {
  const values = normalizeDocumentStyleValues(input.values || input);
  if (!Object.keys(values).length) return null;
  const scope = SCOPES.has(input.scope) ? input.scope : "thread";
  const source = SOURCES.has(input.source) ? input.source : "inferred";
  return {
    scope,
    confidence: clampConfidence(input.confidence ?? 0.8),
    updatedAt: input.updatedAt || new Date().toISOString(),
    source,
    values,
    summary: cleanText(input.summary) || summarizeDocumentStyle(values)
  };
}

export function parseDeliveryPreferences(raw) {
  const empty = emptyDeliveryPreferences();
  if (!raw || typeof raw !== "object") return empty;
  const domains = {};
  const style = normalizeDocumentStyleDomain(raw.domains?.[DOCUMENT_STYLE_DOMAIN] || raw[DOCUMENT_STYLE_DOMAIN]);
  if (style) domains[DOCUMENT_STYLE_DOMAIN] = style;
  return {
    version: Number(raw.version) === DELIVERY_PREFERENCES_VERSION ? DELIVERY_PREFERENCES_VERSION : DELIVERY_PREFERENCES_VERSION,
    domains
  };
}

/** Field-level merge: later layers override earlier when they set a value. */
export function mergeDocumentStyleValues(...layers) {
  const merged = {};
  for (const layer of layers) {
    if (!layer || typeof layer !== "object") continue;
    const normalized = normalizeDocumentStyleValues(layer);
    for (const [key, value] of Object.entries(normalized)) {
      if (key === "marginsMm") {
        merged.marginsMm = { ...(merged.marginsMm || {}), ...value };
      } else {
        merged[key] = value;
      }
    }
  }
  return merged;
}

/**
 * Resolve effective document.style values.
 * Order: builtin < project < thread < turn < explicit tool args.
 */
export function resolveDocumentStyle(input = {}) {
  const project = parseDeliveryPreferences(input.project).domains[DOCUMENT_STYLE_DOMAIN]?.values;
  const thread = parseDeliveryPreferences(input.thread).domains[DOCUMENT_STYLE_DOMAIN]?.values;
  const turn = normalizeDocumentStyleValues(input.turn || {});
  const explicit = normalizeDocumentStyleValues(input.explicit || input.style || {});
  const values = mergeDocumentStyleValues(input.builtin || {}, project, thread, turn, explicit);
  return {
    values,
    summary: summarizeDocumentStyle(values),
    layers: {
      project: Boolean(project && Object.keys(project).length),
      thread: Boolean(thread && Object.keys(thread).length),
      turn: Boolean(Object.keys(turn).length),
      explicit: Boolean(Object.keys(explicit).length)
    }
  };
}

export function applyDocumentStyleDomain(file, domain) {
  const next = parseDeliveryPreferences(file);
  const normalized = normalizeDocumentStyleDomain(domain);
  if (!normalized) {
    delete next.domains[DOCUMENT_STYLE_DOMAIN];
    return next;
  }
  // Persist scope is never "turn"
  if (normalized.scope === "turn") normalized.scope = "thread";
  next.domains[DOCUMENT_STYLE_DOMAIN] = normalized;
  return next;
}

export function clearDocumentStyleDomain(file) {
  const next = parseDeliveryPreferences(file);
  delete next.domains[DOCUMENT_STYLE_DOMAIN];
  return next;
}

export function hasDocumentStyle(file) {
  const style = parseDeliveryPreferences(file).domains[DOCUMENT_STYLE_DOMAIN];
  return Boolean(style && Object.keys(style.values || {}).length);
}

export function formatDeliveryPreferencesPromptBlock(input = {}) {
  const resolved = resolveDocumentStyle(input);
  if (!Object.keys(resolved.values).length) return "";
  const scopeHint = resolved.layers.thread ? "thread" : resolved.layers.project ? "project" : "active";
  return [
    "[delivery.preferences]",
    `document.style @${scopeHint}: ${resolved.summary}`,
    "When calling document.create_* / artifact.create for documents, obey these defaults unless the user overrides for this turn."
  ].join("\n");
}

/** Convert line spacing multiplier to PDFKit lineGap (approx at body size). */
export function lineSpacingToPdfLineGap(lineSpacing, fontSizePt = 11) {
  const spacing = Number(lineSpacing);
  if (!Number.isFinite(spacing) || spacing <= 1) return 4;
  return Math.max(2, Math.round(fontSizePt * (spacing - 1) * 1.15));
}

/** Convert line spacing to docx paragraph line spacing (240 = single). */
export function lineSpacingToDocxLine(lineSpacing) {
  const spacing = Number(lineSpacing);
  if (!Number.isFinite(spacing) || spacing <= 0) return 276;
  return Math.round(240 * spacing);
}

export function mmToPdfPoints(mm) {
  const value = Number(mm);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 2.83465);
}

/** Attach resolved style onto artifact/document create input (non-destructive). */
export function attachResolvedStyleToInput(input, resolvedValues) {
  const values = normalizeDocumentStyleValues(resolvedValues || {});
  if (!Object.keys(values).length) return input;
  return {
    ...input,
    style: {
      ...(input?.style && typeof input.style === "object" ? input.style : {}),
      ...values
    }
  };
}

export function deliveryRulesSummaryLine(values) {
  const summary = summarizeDocumentStyle(values);
  return `交付版式: ${summary}`;
}

/**
 * UI chip / banner state for composer.
 * @param {{ thread?: object, project?: object, openQuestions?: string[] }} input
 */
export function buildDeliveryPreferenceUiState(input = {}) {
  const thread = parseDeliveryPreferences(input.thread);
  const project = parseDeliveryPreferences(input.project);
  const resolved = resolveDocumentStyle({ thread, project });
  const threadHas = hasDocumentStyle(thread);
  const projectHas = hasDocumentStyle(project);
  const openQuestions = (Array.isArray(input.openQuestions) ? input.openQuestions : [])
    .map((line) => String(line || "").trim())
    .filter(Boolean);
  const styleGapQuestion = openQuestions.find((line) => /待确认交付版式|字体和行距/.test(line)) || "";
  const scope = threadHas ? "thread" : projectHas ? "project" : null;
  return {
    visible: Boolean(Object.keys(resolved.values).length),
    hasStyle: Boolean(Object.keys(resolved.values).length),
    scope,
    scopeLabel: scope === "thread" ? "本对话" : scope === "project" ? "项目默认" : "",
    summary: resolved.summary,
    values: resolved.values,
    canClear: threadHas || projectHas,
    canPin: threadHas && !projectHas,
    canUnpin: projectHas,
    styleGapQuestion,
    thread,
    project
  };
}
