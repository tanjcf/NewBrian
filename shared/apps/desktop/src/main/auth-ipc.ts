import { ipcMain } from "electron";
import {
  desktopIpcChannels,
  type DesktopAuthChangeEmailInput,
  type DesktopAuthChangePasswordInput,
  type DesktopAuthLoginInput,
  type DesktopAuthSendCodeInput,
  type DesktopAuthStatus
} from "@codex-forge/protocol";

type MaybePromise<T> = T | Promise<T>;

interface AuthIpcServices {
  getStatus: () => MaybePromise<DesktopAuthStatus>;
  getBillingSubscription: () => MaybePromise<unknown>;
  redeemCode: (input: { code: string }) => MaybePromise<unknown>;
  sendLoginCode: (input: DesktopAuthSendCodeInput) => MaybePromise<unknown>;
  login: (input: DesktopAuthLoginInput) => MaybePromise<DesktopAuthStatus>;
  changePassword: (input: DesktopAuthChangePasswordInput) => MaybePromise<unknown>;
  changeEmail: (input: DesktopAuthChangeEmailInput) => MaybePromise<unknown>;
  logout: () => MaybePromise<DesktopAuthStatus>;
}

/** Register the authentication IPC surface without exposing auth storage to Electron wiring. */
export function registerAuthIpcHandlers(services: AuthIpcServices) {
  ipcMain.handle(desktopIpcChannels.auth.getStatus, () => services.getStatus());
  ipcMain.handle(desktopIpcChannels.auth.getBillingSubscription, () => services.getBillingSubscription());
  ipcMain.handle(desktopIpcChannels.auth.redeemCode, (_event, input: { code: string }) => services.redeemCode(input));
  ipcMain.handle(desktopIpcChannels.auth.sendLoginCode, (_event, input: DesktopAuthSendCodeInput) => services.sendLoginCode(input));
  ipcMain.handle(desktopIpcChannels.auth.login, (_event, input: DesktopAuthLoginInput) => services.login(input));
  ipcMain.handle(desktopIpcChannels.auth.changePassword, (_event, input: DesktopAuthChangePasswordInput) => services.changePassword(input));
  ipcMain.handle(desktopIpcChannels.auth.changeEmail, (_event, input: DesktopAuthChangeEmailInput) => services.changeEmail(input));
  ipcMain.handle(desktopIpcChannels.auth.logout, () => services.logout());
}
