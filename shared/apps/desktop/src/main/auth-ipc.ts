import { ipcMain } from "electron";
import {
  desktopIpcChannels,
  type DesktopAuthChangeEmailInput,
  type DesktopAuthChangePasswordInput,
  type DesktopAuthLoginInput,
  type DesktopAuthAlipayQrLoginInput,
  type DesktopAuthSendCodeInput,
  type DesktopAuthStatus
} from "@codex-forge/protocol";

type MaybePromise<T> = T | Promise<T>;

interface AuthIpcServices {
  getStatus: () => MaybePromise<DesktopAuthStatus>;
  getBillingSubscription: () => MaybePromise<unknown>;
  getSubscriptionCatalog: () => MaybePromise<unknown>;
  rechargeWallet: (input: { amount: number; payment_method?: string }) => MaybePromise<unknown>;
  purchasePlan: (input: { plan_id: number; payment_method?: string }) => MaybePromise<unknown>;
  openWalletPayment: (input: {
    intent?: string;
    amount?: number;
    plan_id?: number;
    payment_method?: string;
  }) => MaybePromise<unknown>;
  setWalletOverageEnabled: (input: { enabled: boolean }) => MaybePromise<unknown>;
  redeemCode: (input: { code: string }) => MaybePromise<unknown>;
  claimNationalDayGift: () => MaybePromise<unknown>;
  sendLoginCode: (input: DesktopAuthSendCodeInput) => MaybePromise<unknown>;
  login: (input: DesktopAuthLoginInput) => MaybePromise<DesktopAuthStatus>;
  loginWithAlipayQr: (input: DesktopAuthAlipayQrLoginInput) => MaybePromise<DesktopAuthStatus>;
  changePassword: (input: DesktopAuthChangePasswordInput) => MaybePromise<unknown>;
  changeEmail: (input: DesktopAuthChangeEmailInput) => MaybePromise<unknown>;
  logout: () => MaybePromise<DesktopAuthStatus>;
}

/** Register the authentication IPC surface without exposing auth storage to Electron wiring. */
export function registerAuthIpcHandlers(services: AuthIpcServices) {
  ipcMain.handle(desktopIpcChannels.auth.getStatus, () => services.getStatus());
  ipcMain.handle(desktopIpcChannels.auth.getBillingSubscription, () => services.getBillingSubscription());
  ipcMain.handle(desktopIpcChannels.auth.getSubscriptionCatalog, () => services.getSubscriptionCatalog());
  ipcMain.handle(desktopIpcChannels.auth.rechargeWallet, (_event, input: { amount: number; payment_method?: string }) =>
    services.rechargeWallet(input));
  ipcMain.handle(desktopIpcChannels.auth.purchasePlan, (_event, input: { plan_id: number; payment_method?: string }) =>
    services.purchasePlan(input));
  ipcMain.handle(
    desktopIpcChannels.auth.openWalletPayment,
    (
      _event,
      input: {
        intent?: string;
        amount?: number;
        plan_id?: number;
        payment_method?: string;
      }
    ) => services.openWalletPayment(input)
  );
  ipcMain.handle(desktopIpcChannels.auth.setWalletOverageEnabled, (_event, input: { enabled: boolean }) =>
    services.setWalletOverageEnabled(input));
  ipcMain.handle(desktopIpcChannels.auth.redeemCode, (_event, input: { code: string }) => services.redeemCode(input));
  ipcMain.handle(desktopIpcChannels.auth.claimNationalDayGift, () => services.claimNationalDayGift());
  ipcMain.handle(desktopIpcChannels.auth.sendLoginCode, (_event, input: DesktopAuthSendCodeInput) => services.sendLoginCode(input));
  ipcMain.handle(desktopIpcChannels.auth.login, (_event, input: DesktopAuthLoginInput) => services.login(input));
  ipcMain.handle(desktopIpcChannels.auth.loginWithAlipayQr, (_event, input: DesktopAuthAlipayQrLoginInput) => {
    if (!input || typeof input.agreement_accepted !== "boolean") {
      throw new Error("支付宝扫码登录参数无效。");
    }
    return services.loginWithAlipayQr(input);
  });
  ipcMain.handle(desktopIpcChannels.auth.changePassword, (_event, input: DesktopAuthChangePasswordInput) => services.changePassword(input));
  ipcMain.handle(desktopIpcChannels.auth.changeEmail, (_event, input: DesktopAuthChangeEmailInput) => services.changeEmail(input));
  ipcMain.handle(desktopIpcChannels.auth.logout, () => services.logout());
}
