---
expert: deep-research
name: deep-research
description: Search→Fetch 研究编排：查询分型、research_plan、Lead 综合与引用纪律。
---

# Deep Research

## 适用
- 需要联网证据的调研、竞品对比、政策/公告核实、深度分析。

## 不适用
- 寒暄、感谢、能力询问、纯代码实现、已有充分本地材料的改写。

## 步骤
1. 用查询分型决定配方：`straight`（直达）、`depth`（加深）、`breadth`（多角度，最多 3 子 Agent）。
2. Lead 只规划与综合：`agent.delegate` → `agent.wait`；不要由父会话亲自长跑搜索。
3. Researcher 强制 Search→Fetch：
   - 优先 `news_search_free`（编排可能已带 TopK fetches）
   - 不足时再 `web.search_paid`
   - 对关键 URL 调用 `web.fetch_page`（或使用编排返回的 fetches）
4. 事实主张必须绑定 URL + `searchedAt`；snippet 不能当全文证据。
5. 冲突与缺口标【待核验】；最终由 Lead 统一中文答复并附 References。

## 完成标准
- 关键时效/事实句均可追溯到来源 URL。
- 未突破 depth=1、最多 3 子 Agent 上限。
- 寒暄路径未触发搜索工具。
