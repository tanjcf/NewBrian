---
expert: ppt-creation-expert
name: ppt-web-production
description: 在用户明确要求时，用同一份大纲、主题和版式生成 16:9 的 HTML 翻页。
---

# 网页翻页

## 适用
- 用户明确要求 HTML 翻页。
- 用户要求把现有演示转成网页。

## 不适用
- 默认的可编辑 PPTX 交付。
- 主题或逐页 layout 还没确定。

## 步骤
1. 调用 `artifact.create`，`format` 为 `html`，`targetPath` 位于 `outputs/`。
2. `theme.id` 使用 `magazine`、`swiss` 或 `workplace`，layout 使用版式成员的逐页结果。
3. 用 `artifact.inspect` 确认文件页数与大纲一致。

## 完成标准
- 产出是单份 HTML 翻页，主题和版式与 PPTX 链路相同。
- 回报里写明这不是可编辑 PPTX。
