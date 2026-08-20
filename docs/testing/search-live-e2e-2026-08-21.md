# Live web-search E2E probe — 2026-08-21

## Verdict

**BLOCKED_UNREACHABLE** — live BRAIN → Spring → AKShare → Bocha path was not executed on this host.

## Probe environment

- Host: Windows 10 (build 22631)
- Date: 2026-08-21 (UTC+8)
- Config defaults from spring-app `application.properties`:
  - `app.akshare.base-url` → `http://10.66.0.2:5001`
  - `app.web-search.base-url` → `http://10.66.0.3:8080`
  - `app.web-search.token` / `SEARCH_GATEWAY_TOKEN`: **unset** (empty)

## Connectivity

| Target | Result |
|--------|--------|
| AKShare `10.66.0.2:5001` (`/api/sector/news`, `/health`, `/`) | HTTP timeout (~3s); no usable body |
| Search gateway `10.66.0.3:8080` (`/api/search`, `/`) | HTTP timeout (~3s) |
| WireGuard / `10.66.*` local address | **none**; traffic appears on Meta TUN (`198.18.0.0/15` style), not a real WireGuard path |
| Local Spring (`:8790`) | **not listening**; no desktop session token available without inventing credentials |

## What remains proven without live nodes

- Unit / mock: `WebSearchOrchestratorTest`, `WebSearchServiceTest`, `CitationValidationServiceTest`, desktop `desktop-web-search.test.ts`
- OpenClaw media Auto-tools path uses a **local mock** gateway only (`test-openclaw-media-gateway-e2e.mjs`)

## Unblock checklist

1. Bring up WireGuard (or equivalent) so `10.66.0.2` / `10.66.0.3` answer HTTP.
2. Set `SEARCH_GATEWAY_TOKEN` on the Spring host only (never ship in git).
3. Run Spring with JDK 21; obtain a real desktop session token.
4. Execute matrix: free-sufficient, free-then-one-paid, AKShare down, Bocha 403/empty, admin disable, budget exhausted; sample `web_search_audit` rows.
5. Confirm BRAIN final answer includes source URLs + `searchedAt` (or explicit `WEB_SEARCH_UNAVAILABLE`).

Until then, Task 8 live gateway E2E must stay **BLOCKED**, not PASS.
