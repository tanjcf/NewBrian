# 子 Agent 模板与测试审计日志（Hegel）

- Agent：`019f6bf2-da1d-7032-ae28-6c3a79af9a2f`
- 模式：只读 explorer
- 范围：两个发布模板包、全部 JSON/SVG/PNG/media、smoke/MECE
- 写入：无

## 已确认缺陷

1. `Test-023ffae3/fidelity_template/template_registry.json.source_files` 含旧项目绝对路径。
2. `canvas_previews/png_manifest.json` 的 png_dir/files/contact_sheet 均含旧项目绝对路径。
3. `components.svg` 位于 `fidelity_template/`，却沿用 canvas目录的 `../../template_media`；层级错误。layout canvas 中该路径正确，因为 canvas多一层目录。
4. 当前 Test profile识别出 data/compare/funnel/process，但发布 registry只剩五个核心 layout；`product_hero_image`批准后没有任何 layout引用。
5. 明确 rejected 的 `logo_01..04` 仍被整个 template_media目录复制进发布包与 manifest。
6. 发布器只清洗 profile source files，不清洗 registry/preview manifest。
7. 应用流程逐文件比较 manifest hashes，但不验证 `package_sha256`。
8. 默认模板的 `content_base/contents_light/two_column_light/data_light` locked hash相同，暗色三页也相同；所谓专用 layout 是同一空 canvas别名。
9. 默认模板没有 preview；Parent本地模板列表也不返回 preview。
10. 所有当前 canvas均只有一个空 replace layer与两个 lock layer；这一点正确。
11. 当前 Test cover/closing预览相同、contents/chapter预览相同，与 locked canvas一致，不是 stale，但派生图有冗余。
12. MECE扫描范围未覆盖模板库JSON/SVG、review generator/server与全部测试。

## 历史证据补充与处置修正

该 Agent最初建议删除 Test正式包。主线程随后查看源模板与旧项目，找到：

- 10-layout registry；
- 27 个 approved components；
- `content_data/content_compare/content_funnel/content_process` 等专用 canvas；
- 全部 layout `canvas_png_reviewed:true`、`usable:true`、`visual_similarity:pass`、`must_fix:[]`；
- 所有 replace layer为空。

因此最终处置不是删除模板，而是从旧证据重建干净包、恢复可选专用模型、重做预览/manifest并生成新的人工审阅入口。用户批准前不晋级正式 Skill。

## 采纳的验收项

- 发布包 JSON/SVG 不含绝对项目路径。
- 所有 SVG href 解析到真实文件。
- 只发布 registry/components/canvas 可达媒体；rejected媒体不进入包。
- 验证每文件 hash 与 `package_sha256`。
- `content_base` 存在、required非空、每 canvas只有一个空 replace layer。
- 篡改 lock layer或删除 required component必须失败。
- approved/optional component均需可达且被 layout引用。
- 专用模型必须有真实结构差异，不能只是 alias。
- 默认模板必须有 preview 与真实应用forward。
- 模板审阅页面只存在一个提交函数，并用真实 Server交互测试。
- 模板批准绑定源PNG、canvas PNG/SVG、registry和HTML。

## 未采纳项

- Agent建议继续验证四维反馈；与用户明确的新 UX 冲突，拒绝。
- Agent建议把 Test模板永久转成测试 fixture；已有完整历史视觉证据，因此改为重建 + 新人工复核。
