/** Resolve optional ops override for market-data. Prefer Spring `/api/desktop/v1/market-bars`. */
export function resolveBrainMarketDataUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const configured = env.BRAIN_MARKET_DATA_URL?.trim();
  return configured || undefined;
}
