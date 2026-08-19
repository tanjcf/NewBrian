# Quant Market Data Contract

`BRAIN_MARKET_DATA_URL` points to the internal market-data gateway, not directly to a provider credential.

The desktop main process sends a `POST` request with:

```json
{
  "symbol": "600519",
  "interval": "1d",
  "startDate": "2026-01-01",
  "endDate": "2026-08-19",
  "adjustment": "forward"
}
```

The gateway returns:

```json
{
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
```

The gateway owns AKShare credentials and provider-specific field mapping. BRAIN never receives those credentials. HTTP errors and malformed responses are surfaced as a market-data failure; the UI may show local demo data but must label it as such.

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
