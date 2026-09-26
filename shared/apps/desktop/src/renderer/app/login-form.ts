/** Shared login form types and pure helpers (cross-platform). */

export type LoginChannel = "email" | "phone";
export type LoginEmailAuthMode = "password" | "code";

export interface LoginFormState {
  channel: LoginChannel;
  email: string;
  phone: string;
  password: string;
  captcha: string;
  agreementAccepted: boolean;
}

export const initialLoginForm: LoginFormState = {
  channel: "email",
  email: "",
  phone: "",
  password: "",
  captcha: "",
  agreementAccepted: false
};

/** Minimal auth status fields the login UI needs. */
export type LoginAuthStatusView = {
  base_url?: string;
  last_error?: string | null;
  agreement?: {
    enabled?: boolean;
    tos_title?: string;
    tos_content_html?: string;
    policy_title?: string;
    policy_content_html?: string;
  } | null;
  email_code_login_enabled?: boolean;
  password_login_enabled?: boolean;
  /** ISO server clock from spring-app `/api/desktop/auth/config`. */
  server_time?: string | null;
  /** Optional `yyyy-MM-dd` (Asia/Shanghai) from spring-app. */
  server_date?: string | null;
  /**
   * When false, hide the National Day login ceremony.
   * Production packaged builds set this from spring-app Sep 29–Oct 15 (Asia/Shanghai);
   * local unpackaged stays true.
   */
  login_ceremony_enabled?: boolean;
};

export function isCnMobile(value: string): boolean {
  return /^1\d{10}$/.test(value.trim());
}

export function normalizeCnMobileInput(value: string): string {
  return value.replace(/\D/g, "").slice(0, 11);
}

export function resolveLoginIdentifier(form: LoginFormState): string {
  return form.channel === "phone" ? form.phone.trim() : form.email.trim();
}

/**
 * Decide whether email login submits captcha instead of password.
 * `email_code_login_enabled` only means code login is available — never pass it as a force flag.
 * Force code only when the server disables password login.
 */
export function shouldUseLoginCode(
  form: LoginFormState,
  emailAuthMode: LoginEmailAuthMode,
  options?: { passwordLoginEnabled?: boolean }
): boolean {
  if (form.channel === "phone") return true;
  if (options?.passwordLoginEnabled === false) return true;
  if (emailAuthMode === "code") return true;
  if (emailAuthMode === "password") return false;
  const password = form.password.trim();
  const captcha = form.captcha.trim();
  return Boolean(captcha) && !password;
}

export function canSubmitLoginForm(
  form: LoginFormState,
  options: {
    emailAuthMode: LoginEmailAuthMode;
    isSubmitting: boolean;
    agreementEnabled: boolean;
  }
): boolean {
  const { emailAuthMode, isSubmitting, agreementEnabled } = options;
  if (isSubmitting) return false;
  if (agreementEnabled && !form.agreementAccepted) return false;
  if (form.channel === "phone") {
    return isCnMobile(form.phone) && Boolean(form.captcha.trim());
  }
  if (!form.email.trim()) return false;
  if (emailAuthMode === "code") return Boolean(form.captcha.trim());
  return Boolean(form.password.trim());
}

export function authServiceStatusLabel(authStatus: LoginAuthStatusView): string {
  if (authStatus.last_error) return "认证服务连接异常";
  if (authStatus.base_url) return "认证服务已连接";
  return "认证服务未配置";
}
