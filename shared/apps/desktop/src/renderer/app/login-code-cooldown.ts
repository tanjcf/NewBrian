/** Per-channel login verification-code resend cooldown (email vs phone). */

import type { LoginChannel } from "./login-form";

export type LoginCodeCooldownByChannel = {
  email: number;
  phone: number;
};

export const initialLoginCodeCooldownByChannel: LoginCodeCooldownByChannel = {
  email: 0,
  phone: 0
};

export function loginCodeCooldownForChannel(
  cooldowns: LoginCodeCooldownByChannel,
  channel: LoginChannel
): number {
  return channel === "phone" ? cooldowns.phone : cooldowns.email;
}

export function setChannelLoginCodeCooldown(
  cooldowns: LoginCodeCooldownByChannel,
  channel: LoginChannel,
  seconds: number
): LoginCodeCooldownByChannel {
  const next = Math.max(0, Math.floor(seconds));
  return channel === "phone"
    ? { ...cooldowns, phone: next }
    : { ...cooldowns, email: next };
}

export function tickLoginCodeCooldowns(
  cooldowns: LoginCodeCooldownByChannel
): LoginCodeCooldownByChannel {
  return {
    email: cooldowns.email > 0 ? cooldowns.email - 1 : 0,
    phone: cooldowns.phone > 0 ? cooldowns.phone - 1 : 0
  };
}

export function clearLoginCodeCooldowns(): LoginCodeCooldownByChannel {
  return { email: 0, phone: 0 };
}

export function hasActiveLoginCodeCooldown(cooldowns: LoginCodeCooldownByChannel): boolean {
  return cooldowns.email > 0 || cooldowns.phone > 0;
}
