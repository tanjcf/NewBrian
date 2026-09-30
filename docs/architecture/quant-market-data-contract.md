# Quant Market Data Contract

Desktop never calls AKShare (or `127.0.0.1:5001`) directly. The path is:

```text
Desktop (session auth) → spring-app POST /api/desktop/v1/market-bars → app.akshare.base-url /bars
```

AKShare base URL and credentials stay on the server (`app.akshare.base-url`). `BRAIN_MARKET_DATA_URL` is an optional ops override for lab mocks only; production desktop must use Spring.

Local lab prerequisites (Windows):

1. `spring-app` on `http://127.0.0.1:8790` (`java -jar target/token-system-1.0.0.jar`)
2. AKShare adapter on `http://127.0.0.1:5001` — run `pwsh scripts/start-local-akshare.ps1` from the BRAIN repo (or `uvicorn` under `stock-quant-platform/adapters/akshare`)
3. Desktop `NEWBRAIN_MODEL_BASE_URL=http://127.0.0.1:8790/v1` and **do not** set `BRAIN_MARKET_DATA_URL` (that bypasses Spring)

If Spring returns HTTP 502 on market-bars, AKShare is usually down or misconfigured — not a desktop chart bug.

The desktop main process (via Spring) sends:

```json
{
  "symbol": "600519",
  "interval": "1d",
  "startDate": "2026-01-01",
  "endDate": "2026-08-19",
  "adjustment": "forward"
}
```

Spring returns:

```json
{
  "ok": true,
  "data": {
    "bars": [
      {
        "symbol": "600519",
        "exchange": "SSE",
        "timezone": "Asia/Shanghai",
        "interval": "1d",
        "adjustment": "forward",
        "timestamp": "2026-08-19T00:00:00+08:00",
        "open": 1738.0,
        "high": 1752.0,
        "low": 1728.0,
        "close": 1746.0,
        "volume": 2300000,
        "turnover": 4015800000,
        "changePercent": 0.46,
        "source": {
          "provider": "akshare-adapter",
          "dataset": "stock_zh_a_hist",
          "fetchedAt": "2026-08-19T08:10:00Z"
        }
      }
    ]
  }
}
```

The gateway owns AKShare credentials and provider-specific field mapping. BRAIN never receives those credentials. HTTP errors and malformed responses are surfaced as a market-data failure. **Do not substitute synthetic OHLC.** The Quant UI must stay empty or show an explicit gateway error until real bars arrive.

Upstream order for the AKShare adapter (`stock-quant-platform/adapters/akshare`):

1. Eastmoney via `ak.stock_zh_a_hist`
2. On transport/provider failure, **real** Sina daily via `ak.stock_zh_a_daily` (weekly/monthly resampled from genuine daily bars)
3. Never invent OHLC locally inside BRAIN desktop

## Exchange calendar

`BRAIN_MARKET_CALENDAR_URL` points to an internal exchange-calendar endpoint. BRAIN sends:

```json
{ "exchange": "SSE", "date": "2026-10-01" }
```

The endpoint must return:

```json
{
  "exchange": "SSE",
  "date": "2026-10-01",
  "isTradingDay": false,
  "source": "exchange-calendar",
  "fetchedAt": "2026-09-30T16:00:00Z"
}
```

Responses are cached for six hours. Exchange/date mismatches, malformed payloads, timeouts, and HTTP failures fail closed: no strategy task is generated. `BRAIN_MARKET_HOLIDAYS` may contain a comma-separated administrator override such as `2026-10-01,2026-10-02`; weekends and these overrides are rejected before any network request. Without a configured endpoint, the desktop reports a `weekday-fallback` decision, which is not sufficient evidence to mark the production market-calendar gate complete.
