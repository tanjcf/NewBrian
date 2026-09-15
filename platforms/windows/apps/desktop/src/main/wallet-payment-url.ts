export function buildWalletPaymentUrl(webBaseUrl: string) {
  return new URL("/app/online-payment?mode=wallet", webBaseUrl).toString();
}
