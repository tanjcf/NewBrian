import type { Dispatch, SetStateAction } from "react";
import type { DesktopAuthStatusState, LoginFormState } from "./desktop-model";

interface LoginScreenProps {
  agreementDialog: null | "tos" | "policy";
  authStatus: DesktopAuthStatusState;
  errorMessage: string;
  isSendingLoginCode: boolean;
  isSubmittingLogin: boolean;
  loginCodeCooldownSeconds: number;
  loginForm: LoginFormState;
  onLoginSubmit: (agreementChecked?: boolean) => void;
  onSendLoginCode: () => void;
  setAgreementDialog: Dispatch<SetStateAction<null | "tos" | "policy">>;
  setLoginForm: Dispatch<SetStateAction<LoginFormState>>;
}

export function LoginScreen({
  agreementDialog,
  authStatus,
  errorMessage,
  isSendingLoginCode,
  isSubmittingLogin,
  loginCodeCooldownSeconds,
  loginForm,
  onLoginSubmit,
  onSendLoginCode,
  setAgreementDialog,
  setLoginForm
}: LoginScreenProps) {
  const agreementEnabled = Boolean(authStatus.agreement?.enabled);
  const agreementTitle =
    agreementDialog === "policy"
      ? authStatus.agreement?.policy_title || "使用政策"
      : authStatus.agreement?.tos_title || "服务协议";
  const agreementHtml =
    agreementDialog === "policy"
      ? authStatus.agreement?.policy_content_html || "<p>暂无内容</p>"
      : authStatus.agreement?.tos_content_html || "<p>暂无内容</p>";
  const authServiceStatusLabel = authStatus.last_error
    ? "认证服务连接异常"
    : authStatus.base_url
      ? "认证服务已连接"
      : "认证服务未配置";

  return (
    <main className="codex-shell login-shell">
      <section className="login-stage">
        <div className="login-panel">
          <button
            className="login-panel-close"
            type="button"
            aria-label="关闭"
            title="关闭"
            onClick={() => void window.codecn?.controlWindow("close")}
          >
            ×
          </button>
          <div className="login-panel-brand">
            <div className="login-panel-mark">C</div>
            <div>
              <strong>codeCN</strong>
              <span>Mac 桌面端</span>
            </div>
          </div>

          <div className="login-panel-copy">
            <h1>登录 OmniRoute 账号</h1>
            <p>启动时会先检查会话状态。登录成功后，桌面端将自动复用当前账号下可用的网关密钥。</p>
          </div>

          <div className="login-panel-form">
            <label className="settings-field">
              <span>邮箱</span>
              <input
                autoComplete="username"
                value={loginForm.email}
                onChange={(event) => setLoginForm((current) => ({ ...current, email: event.target.value }))}
                placeholder="请输入邮箱"
                type="email"
              />
            </label>
            <label className="settings-field">
              <span>密码</span>
              <input
                autoComplete="current-password"
                value={loginForm.password}
                onChange={(event) => setLoginForm((current) => ({ ...current, password: event.target.value }))}
                placeholder="请输入密码"
                type="password"
              />
            </label>
            <label className="settings-field">
              <span>验证码</span>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <input
                  value={loginForm.captcha}
                  onChange={(event) => setLoginForm((current) => ({ ...current, captcha: event.target.value }))}
                  placeholder="请输入 6 位验证码"
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  onClick={onSendLoginCode}
                  disabled={isSendingLoginCode || loginCodeCooldownSeconds > 0 || !loginForm.email.trim()}
                  style={{ minWidth: 112 }}
                >
                  {isSendingLoginCode
                    ? "发送中..."
                    : loginCodeCooldownSeconds > 0
                      ? `${loginCodeCooldownSeconds}s 后重发`
                      : "发送验证码"}
                </button>
              </div>
            </label>
            <div className="login-hints">
              <span>支持邮箱密码登录，也支持邮箱验证码登录</span>
              <em>可填写密码直接登录，或先发送验证码后用验证码登录。</em>
            </div>
            <label className="login-agreement-row">
              <input
                data-login-agreement
                checked={agreementEnabled ? loginForm.agreementAccepted : true}
                onChange={(event) =>
                  setLoginForm((current) => ({ ...current, agreementAccepted: event.target.checked }))
                }
                type="checkbox"
              />
              <span>
                我已阅读并同意{" "}
                <button type="button" className="login-inline-link" onClick={() => setAgreementDialog("tos")}>
                  {authStatus.agreement?.tos_title || "服务协议"}
                </button>{" "}
                和{" "}
                <button type="button" className="login-inline-link" onClick={() => setAgreementDialog("policy")}>
                  {authStatus.agreement?.policy_title || "使用政策"}
                </button>
              </span>
            </label>
            {errorMessage ? <div className="login-error-banner">{errorMessage}</div> : null}
            <div className="login-actions">
              <button
                className="login-submit-btn"
                disabled={
                  isSubmittingLogin ||
                  !loginForm.email.trim() ||
                  (!loginForm.password.trim() && !loginForm.captcha.trim()) ||
                  (agreementEnabled && !loginForm.agreementAccepted)
                }
                type="button"
                onClick={() => onLoginSubmit(agreementEnabled ? (document.querySelector("[data-login-agreement]") as HTMLInputElement | null)?.checked ?? loginForm.agreementAccepted : true)}
              >
                {isSubmittingLogin ? "登录中..." : "登录"}
              </button>
            </div>
            <div className="login-hints">
              <span>{authServiceStatusLabel}</span>
              {authStatus.last_error ? <em>{authStatus.last_error}</em> : null}
            </div>
          </div>
        </div>

        {agreementDialog ? (
          <div className="login-modal-shell" role="dialog" aria-modal="true">
            <button className="login-modal-backdrop" type="button" onClick={() => setAgreementDialog(null)} />
            <div className="login-modal-card">
              <div className="login-modal-head">
                <strong>{agreementTitle}</strong>
                <button type="button" onClick={() => setAgreementDialog(null)}>
                  关闭
                </button>
              </div>
              <div className="login-modal-body" dangerouslySetInnerHTML={{ __html: agreementHtml }} />
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}
