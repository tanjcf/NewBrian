import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { inferSlideLayout, planPresentationDeck, writePptxDeck } from "./presentation-deck.js";

test("infers title closing cards and bullets layouts", () => {
  assert.equal(inferSlideLayout({ title: "市场分析", bullets: [] }, { index: 0, total: 3, deckTitle: "市场分析" }), "title");
  assert.equal(inferSlideLayout({ title: "谢谢", bullets: [] }, { index: 5, total: 6, deckTitle: "市场分析" }), "closing");
  assert.equal(inferSlideLayout({
    title: "要点",
    bullets: ["渗透率：提升", "价格：下沉", "供应链：本地化"]
  }, { index: 2, total: 6, deckTitle: "市场分析" }), "cards");
  assert.equal(inferSlideLayout({
    title: "进展",
    bullets: ["A", "B", "C"]
  }, { index: 1, total: 4, deckTitle: "市场分析" }), "bullets");
});

test("infers chart timeline process and image layouts", () => {
  assert.equal(inferSlideLayout({
    title: "规模",
    chart: { type: "bar", categories: ["2022", "2023"], values: [10, 20] }
  }, { index: 1, total: 4, deckTitle: "报告" }), "chart");
  assert.equal(inferSlideLayout({
    title: "路径",
    phases: [{ label: "P1", title: "调研", body: "摸底" }, { label: "P2", title: "试点", body: "验证" }]
  }, { index: 1, total: 4, deckTitle: "报告" }), "timeline");
  assert.equal(inferSlideLayout({ title: "阶段", layout: "process" }, { index: 1, total: 4, deckTitle: "报告" }), "timeline");
  assert.equal(inferSlideLayout({
    title: "场景",
    imagePlaceholder: "产品示意图"
  }, { index: 1, total: 4, deckTitle: "报告" }), "image");
});

test("planPresentationDeck prepends a title slide when missing", () => {
  const planned = planPresentationDeck({
    title: "新能源汽车",
    slides: [{ title: "规模", bullets: ["销量增长", "渗透率提升"] }]
  }, () => []);
  assert.equal(planned.slides[0].layout, "title");
  assert.equal(planned.slides[0].title, "新能源汽车");
  assert.equal(planned.slides[1].layout, "bullets");
});

test("writePptxDeck embeds chart and timeline slides", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "brain-ppt-visual-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const target = path.join(root, "outputs", "visual-deck.pptx");
  const result = await writePptxDeck({
    title: "可视化汇报",
    slides: [
      {
        title: "销量趋势",
        layout: "chart",
        chart: { type: "bar", categories: ["2022", "2023", "2024"], values: [120, 180, 240], seriesName: "销量" }
      },
      {
        title: "实施阶段",
        layout: "timeline",
        phases: [
          { label: "P1", title: "调研", body: "现状梳理" },
          { label: "P2", title: "试点", body: "场景验证" },
          { label: "P3", title: "推广", body: "全面复制" }
        ]
      },
      {
        title: "场景展示",
        layout: "image",
        imagePlaceholder: "智慧园区巡检示意图"
      }
    ]
  }, target, () => [], { workspaceRoot: root });
  assert.equal(result.slideCount, 4);
  const stat = await fs.stat(target);
  assert.ok(stat.size > 5000);
});
