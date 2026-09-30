---
name: documents
description: Create, edit, inspect, and verify Word-compatible DOCX documents in the active NewBrain workspace.
---
# Documents

- Work only inside the active workspace unless the user explicitly approves another location.
- Prefer DOCX for editable deliverables and preserve supplied structure, tables, headings, and Chinese text.
- For Chinese body text, use Chinese curly double quotes “…” (U+201C/U+201D), not ASCII straight quotes "...". The office generator also normalizes ASCII quotes in Chinese prose when writing DOCX/PDF.
- Use available shell/runtime libraries to generate the file; never claim success from source code alone.
- After writing, verify the DOCX is a valid ZIP/OOXML file, reopen or extract its text, and report the real path and byte size.
- Keep generator scripts out of the final deliverable list unless the user asked for them.

## Charts and figures (bitmap pipeline)

- Do **not** rely on native Word OOXML charts as the primary path. Render charts with a dedicated engine first (ECharts for data charts, Mermaid for flow/architecture), export PNG/JPEG at `pixelRatio: 2` (or equivalent), then embed the bitmap into DOCX via ImageRun / html-docx image tags.
- Keep chart colors print-friendly (light background), label axes/units/time range, and put the chart title as a finding—not a generic “Chart 1”.
- After embedding, validate OOXML/ZIP, then prefer DOCX→PDF→page screenshot visual QA when the user asks for presentation-quality figures; fix layout issues and regenerate once rather than inventing “looks good”.
- Store intermediate chart bitmaps under workspace `media/` or `outputs/` and cite the final DOCX path + size in the reply.
