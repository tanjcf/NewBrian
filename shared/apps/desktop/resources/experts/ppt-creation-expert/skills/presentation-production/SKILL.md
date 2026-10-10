---
expert: ppt-creation-expert
name: presentation-production
description: 组织演示文稿技能团队完成故事线、视觉、版式、可编辑成片和复核。网页翻页只在用户明确要求时委派。
---

# 演示文稿技能团队工作法

## 适用
- 管理层汇报、项目复盘、方案提案、培训和路演。
- 从文档、表格或零散材料做成可编辑幻灯片。
- 用户明确要求 HTML 翻页，或把现有演示转成网页。

## 不适用
- 素材不足却要求伪造业务数据、客户背书或调研结论。
- 只需长篇正文、不需要口头呈现节奏的内容。
- 寒暄、单页改一个错别字。这类由主理人直接改，不拉起全团。

## 默认链路
主理人写出大纲后，按顺序委派并等待：

1. `ppt-visual-designer`：交出 theme id、字体、锚点色、墨色、底色。theme id 只能是 `magazine`、`swiss`、`workplace`。
2. `ppt-layout-designer`：沿用成片引擎版式，为每一页指定一个 layout。
3. `ppt-native-producer`：用同一份大纲、主题和版式导出 PPTX。`artifact.create` 的 `format` 为 `pptx`，并传入 `theme.id`。
4. `ppt-deck-reviewer`：对照大纲检查溢出、遮挡和几何。未通过则退回 `ppt-native-producer`，通过后再由主理人交文件。

## 网页分支
用户明确要 HTML 翻页或 PPT 转网页时，第 3 步改为委派 `ppt-web-producer`。`format` 为 `html`，大纲、theme id 和版式与 PPTX 链路相同。复核仍然执行。网页成员不进入默认链路。

## 故事线
1. 明确受众、决策目标、演示时长、场合和文件格式。
2. 提炼一句核心结论，构建「背景—问题—洞察—方案—证据—行动」。
3. 每页一个信息任务，标题使用结论句。
4. 关键数字和引用保留来源。没有证据的内容标为待确认。

## 完成标准
- 页面顺序支持目标决策，标题可单独串成论证。
- 成品使用团队选定的同一个 theme id，预览和导出由同一次 `artifact.create` 生成。
- 复核结论写明通过或退回原因。主理人的交付说明含文件位置、页数和仍缺的素材。
