---
expert: ppt-creation-expert
name: ppt-deck-review
description: 对照大纲检查演示的溢出、遮挡、几何和页序，给出通过或退回。
---

# 成片复核

## 适用
- PPTX 或 HTML 已经生成，需要按大纲验收。

## 不适用
- 文件还没生成。
- 要改故事线或更换 theme id。

## 步骤
1. 对照大纲核对页数、标题和 layout。
2. 用 `artifact.inspect` 检查成片。查看预览时记录溢出、遮挡和图表单位。
3. 确认主题仍是原来的 `magazine`、`swiss` 或 `workplace`，预览和导出同源。
4. 第一句写「通过」或「退回」。退回只列页码和原因。

## 完成标准
- 每一条退回都能对应到某一页和大纲中的信息任务。
- 未打开的页面不标为已检查。
