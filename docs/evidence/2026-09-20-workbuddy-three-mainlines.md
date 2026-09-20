# WorkBuddy 三主线落地说明（2026-09-20）

## 范围

1. Search→Fetch 闭环（spring-app + BRAIN）
2. Research 编排 SOP（分型 + research_plan + Auto 约束）
3. Word 图表位图管道规范（documents / 长文档 / 数据分析 skill）

不含：百度管理员价目、套餐/钱包搜索扣费、TeamCreate、搜狗公众号。

## spring-app

- `POST /api/desktop/v1/web-fetch`：`DesktopWebPageFetchController` + `WebPageFetchService`
- `WebSearchOrchestrator`：FREE_THEN_PAID 后 TopK=3 抓取（`app.web-search.fetch.*`）
- `AuthoritativeChineseSourceService`：权威中文 host 加分
- `SearchEvidencePack`：兼容工厂 `withoutFetches` / `withFetches`

## BRAIN shared

- `DesktopWebSearchClient.fetchPage` + `searchMarketNews` 解析 `fetches`
- `registerDesktopWebSearchTools`：`news_search_free` / `web.search_paid` / `web.fetch_page`（带简单熔断）
- `research-plan-policy.ts`：straight/depth/breadth + Lead 指令
- `auto-orchestrator-policy.ts`：research 回合写入 Research 约束
- Skill：`deep-research`、documents/long-document/analytics 位图规范

## 平台接线

- Windows：`index.ts` 注册 web-search 工具（model-chat + 长寿 runtime）
- macOS / Ubuntu：`model-chat-runtime-setup.ts` + `desktopWebSearchClient` 注入

## 验证

- spring-app：`mvnw -Dtest=WebPageFetchServiceTest,CitationValidationServiceTest,WebSearchOrchestratorTest,AutoModelCapabilityDiscoveryServiceTest test`
- BRAIN shared：`node --test` 覆盖 `desktop-web-search*.test.ts`、`research-plan-policy.test.ts`、`auto-orchestrator-policy.test.ts`
