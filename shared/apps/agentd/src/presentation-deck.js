/**
 * Shared presentation deck engine for NewBrain artifact.create.
 * Produces modern multi-layout PPTX and Cursor-style HTML slide decks.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import PptxGenJS from "pptxgenjs";
import { localizeChineseDoubleQuotes } from "./chinese-typography.js";

const FONT = "Microsoft YaHei";

/** Clean premium palette — ink + teal, not default Office blue-gray. */
export const DECK_THEME = Object.freeze({
  ink: "0F172A",
  inkSoft: "1E293B",
  accent: "0D9488",
  accentSoft: "14B8A6",
  surface: "F8FAFC",
  surfaceAlt: "F1F5F9",
  card: "FFFFFF",
  text: "0F172A",
  muted: "475569",
  onDark: "F8FAFC",
  onDarkMuted: "94A3B8",
  line: "E2E8F0"
});

const text = (value, fallback = "") => (typeof value === "string" ? value.trim() : fallback);

function strip(value) {
  return localizeChineseDoubleQuotes(String(value ?? "")
    .replace(/!\[[^\]]*]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/(?<![\w*])\*([^*\n]+)\*(?![\w*])/g, "$1")
    .replace(/(?<![\w_])_([^_\n]+)_(?![\w_])/g, "$1")
    .trim());
}

const LAYOUTS = ["title", "section", "bullets", "columns", "cards", "closing", "stat", "chart", "timeline", "process", "image"];

const CHART_TYPES = new Set(["bar", "line", "pie", "doughnut", "area"]);

function normalizeChart(source) {
  if (!source || typeof source !== "object") return null;
  const type = text(source.type, "bar").toLowerCase();
  const categories = Array.isArray(source.categories)
    ? source.categories.map((item) => strip(text(item))).filter(Boolean)
    : Array.isArray(source.labels)
      ? source.labels.map((item) => strip(text(item))).filter(Boolean)
      : [];
  const rawSeries = Array.isArray(source.series) ? source.series : [];
  let series = rawSeries.map((entry) => ({
    name: strip(text(entry?.name, "系列")),
    values: Array.isArray(entry?.values)
      ? entry.values.map((value) => Number(value)).filter((value) => Number.isFinite(value))
      : []
  })).filter((entry) => entry.values.length);
  if (!series.length && Array.isArray(source.values)) {
    const values = source.values.map((value) => Number(value)).filter((value) => Number.isFinite(value));
    if (values.length) series = [{ name: strip(text(source.seriesName, "数据")), values }];
  }
  if (!series.length) return null;
  const labels = categories.length ? categories : series[0].values.map((_, index) => `项 ${index + 1}`);
  return { type: CHART_TYPES.has(type) ? type : "bar", categories: labels, series };
}

function normalizePhases(source) {
  if (!Array.isArray(source)) return [];
  return source.map((phase, index) => ({
    label: strip(text(phase?.label, `P${index + 1}`)) || `P${index + 1}`,
    title: strip(text(phase?.title, "")),
    body: strip(text(phase?.body))
  })).filter((phase) => phase.title || phase.body).slice(0, 6);
}

/**
 * Resolve a workspace-relative asset for slide image embedding.
 *
 * @param {string | undefined} workspaceRoot Workspace root directory
 * @param {string} target Absolute ppt/html output path
 * @param {string} imagePath Workspace-relative or absolute image path
 */
