# DATA-E2E-REAL-002

- result: **FAIL**
- project: 区域季度经营分析-E2E-1787622968401自动化
- marker: DATA-LOOP-003-1787623401431
- approvals: 0
- grade: `{}`
- firstFailure: Error: Timed out: document.body.innerText.includes("DATA-LOOP-003-1787623401431")
文件
编辑
查看
窗口
帮助
数据与决策
新对话
搜索
Holon
技能
插件
自动化
codeCN 移动版
MCP 集成
项目
+
区域季度经营分析-E2E-1787619452848
区域季度经营分析-E2E-1787619501588
区域季度经营分析-E2E-1787619922706
New project
区域季度经营分析-E2E-1787620449725
区域季度经营分析-E2E-1787622968401自动化
显示更少
聊天
+
暂无聊天
E2E
codeCN E2E
e2e
⚙
请只使用右侧「数据与决策」Tools 操作当前项目，完成「区域季度经营分
打开位置
请只使用右侧「数据与决策」Tools 操作当前项目，完成「区域季度经营分析」真实闭环（不得只回复方案或代码）：
1. 必须先调用 data.file.import_local（absolutePath=下方 CSV，autoImportDataset=true）把真实 CSV 登记并导入数据集；禁止使用 sales_q3 原型。
2. 调用 data.project.inspect / data.dataset.list 确认右侧数据集字段与行数；再用 data.dataset.read_rows 核对采样。
3. 调用 data.analysis.summarize 与 data.analysis.a
    at Object.waitFor (file:///I:/G%E7%9B%98%E8%BF%81%E7%A7%BB%E5%A4%87%E4%BB%BD/workrpase/BRAIN/platforms/windows/apps/desktop/scripts/scene-test-cdp-client.mjs:148:11)
    at async file:///I:/G%E7%9B%98%E8%BF%81%E7%A7%BB%E5%A4%87%E4%BB%BD/workrpase/BRAIN/tmp-data-e2e-loop3.mjs:221:3
