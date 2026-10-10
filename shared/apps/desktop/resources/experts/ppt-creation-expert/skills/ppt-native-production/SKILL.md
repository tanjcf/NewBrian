---
expert: ppt-creation-expert
name: ppt-native-production
description: 用成片引擎把已确认的大纲、主题和版式导出为与预览同源的可编辑 PPTX。
---

# 可编辑 PPTX

## 适用
- 大纲、theme id 和每一页 layout 已经确定。
- 交付格式是 PowerPoint。

## 不适用
- 用户要求的是 HTML 翻页。
- 故事线或主题还没确定。

## 步骤
1. 调用 `artifact.create`，`format` 为 `pptx`，`targetPath` 位于 `outputs/`。
2. `theme.id` 只能是 `magazine`、`swiss`、`workplace`，并带上视觉成员的 `name`、`accent`、`ink`、`surface`。
3. 每一页写入版式成员指定的 `layout`。`chart` 使用 categories 和 values，阶段使用 phases，画面使用 `imagePath` 或 `imagePlaceholder`。
4. 用 `artifact.inspect` 确认文件存在且页数与大纲一致。

## 完成标准
- 产出是可编辑 PPTX，不是整页图片。
- 预览由同一次生成写出，主题和版式与大纲一致。
