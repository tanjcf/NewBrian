import { ipcMain } from "electron";
import {
  desktopIpcChannels,
  type DesktopPolicyRule
} from "@codex-forge/protocol";

type MaybePromise<T> = T | Promise<T>;

interface PolicyIpcServices {
  getRules: () => MaybePromise<DesktopPolicyRule[]>;
  saveRules: (rules: DesktopPolicyRule[]) => MaybePromise<DesktopPolicyRule[]>;
  onRulesSaved: (rules: DesktopPolicyRule[]) => MaybePromise<void>;
}

/** Register the policy-management IPC surface without exposing runtime policy state. */
export function registerPolicyIpcHandlers(services: PolicyIpcServices) {
  ipcMain.handle(desktopIpcChannels.policy.getRules, () => services.getRules());
  ipcMain.handle(desktopIpcChannels.policy.saveRules, async (_event, rules: DesktopPolicyRule[]) => {
    const normalized = await services.saveRules(Array.isArray(rules) ? rules : []);
    await services.onRulesSaved(normalized);
    return normalized;
  });
}
