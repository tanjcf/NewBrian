# DOC-E2E-REAL-001

- Result: **PARTIAL**
- Project: 基层治理数字化-E2E-1787629113939
- Approvals: 0
- Files after chat: 1 listed / tab 1
- Files after revise: 1 listed / tab 0
- Export probes: 0
- Brush anomaly: YES
- First failure: real export exists and magic-ok in this project

## Anomalies
- **画笔标记异常**: 审校面可见「开始画笔标记」「画笔标注」，但始终为「0 条标注 / 当前文档还没有标注或修改方案」。入口可点但未形成可验收标注闭环，判定为异常，不作为审校 PASS。

## Exports

## Assertions
- PASS: scene is document
- PASS: project name typed
- PASS: new project visible
- PASS: main-prompt composer has text
- PASS: submitted prompt visible in chat
- PASS: revise-prompt composer has text
- PASS: AI used document tools or approvals
- PASS: project has office files registered
- PASS: right panel file count visible
- PASS: right panel file selectable/previewable
- PASS: right panel tabs inspected
- PASS: revise turn completed signals
- FAIL: real export exists and magic-ok in this project
- PASS: project restored after reload
- PASS: files restored after reload
- FAIL: brush annotation not abnormal
