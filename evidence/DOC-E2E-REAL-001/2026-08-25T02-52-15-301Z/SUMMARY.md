# DOC-E2E-REAL-001

- Result: **PARTIAL**
- Project: `基层治理数字化-E2E-1787626335302`
- Evidence: `evidence/DOC-E2E-REAL-001/2026-08-25T02-52-15-301Z/`
- Input path: CDP mouse + clipboard paste through visible composer
- Approvals clicked: 0（界面存在「替我审批」，未见逐步「批准并继续」）

## What passed
- Switched to 文档创作 and created blank project via visible UI
- Submitted document E2E prompt and revise prompt via composer
- Real exports under project `outputs/` with size > 0 and valid magic:
  - `基层治理数字化转型工作汇报.docx` (10051 B, OOXML OK, ~1414 chars of Chinese body)
  - `基层治理数字化转型工作汇报.pdf` (60445 B, PDF header/EOF OK)
  - `基层治理数字化转型工作汇报-PPT.pptx` (84430 B)
  - `基层治理数字化转型工作汇报-修订版.docx` / `-修订版v2.docx` / `-修订版v2.pdf`
- DOCX body contains 工作背景 / 推进举措 / 下一步… and cites 中办发〔2021〕26号
- Project name restored after renderer reload

## What failed / incomplete (keeps PARTIAL)
- Right panel **文件 0 / 产物 0**：`listBrainFiles` empty; 文稿/审校无法选中预览真实文档
- No independent UI proof that 审校 ChangeSet / 画笔标注 appeared on the right Tools surface
- Runner wait ended ~90s while agent was still busy; later revise exports continued after case closed
- Full process restart of Electron (not only reload) was not evidenced as MSI/process kill-restart

## Verdict rule applied
Real DOCX/PDF exist and open structurally, but right-side Tools did not show registered files/preview/review records → **PARTIAL** (not PASS).