export async function resolveDeckAssetPath(workspaceRoot, target, imagePath) {
  const candidate = text(imagePath);
  if (!candidate) return null;
  const attempts = [
    path.isAbsolute(candidate) ? candidate : null,
    workspaceRoot ? path.resolve(workspaceRoot, candidate.replace(/^\.\//, "")) : null,
    path.resolve(path.dirname(target), candidate.replace(/^\.\//, ""))
  ].filter(Boolean);
  for (const attempt of attempts) {
    try {
      const stat = await fs.stat(attempt);
      if (stat.isFile() && stat.size > 0) return attempt;
    } catch {
      // try next candidate
    }
  }
  return null;
}

/**
 * Infer a slide layout from content when the model omits `layout`.
 *
 * @param {Record<string, unknown>} slide Slide payload
 * @param {{ index: number; total: number; deckTitle: string }} context Deck position
 * @returns {"title"|"section"|"bullets"|"columns"|"cards"|"closing"|"stat"|"chart"|"timeline"|"image"}
 */
export function inferSlideLayout(slide, context) {
  let explicit = text(slide?.layout).toLowerCase();
  if (explicit === "process") explicit = "timeline";
  if (LAYOUTS.includes(explicit)) {
    return /** @type {any} */ (explicit === "process" ? "timeline" : explicit);
  }
  if (normalizeChart(slide?.chart)) return "chart";
  if (normalizePhases(slide?.phases).length >= 2) return "timeline";
  if (text(slide?.imagePath) || text(slide?.imagePlaceholder)) return "image";
  const title = text(slide?.title);
  const body = text(slide?.body);
  const bullets = Array.isArray(slide?.bullets)
    ? slide.bullets.map((item) => strip(text(item))).filter(Boolean)
    : [];
  if (context.index === 0 && (title === context.deckTitle || !bullets.length)) {
    if (!bullets.length && (!body || body.length < 120)) return "title";
  }
  if (/谢谢|感谢|结语|结束|thank\s*you|closing|下一步行动/i.test(title) && bullets.length <= 2) {
    return "closing";
  }
  if (/^0?\d+$/.test(title) || /第\s*[一二三四五六七八九十\d]+\s*[章节部分篇]/u.test(title)) {
    if (bullets.length <= 1 && body.length < 80) return "section";
  }
  if (bullets.length === 1 && /^[\d.]+%?$/.test(bullets[0]) && body) return "stat";
  if (Array.isArray(slide?.columns) && slide.columns.length >= 2) return "columns";
  if (Array.isArray(slide?.cards) && slide.cards.length >= 2) return "cards";
  if (bullets.length >= 3 && bullets.every((item) => item.includes("：") || item.includes(":"))) {
    return "cards";
  }
  if (bullets.length >= 4 && bullets.length % 2 === 0) return "columns";
  return "bullets";
}

/**
 * Normalize model slides into a renderable deck plan.
 *
 * @param {{ title?: string; slides?: unknown[]; sections?: unknown[]; content?: string; subtitle?: string }} input Artifact input
 * @param {(input: unknown) => Array<{ heading: string; body: string; bullets: string[] }>} sectionsFn sections helper
 * @returns {{ deckTitle: string; slides: Array<Record<string, unknown>> }}
 */
export function planPresentationDeck(input, sectionsFn) {
  const deckTitle = strip(text(input?.title, "演示文稿")) || "演示文稿";
  let raw = Array.isArray(input?.slides) ? input.slides : [];
  if (!raw.length) {
    raw = sectionsFn(input).map((section) => ({
      title: section.heading || deckTitle,
      body: section.body,
      bullets: section.bullets,
      layout: "bullets"
    }));
  }
  if (!raw.length) {
    raw = [{ title: deckTitle, body: strip(text(input?.content)), bullets: [], layout: "title" }];
  }

  const slides = raw.map((source, index) => {
    const title = strip(text(source?.title, deckTitle)) || deckTitle;
    const body = strip(text(source?.body));
    const bullets = Array.isArray(source?.bullets)
      ? source.bullets.map((item) => strip(text(item))).filter(Boolean).slice(0, 6)
      : [];
    const columns = Array.isArray(source?.columns)
      ? source.columns.map((column) => ({
        title: strip(text(column?.title, "")),
        bullets: Array.isArray(column?.bullets)
          ? column.bullets.map((item) => strip(text(item))).filter(Boolean).slice(0, 5)
          : []
      })).filter((column) => column.title || column.bullets.length)
      : [];
    const cards = Array.isArray(source?.cards)
      ? source.cards.map((card) => ({
        title: strip(text(card?.title, "")),
        body: strip(text(card?.body))
      })).filter((card) => card.title || card.body).slice(0, 3)
      : [];
    const chart = normalizeChart(source?.chart);
    const phases = normalizePhases(source?.phases);
    const imagePath = text(source?.imagePath);
    const imagePlaceholder = strip(text(source?.imagePlaceholder));
    const caption = strip(text(source?.caption || source?.imageCaption));
    const layout = inferSlideLayout({
      ...source, title, body, bullets, columns, cards, chart, phases, imagePath, imagePlaceholder
    }, {
      index,
      total: raw.length,
      deckTitle
    });
    return {
      title, body, bullets, columns, cards, chart, phases, imagePath, imagePlaceholder, caption,
      layout, subtitle: strip(text(source?.subtitle))
    };
  });

  if (slides[0]?.layout !== "title" && slides[0]?.layout !== "closing") {
    slides.unshift({
      title: deckTitle,
      subtitle: strip(text(input?.subtitle)) || "",
      body: "",
      bullets: [],
      columns: [],
      cards: [],
      layout: "title"
    });
  }
  return { deckTitle, slides };
}

function addAccentBar(slide, deck, theme) {
  slide.addShape(deck.ShapeType.rect, {
    x: 0, y: 0, w: 13.333, h: 0.08,
    fill: { color: theme.accent }, line: { color: theme.accent }
  });
}

function addFooter(slide, deck, theme, page, total) {
  slide.addText(`${page} / ${total}`, {
    x: 11.2, y: 7.05, w: 1.6, h: 0.28,
    fontFace: FONT, fontSize: 10, color: theme.muted, align: "right", margin: 0
  });
}

function renderTitleSlide(deck, slideModel, theme) {
  const slide = deck.addSlide();
  slide.background = { color: theme.ink };
  slide.addShape(deck.ShapeType.rect, {
    x: 0, y: 0, w: 0.28, h: 7.5,
    fill: { color: theme.accent }, line: { color: theme.accent }
  });
  slide.addShape(deck.ShapeType.ellipse, {
    x: 10.2, y: -1.2, w: 5.2, h: 5.2,
    fill: { color: theme.inkSoft }, line: { color: theme.inkSoft }
  });
  slide.addText(slideModel.title, {
    x: 0.9, y: 2.35, w: 10.8, h: 1.4,
    fontFace: FONT, fontSize: 40, bold: true, color: theme.onDark, margin: 0, valign: "middle"
  });
  if (slideModel.subtitle || slideModel.body) {
    slide.addText(slideModel.subtitle || slideModel.body, {
      x: 0.9, y: 3.9, w: 9.5, h: 0.7,
      fontFace: FONT, fontSize: 18, color: theme.onDarkMuted, margin: 0
    });
  }
  slide.addText("NewBrain", {
    x: 0.9, y: 6.7, w: 4, h: 0.3,
    fontFace: FONT, fontSize: 12, color: theme.accentSoft, margin: 0
  });
}

function renderClosingSlide(deck, slideModel, theme) {
  const slide = deck.addSlide();
  slide.background = { color: theme.ink };
  slide.addShape(deck.ShapeType.rect, {
    x: 0, y: 6.9, w: 13.333, h: 0.6,
    fill: { color: theme.accent }, line: { color: theme.accent }
  });
  slide.addText(slideModel.title || "谢谢", {
    x: 0.9, y: 2.6, w: 11.5, h: 1.1,
    fontFace: FONT, fontSize: 44, bold: true, color: theme.onDark, align: "center", margin: 0
  });
  const detail = slideModel.body || slideModel.bullets.join(" · ");
  if (detail) {
    slide.addText(detail, {
      x: 1.5, y: 4.0, w: 10.3, h: 0.8,
      fontFace: FONT, fontSize: 16, color: theme.onDarkMuted, align: "center", margin: 0
    });
  }
}

function renderSectionSlide(deck, slideModel, theme, page, total) {
  const slide = deck.addSlide();
  slide.background = { color: theme.inkSoft };
  slide.addShape(deck.ShapeType.rect, {
    x: 0.9, y: 3.15, w: 1.1, h: 0.12,
    fill: { color: theme.accent }, line: { color: theme.accent }
  });
  slide.addText(slideModel.title, {
    x: 0.9, y: 3.4, w: 11.5, h: 0.9,
    fontFace: FONT, fontSize: 32, bold: true, color: theme.onDark, margin: 0
  });
  if (slideModel.body) {
    slide.addText(slideModel.body, {
      x: 0.9, y: 4.4, w: 11, h: 0.6,
      fontFace: FONT, fontSize: 16, color: theme.onDarkMuted, margin: 0
    });
  }
  addFooter(slide, deck, { ...theme, muted: theme.onDarkMuted }, page, total);
}

function renderBulletsSlide(deck, slideModel, theme, page, total) {
  const slide = deck.addSlide();
  slide.background = { color: theme.surface };
  addAccentBar(slide, deck, theme);
  slide.addShape(deck.ShapeType.rect, {
    x: 0.7, y: 0.55, w: 0.12, h: 0.55,
    fill: { color: theme.accent }, line: { color: theme.accent }
  });
  slide.addText(slideModel.title, {
    x: 1.0, y: 0.5, w: 11.3, h: 0.65,
    fontFace: FONT, fontSize: 28, bold: true, color: theme.text, margin: 0
  });
  let y = 1.45;
  if (slideModel.body) {
    slide.addText(slideModel.body, {
      x: 1.0, y, w: 11.2, h: 0.7,
      fontFace: FONT, fontSize: 16, color: theme.muted, margin: 0
    });
    y += 0.85;
  }
  const bullets = slideModel.bullets.slice(0, 5);
  if (bullets.length) {
    bullets.forEach((item, index) => {
      const rowY = y + index * 0.72;
      slide.addShape(deck.ShapeType.ellipse, {
        x: 0.95, y: rowY + 0.14, w: 0.14, h: 0.14,
        fill: { color: theme.accent }, line: { color: theme.accent }
      });
      slide.addText(item, {
        x: 1.3, y: rowY, w: 10.8, h: 0.65,
        fontFace: FONT, fontSize: 18, color: theme.text, margin: 0, valign: "middle"
      });
    });
  }
  addFooter(slide, deck, theme, page, total);
}

function renderColumnsSlide(deck, slideModel, theme, page, total) {
  const slide = deck.addSlide();
  slide.background = { color: theme.surface };
  addAccentBar(slide, deck, theme);
  slide.addText(slideModel.title, {
    x: 0.7, y: 0.45, w: 12, h: 0.6,
    fontFace: FONT, fontSize: 26, bold: true, color: theme.text, margin: 0
  });
  let columns = slideModel.columns;
  if (columns.length < 2) {
    const mid = Math.ceil(slideModel.bullets.length / 2) || 1;
    columns = [
      { title: "要点 A", bullets: slideModel.bullets.slice(0, mid) },
      { title: "要点 B", bullets: slideModel.bullets.slice(mid) }
    ];
  }
  columns.slice(0, 2).forEach((column, index) => {
    const x = 0.7 + index * 6.2;
    slide.addShape(deck.ShapeType.roundRect, {
      x, y: 1.35, w: 5.9, h: 5.2,
      fill: { color: theme.card }, line: { color: theme.line }, rectRadius: 0.12
    });
    slide.addShape(deck.ShapeType.rect, {
      x, y: 1.35, w: 5.9, h: 0.1,
      fill: { color: theme.accent }, line: { color: theme.accent }
    });
    slide.addText(column.title || `栏目 ${index + 1}`, {
      x: x + 0.35, y: 1.65, w: 5.2, h: 0.45,
      fontFace: FONT, fontSize: 18, bold: true, color: theme.text, margin: 0
    });
    if (column.bullets?.length) {
      slide.addText(
        column.bullets.map((item) => ({ text: item, options: { bullet: { indent: 12 }, breakLine: true } })),
        {
          x: x + 0.35, y: 2.3, w: 5.2, h: 3.8,
          fontFace: FONT, fontSize: 15, color: theme.muted, paraSpaceAfter: 10, margin: 0, valign: "top"
        }
      );
    }
  });
  addFooter(slide, deck, theme, page, total);
}

function renderCardsSlide(deck, slideModel, theme, page, total) {
  const slide = deck.addSlide();
  slide.background = { color: theme.surfaceAlt };
  addAccentBar(slide, deck, theme);
  slide.addText(slideModel.title, {
    x: 0.7, y: 0.45, w: 12, h: 0.55,
    fontFace: FONT, fontSize: 26, bold: true, color: theme.text, margin: 0
  });
  let cards = slideModel.cards;
  if (cards.length < 2) {
    cards = slideModel.bullets.slice(0, 3).map((item) => {
      const [heading, ...rest] = item.split(/[：:]/);
      return { title: heading.trim(), body: rest.join("：").trim() || item };
    });
  }
  const count = Math.min(3, Math.max(2, cards.length));
  const width = count === 2 ? 5.9 : 3.85;
  const gap = count === 2 ? 0.35 : 0.3;
  cards.slice(0, count).forEach((card, index) => {
    const x = 0.7 + index * (width + gap);
    slide.addShape(deck.ShapeType.roundRect, {
      x, y: 1.4, w: width, h: 5.0,
      fill: { color: theme.card }, line: { color: theme.line }, rectRadius: 0.14
    });
    slide.addShape(deck.ShapeType.ellipse, {
      x: x + 0.35, y: 1.75, w: 0.42, h: 0.42,
      fill: { color: theme.accent }, line: { color: theme.accent }
    });
    slide.addText(String(index + 1), {
      x: x + 0.35, y: 1.78, w: 0.42, h: 0.38,
      fontFace: FONT, fontSize: 14, bold: true, color: theme.onDark, align: "center", margin: 0
    });
    slide.addText(card.title || `要点 ${index + 1}`, {
      x: x + 0.35, y: 2.45, w: width - 0.7, h: 0.7,
      fontFace: FONT, fontSize: 18, bold: true, color: theme.text, margin: 0
    });
    slide.addText(card.body || "", {
      x: x + 0.35, y: 3.3, w: width - 0.7, h: 2.6,
      fontFace: FONT, fontSize: 14, color: theme.muted, margin: 0, valign: "top"
    });
  });
  addFooter(slide, deck, theme, page, total);
}

function renderChartSlide(deck, slideModel, theme, page, total) {
  const slide = deck.addSlide();
  slide.background = { color: theme.surface };
  addAccentBar(slide, deck, theme);
  slide.addText(slideModel.title, {
    x: 0.7, y: 0.45, w: 12, h: 0.55,
    fontFace: FONT, fontSize: 26, bold: true, color: theme.text, margin: 0
  });
  const chart = slideModel.chart;
  if (chart?.series?.length) {
    const chartData = chart.series.map((entry) => ({
      name: entry.name,
      labels: chart.categories,
      values: entry.values
    }));
    slide.addChart(deck.ChartType[chart.type] || deck.ChartType.bar, chartData, {
      x: 0.75, y: 1.15, w: 11.8, h: chart.type === "pie" || chart.type === "doughnut" ? 5.4 : 5.0,
      showLegend: chart.series.length > 1 || chart.type === "pie" || chart.type === "doughnut",
      legendPos: "b",
      chartColors: [theme.accent, theme.accentSoft, theme.inkSoft, theme.muted],
      valAxisLabelColor: theme.muted,
      catAxisLabelColor: theme.muted,
      dataLabelColor: theme.text,
      showValue: chart.type === "pie" || chart.type === "doughnut"
    });
  }
  if (slideModel.body) {
    slide.addText(slideModel.body, {
      x: 0.75, y: 6.35, w: 11.8, h: 0.45,
      fontFace: FONT, fontSize: 13, color: theme.muted, margin: 0
    });
  }
  addFooter(slide, deck, theme, page, total);
}

function renderTimelineSlide(deck, slideModel, theme, page, total) {
  const slide = deck.addSlide();
  slide.background = { color: theme.surfaceAlt };
  addAccentBar(slide, deck, theme);
  slide.addText(slideModel.title, {
    x: 0.7, y: 0.45, w: 12, h: 0.55,
    fontFace: FONT, fontSize: 26, bold: true, color: theme.text, margin: 0
  });
  const phases = slideModel.phases.slice(0, 5);
  const count = Math.max(2, phases.length);
  const gap = 0.25;
  const width = (12.0 - gap * (count - 1)) / count;
  phases.forEach((phase, index) => {
    const x = 0.65 + index * (width + gap);
    slide.addShape(deck.ShapeType.roundRect, {
      x, y: 1.55, w: width, h: 4.8,
      fill: { color: theme.card }, line: { color: theme.line }, rectRadius: 0.12
    });
    slide.addShape(deck.ShapeType.ellipse, {
      x: x + 0.35, y: 1.85, w: 0.55, h: 0.55,
      fill: { color: theme.accent }, line: { color: theme.accent }
    });
    slide.addText(phase.label, {
      x: x + 0.35, y: 1.88, w: 0.55, h: 0.48,
      fontFace: FONT, fontSize: 12, bold: true, color: theme.onDark, align: "center", margin: 0
    });
    slide.addText(phase.title, {
      x: x + 0.35, y: 2.65, w: width - 0.7, h: 0.7,
      fontFace: FONT, fontSize: 16, bold: true, color: theme.text, margin: 0
    });
    slide.addText(phase.body, {
      x: x + 0.35, y: 3.45, w: width - 0.7, h: 2.5,
      fontFace: FONT, fontSize: 13, color: theme.muted, margin: 0, valign: "top"
    });
    if (index < phases.length - 1) {
      slide.addShape(deck.ShapeType.chevron, {
        x: x + width + 0.02, y: 3.55, w: 0.22, h: 0.35,
        fill: { color: theme.accentSoft }, line: { color: theme.accentSoft }, rotate: 0
      });
    }
  });
  if (slideModel.body) {
    slide.addText(slideModel.body, {
      x: 0.7, y: 6.45, w: 12, h: 0.4,
      fontFace: FONT, fontSize: 13, color: theme.muted, margin: 0
    });
  }
  addFooter(slide, deck, theme, page, total);
}

function renderImageSlide(deck, slideModel, theme, page, total, resolvedImagePath) {
  const slide = deck.addSlide();
  slide.background = { color: theme.surface };
  addAccentBar(slide, deck, theme);
  slide.addText(slideModel.title, {
    x: 0.7, y: 0.45, w: 12, h: 0.55,
    fontFace: FONT, fontSize: 26, bold: true, color: theme.text, margin: 0
  });
  if (resolvedImagePath) {
    slide.addImage({
      path: resolvedImagePath,
      x: 0.85, y: 1.2, w: 11.6, h: slideModel.body || slideModel.caption ? 4.8 : 5.4,
      sizing: { type: "contain", w: 11.6, h: slideModel.body || slideModel.caption ? 4.8 : 5.4 }
    });
  } else {
    slide.addShape(deck.ShapeType.roundRect, {
      x: 0.85, y: 1.2, w: 11.6, h: 4.8,
      fill: { color: theme.surfaceAlt }, line: { color: theme.line }, rectRadius: 0.12
    });
    slide.addText(slideModel.imagePlaceholder || "配图占位\n可先调用 image_generate 生成图片，再传入 imagePath", {
      x: 1.2, y: 2.8, w: 10.8, h: 1.2,
      fontFace: FONT, fontSize: 16, color: theme.muted, align: "center", margin: 0
    });
  }
  const note = slideModel.caption || slideModel.body;
  if (note) {
    slide.addText(note, {
      x: 0.85, y: 6.25, w: 11.6, h: 0.5,
      fontFace: FONT, fontSize: 14, color: theme.muted, align: "center", margin: 0
    });
  }
  addFooter(slide, deck, theme, page, total);
}

function renderStatSlide(deck, slideModel, theme, page, total) {
  const slide = deck.addSlide();
  slide.background = { color: theme.surface };
  addAccentBar(slide, deck, theme);
  const stat = slideModel.bullets[0] || slideModel.body || "—";
  slide.addText(slideModel.title, {
    x: 0.9, y: 1.4, w: 11.5, h: 0.5,
    fontFace: FONT, fontSize: 18, color: theme.muted, align: "center", margin: 0
  });
  slide.addText(stat, {
    x: 0.9, y: 2.3, w: 11.5, h: 1.8,
    fontFace: FONT, fontSize: 72, bold: true, color: theme.accent, align: "center", margin: 0
  });
  if (slideModel.body && slideModel.body !== stat) {
    slide.addText(slideModel.body, {
      x: 1.8, y: 4.5, w: 9.7, h: 1.2,
      fontFace: FONT, fontSize: 18, color: theme.text, align: "center", margin: 0
    });
  }
  addFooter(slide, deck, theme, page, total);
}

/**
 * Write a multi-layout PPTX deck.
 *
 * @param {{ title?: string; slides?: unknown[]; sections?: unknown[]; content?: string; subtitle?: string }} input
 * @param {string} target Absolute output path
 * @param {(input: unknown) => Array<{ heading: string; body: string; bullets: string[] }>} sectionsFn
 * @param {{ workspaceRoot?: string }} [options]
 */
export async function writePptxDeck(input, target, sectionsFn, options = {}) {
  const { deckTitle, slides } = planPresentationDeck(input, sectionsFn);
  const theme = DECK_THEME;
  const deck = new PptxGenJS();
  deck.layout = "LAYOUT_WIDE";
  deck.author = "NewBrain";
  deck.title = deckTitle;
  deck.subject = deckTitle;
  deck.company = "NewBrain";
  deck.lang = "zh-CN";
  deck.theme = { headFontFace: FONT, bodyFontFace: FONT, lang: "zh-CN" };

  const assetCache = new Map();
  async function assetPath(imagePath) {
    const key = text(imagePath);
    if (!key) return null;
    if (assetCache.has(key)) return assetCache.get(key);
    const resolved = await resolveDeckAssetPath(options.workspaceRoot, target, key);
    assetCache.set(key, resolved);
    return resolved;
  }

  const total = slides.length;
  await fs.mkdir(path.dirname(target), { recursive: true });
  for (let index = 0; index < slides.length; index += 1) {
    const slideModel = slides[index];
    const page = index + 1;
    switch (slideModel.layout) {
      case "title":
        renderTitleSlide(deck, slideModel, theme);
        break;
      case "closing":
        renderClosingSlide(deck, slideModel, theme);
        break;
      case "section":
        renderSectionSlide(deck, slideModel, theme, page, total);
        break;
      case "columns":
        renderColumnsSlide(deck, slideModel, theme, page, total);
        break;
      case "cards":
        renderCardsSlide(deck, slideModel, theme, page, total);
        break;
      case "stat":
        renderStatSlide(deck, slideModel, theme, page, total);
        break;
      case "chart":
        renderChartSlide(deck, slideModel, theme, page, total);
        break;
      case "timeline":
        renderTimelineSlide(deck, slideModel, theme, page, total);
        break;
      case "image":
        renderImageSlide(deck, slideModel, theme, page, total, await assetPath(slideModel.imagePath));
        break;
      default:
        renderBulletsSlide(deck, slideModel, theme, page, total);
        break;
    }
    // Flush after each slide so the desktop Tools preview can open and grow one page at a time.
    await deck.writeFile({ fileName: target });
    if (typeof options.onSlideWritten === "function") {
      await options.onSlideWritten({ slideCount: index + 1, total, path: target });
    }
  }
  return { slideCount: total, deckTitle };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function htmlSlideInner(slideModel) {
  const title = escapeHtml(slideModel.title);
  const body = escapeHtml(slideModel.body);
  const subtitle = escapeHtml(slideModel.subtitle || "");
  if (slideModel.layout === "title") {
    return `<div class="slide title-slide"><div class="accent-rail"></div><div class="copy"><h1>${title}</h1>${subtitle || body ? `<p class="lede">${subtitle || body}</p>` : ""}<span class="brand">NewBrain</span></div></div>`;
  }
  if (slideModel.layout === "closing") {
    return `<div class="slide closing-slide"><h1>${title}</h1>${body ? `<p>${body}</p>` : ""}${slideModel.bullets.length ? `<p>${slideModel.bullets.map(escapeHtml).join(" · ")}</p>` : ""}<div class="closing-bar"></div></div>`;
  }
  if (slideModel.layout === "section") {
    return `<div class="slide section-slide"><div class="rule"></div><h1>${title}</h1>${body ? `<p>${body}</p>` : ""}</div>`;
  }
  if (slideModel.layout === "columns") {
    let columns = slideModel.columns;
    if (columns.length < 2) {
      const mid = Math.ceil(slideModel.bullets.length / 2) || 1;
      columns = [
        { title: "要点 A", bullets: slideModel.bullets.slice(0, mid) },
        { title: "要点 B", bullets: slideModel.bullets.slice(mid) }
      ];
    }
    return `<div class="slide columns-slide"><h1>${title}</h1><div class="columns">${columns.slice(0, 2).map((column) => `<article><h2>${escapeHtml(column.title || "")}</h2><ul>${(column.bullets || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></article>`).join("")}</div></div>`;
  }
  if (slideModel.layout === "cards") {
    let cards = slideModel.cards;
    if (cards.length < 2) {
      cards = slideModel.bullets.slice(0, 3).map((item, index) => {
        const [heading, ...rest] = item.split(/[：:]/);
        return { title: heading.trim() || `要点 ${index + 1}`, body: rest.join("：").trim() || item };
      });
    }
    return `<div class="slide cards-slide"><h1>${title}</h1><div class="cards">${cards.slice(0, 3).map((card, index) => `<article><em>${index + 1}</em><h2>${escapeHtml(card.title)}</h2><p>${escapeHtml(card.body)}</p></article>`).join("")}</div></div>`;
  }
  if (slideModel.layout === "stat") {
    const stat = escapeHtml(slideModel.bullets[0] || slideModel.body || "—");
    return `<div class="slide stat-slide"><p class="label">${title}</p><p class="stat">${stat}</p>${body && body !== stat ? `<p class="note">${body}</p>` : ""}</div>`;
  }
  if (slideModel.layout === "chart" && slideModel.chart?.series?.length) {
    const max = Math.max(...slideModel.chart.series.flatMap((entry) => entry.values), 1);
    const bars = slideModel.chart.categories.map((label, index) => {
      const value = slideModel.chart.series[0]?.values[index] ?? 0;
      const height = Math.max(8, Math.round((value / max) * 100));
      return `<div class="bar-item"><span>${escapeHtml(label)}</span><div class="bar-track"><div class="bar-fill" style="height:${height}%"></div></div><em>${escapeHtml(String(value))}</em></div>`;
    }).join("");
    return `<div class="slide chart-slide"><h1>${title}</h1>${body ? `<p class="lede">${body}</p>` : ""}<div class="bar-chart">${bars}</div></div>`;
  }
  if (slideModel.layout === "timeline" && slideModel.phases?.length) {
    return `<div class="slide timeline-slide"><h1>${title}</h1><div class="timeline">${slideModel.phases.map((phase) => `<article><span>${escapeHtml(phase.label)}</span><h2>${escapeHtml(phase.title)}</h2><p>${escapeHtml(phase.body)}</p></article>`).join("")}</div></div>`;
  }
  if (slideModel.layout === "image") {
    const src = escapeHtml(slideModel.imagePath ? `./${path.basename(slideModel.imagePath)}` : "");
    const caption = escapeHtml(slideModel.caption || slideModel.body || "");
    const placeholder = escapeHtml(slideModel.imagePlaceholder || "配图占位");
    return `<div class="slide image-slide"><h1>${title}</h1>${src ? `<img src="${src}" alt="${title}" />` : `<div class="image-placeholder">${placeholder}</div>`}${caption ? `<p class="caption">${caption}</p>` : ""}</div>`;
  }
  return `<div class="slide bullets-slide"><div class="title-row"><i></i><h1>${title}</h1></div>${body ? `<p class="lede">${body}</p>` : ""}<ul>${slideModel.bullets.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>`;
}

/**
 * Write a self-contained HTML slide deck (web-first preview / present mode).
 *
 * @param {{ title?: string; slides?: unknown[]; sections?: unknown[]; content?: string; subtitle?: string }} input
 * @param {string} target Absolute .html path
 * @param {(input: unknown) => Array<{ heading: string; body: string; bullets: string[] }>} sectionsFn
 */
export async function writeHtmlDeck(input, target, sectionsFn) {
  const { deckTitle, slides } = planPresentationDeck(input, sectionsFn);
  const pages = slides.map((slideModel, index) => (
    `<section class="page${index === 0 ? " active" : ""}" data-index="${index}" aria-label="第 ${index + 1} 页">${htmlSlideInner(slideModel)}<div class="pager">${index + 1} / ${slides.length}</div></section>`
  )).join("\n");

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(deckTitle)}</title>
<style>
  :root {
    --ink: #0f172a;
    --ink-soft: #1e293b;
    --accent: #0d9488;
    --accent-soft: #14b8a6;
    --surface: #f8fafc;
    --surface-alt: #f1f5f9;
    --card: #ffffff;
    --text: #0f172a;
    --muted: #475569;
    --line: #e2e8f0;
    --on-dark: #f8fafc;
    --on-dark-muted: #94a3b8;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; background: #020617; color: var(--text); font-family: "Microsoft YaHei", "PingFang SC", "Noto Sans SC", system-ui, sans-serif; }
  .stage { height: 100%; display: grid; place-items: center; padding: 24px; }
  .viewport {
    width: min(96vw, calc(96vh * 16 / 9));
    aspect-ratio: 16 / 9;
    position: relative;
    overflow: hidden;
    border-radius: 18px;
    box-shadow: 0 30px 80px rgba(0,0,0,.45);
    background: var(--surface);
  }
  .page { position: absolute; inset: 0; opacity: 0; pointer-events: none; transition: opacity .28s ease; }
  .page.active { opacity: 1; pointer-events: auto; }
  .slide { height: 100%; padding: 48px 56px; position: relative; }
  .pager { position: absolute; right: 28px; bottom: 18px; font-size: 12px; color: var(--muted); letter-spacing: .04em; }
  .title-slide, .closing-slide, .section-slide { background: var(--ink); color: var(--on-dark); }
  .title-slide .accent-rail { position: absolute; left: 0; top: 0; bottom: 0; width: 14px; background: var(--accent); }
  .title-slide .copy { max-width: 78%; margin-top: 18vh; }
  .title-slide h1, .closing-slide h1, .section-slide h1 { margin: 0; font-size: clamp(36px, 4.6vw, 56px); line-height: 1.15; }
  .title-slide .lede, .closing-slide p, .section-slide p { margin: 18px 0 0; color: var(--on-dark-muted); font-size: clamp(16px, 1.6vw, 22px); line-height: 1.6; }
  .title-slide .brand { display: inline-block; margin-top: 48px; color: var(--accent-soft); letter-spacing: .08em; font-size: 13px; }
  .closing-slide { display: grid; place-content: center; text-align: center; }
  .closing-bar { position: absolute; left: 0; right: 0; bottom: 0; height: 18px; background: var(--accent); }
  .section-slide { display: grid; align-content: center; background: var(--ink-soft); }
  .section-slide .rule { width: 56px; height: 6px; background: var(--accent); margin-bottom: 18px; }
  .bullets-slide, .columns-slide, .cards-slide, .stat-slide, .chart-slide, .timeline-slide, .image-slide { background: var(--surface); }
  .title-row { display: flex; gap: 14px; align-items: center; }
  .title-row i { width: 8px; height: 28px; background: var(--accent); border-radius: 999px; }
  .bullets-slide h1, .columns-slide h1, .cards-slide h1 { margin: 0; font-size: clamp(28px, 2.8vw, 36px); }
  .bullets-slide .lede { margin: 18px 0 0; color: var(--muted); font-size: 18px; line-height: 1.6; max-width: 52rem; }
  .bullets-slide ul { margin: 28px 0 0; padding: 0; list-style: none; display: grid; gap: 14px; }
  .bullets-slide li { position: relative; padding-left: 28px; font-size: clamp(17px, 1.5vw, 22px); line-height: 1.55; }
  .bullets-slide li::before { content: ""; position: absolute; left: 0; top: .55em; width: 10px; height: 10px; border-radius: 50%; background: var(--accent); }
  .columns { margin-top: 28px; display: grid; grid-template-columns: 1fr 1fr; gap: 22px; height: calc(100% - 90px); }
  .columns article, .cards article { background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 22px; }
  .columns h2, .cards h2 { margin: 0 0 12px; font-size: 20px; }
  .columns ul { margin: 0; padding-left: 1.1em; color: var(--muted); display: grid; gap: 8px; font-size: 16px; line-height: 1.5; }
  .cards { margin-top: 28px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; height: calc(100% - 90px); }
  .cards article { display: grid; align-content: start; gap: 12px; }
  .cards em { width: 28px; height: 28px; border-radius: 999px; display: grid; place-items: center; background: var(--accent); color: white; font-style: normal; font-size: 13px; font-weight: 700; }
  .cards p { margin: 0; color: var(--muted); line-height: 1.55; font-size: 15px; }
  .stat-slide { display: grid; place-content: center; text-align: center; gap: 12px; }
  .stat-slide .label { margin: 0; color: var(--muted); font-size: 18px; }
  .stat-slide .stat { margin: 0; color: var(--accent); font-size: clamp(64px, 8vw, 96px); font-weight: 700; line-height: 1; }
  .stat-slide .note { margin: 8px auto 0; max-width: 36rem; color: var(--text); font-size: 18px; line-height: 1.5; }
  .chart-slide, .timeline-slide, .image-slide { background: var(--surface); }
  .chart-slide h1, .timeline-slide h1, .image-slide h1 { margin: 0; font-size: clamp(26px, 2.6vw, 34px); }
  .bar-chart { margin-top: 28px; display: grid; grid-template-columns: repeat(auto-fit, minmax(72px, 1fr)); gap: 16px; align-items: end; height: calc(100% - 110px); }
  .bar-item { display: grid; gap: 8px; justify-items: center; align-content: end; height: 100%; font-size: 13px; color: var(--muted); }
  .bar-track { width: 100%; max-width: 72px; height: 220px; background: var(--surface-alt); border-radius: 12px 12px 4px 4px; display: flex; align-items: flex-end; overflow: hidden; border: 1px solid var(--line); }
  .bar-fill { width: 100%; background: linear-gradient(180deg, var(--accent-soft), var(--accent)); border-radius: 12px 12px 0 0; }
  .bar-item em { font-style: normal; color: var(--text); font-weight: 700; }
  .timeline { margin-top: 28px; display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 16px; height: calc(100% - 90px); }
  .timeline article { background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 18px; display: grid; gap: 10px; align-content: start; }
  .timeline span { width: 32px; height: 32px; border-radius: 999px; display: grid; place-items: center; background: var(--accent); color: white; font-size: 12px; font-weight: 700; }
  .timeline h2 { margin: 0; font-size: 18px; }
  .timeline p { margin: 0; color: var(--muted); line-height: 1.5; font-size: 14px; }
  .image-slide img { margin-top: 20px; width: 100%; max-height: calc(100% - 120px); object-fit: contain; border-radius: 12px; border: 1px solid var(--line); background: white; }
  .image-placeholder { margin-top: 20px; height: 320px; border-radius: 12px; border: 1px dashed var(--line); display: grid; place-items: center; color: var(--muted); background: var(--surface-alt); }
  .image-slide .caption { margin: 14px 0 0; text-align: center; color: var(--muted); font-size: 15px; }
  .hint { position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%); color: #64748b; font-size: 12px; }
</style>
</head>
<body>
  <div class="stage"><div class="viewport" id="deck">${pages}</div></div>
  <div class="hint">← → / 空格 翻页 · Home/End 首尾页</div>
  <script>
    const pages = [...document.querySelectorAll(".page")];
    let index = 0;
    function show(next) {
      index = Math.max(0, Math.min(pages.length - 1, next));
      pages.forEach((page, i) => page.classList.toggle("active", i === index));
    }
    window.addEventListener("keydown", (event) => {
      if (["ArrowRight", "PageDown", " ", "Enter"].includes(event.key)) { event.preventDefault(); show(index + 1); }
      if (["ArrowLeft", "PageUp", "Backspace"].includes(event.key)) { event.preventDefault(); show(index - 1); }
      if (event.key === "Home") show(0);
      if (event.key === "End") show(pages.length - 1);
    });
    document.querySelector(".viewport")?.addEventListener("click", (event) => {
      const rect = event.currentTarget.getBoundingClientRect();
      show(event.clientX < rect.left + rect.width / 2 ? index - 1 : index + 1);
    });
  </script>
</body>
</html>
`;
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, html, "utf8");
  return { slideCount: slides.length, deckTitle };
}
