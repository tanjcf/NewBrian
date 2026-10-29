---
expert: ppt-creation-expert
name: ppt-visual
description: 为演示文稿选定 magazine、swiss 或 workplace 之一，并交出字体、锚点色、墨色和底色。
---

# 视觉规范

## 适用
- 一份演示需要统一的字体、锚点色和底色。

## 不适用
- 为每一页重画版式。
- 导出 PPTX 或 HTML。

## 步骤
1. 根据场合在 `magazine`、`swiss`、`workplace` 中选一个 `theme.id`。
2. 使用成片引擎里该 id 的默认字体和颜色。用户给出的品牌色只替换 `accent`。
3. 回报 `theme.id`、`fontTitle`、`accent`、`ink`、`surface` 和一句选择理由。

## 完成标准
- 全稿只有一个 `theme.id`。
- 颜色是十六进制，能直接写入 `artifact.create` 的 `theme`。
