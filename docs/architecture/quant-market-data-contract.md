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
      "timestamp": "2026-08-19T00:00:00+08:00",
      "open": 1738.0,
      "high": 1752.0,
      "low": 1728.0,
      "close": 1746.0,
      "volume": 2300000,
      "turnover": 4015800000,
      "changePercent": 0.46
    }
  ]
}
```

The gateway owns AKShare credentials and provider-specific field mapping. BRAIN never receives those credentials. HTTP errors and malformed responses are surfaced as a market-data failure; the UI may show local demo data but must label it as such.
