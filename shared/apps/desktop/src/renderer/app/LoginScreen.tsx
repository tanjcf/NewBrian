import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import brandIcon from "../assets/newbrain-icon-256.png";
import { LoginCeremonyOverlay, openLoginCeremonyFromHotspot } from "./LoginCeremonyOverlay";
import {
  authServiceStatusLabel,
  canSubmitLoginForm,
  isCnMobile,
  normalizeCnMobileInput,
  type LoginAuthStatusView,
  type LoginEmailAuthMode,
  type LoginFormState
} from "./login-form";
import { applyRememberedLogin, mergeRememberedLogin, type RememberedLogin } from "../../shared/remembered-login";

export type { LoginAuthStatusView, LoginEmailAuthMode, LoginFormState } from "./login-form";
export {
  authServiceStatusLabel,
  canSubmitLoginForm,
  initialLoginForm,
  isCnMobile,
  normalizeCnMobileInput,
  resolveLoginIdentifier,
  shouldUseLoginCode
} from "./login-form";

export interface LoginScreenProps {
  agreementDialog: null | "tos" | "policy";
  authStatus: LoginAuthStatusView;
  errorMessage: string;
  isSendingLoginCode: boolean;
  isSubmittingLogin: boolean;
  loginCodeCooldownSeconds: number;
  loginForm: LoginFormState;
  /** Windows-only Alipay OAuth; omit on platforms without Alipay. */
  onAlipayQrLogin?: () => void;
  onLoginSubmit: (
    agreementChecked?: boolean,
    emailAuthMode?: LoginEmailAuthMode
  ) => void | boolean | Promise<void | boolean>;
  onSendLoginCode: () => void;
  setAgreementDialog: Dispatch<SetStateAction<null | "tos" | "policy">>;
  setLoginForm: Dispatch<SetStateAction<LoginFormState>>;
}

type PanelView = "form" | "alipay";

export function LoginScreen({
  agreementDialog,
  authStatus,
  errorMessage,
  isSendingLoginCode,
  isSubmittingLogin,
  loginCodeCooldownSeconds,
  loginForm,
  onAlipayQrLogin,
  onLoginSubmit,
  onSendLoginCode,
  setAgreementDialog,
  setLoginForm
}: LoginScreenProps) {
  const passwordLoginEnabled = authStatus.password_login_enabled !== false;
  const emailCodeLoginEnabled = authStatus.email_code_login_enabled === true;
  const [emailAuthMode, setEmailAuthMode] = useState<LoginEmailAuthMode>(
    passwordLoginEnabled ? "password" : "code"
  );
  const [rememberLogin, setRememberLogin] = useState(true);
  const rememberedLoginRef = useRef<RememberedLogin | null>(null);
  const [panelView, setPanelView] = useState<PanelView>("form");
  const agreementEnabled = Boolean(authStatus.agreement?.enabled);
  const agreementTitle =
    agreementDialog === "policy"
      ? authStatus.agreement?.policy_title || "使用政策"
      : authStatus.agreement?.tos_title || "服务协议";
  const agreementHtml =
    agreementDialog === "policy"
      ? authStatus.agreement?.policy_content_html || "<p>暂无内容</p>"
      : authStatus.agreement?.tos_content_html || "<p>暂无内容</p>";
  const alipayEnabled = typeof onAlipayQrLogin === "function";
  // Main process sets this from spring-app clock: packaged = Oct 1 only; local = always on.
  const loginCeremonyEnabled = authStatus.login_ceremony_enabled === true;

  useEffect(() => {
    if (!isSubmittingLogin && panelView === "alipay") {
      setPanelView("form");
    }
  }, [isSubmittingLogin, panelView]);

  useEffect(() => {
    const load = window.newbrain?.loadRememberedLogin;
    if (!load) return;
    let active = true;
    void load()
      .then((remembered) => {
        if (!active || !remembered) return;
        rememberedLoginRef.current = remembered;
        setRememberLogin(true);
        setLoginForm((current) => applyRememberedLogin(current, remembered));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [setLoginForm]);

  useEffect(() => {
    if (!passwordLoginEnabled) {
      setEmailAuthMode("code");
      return;
    }
    if (!emailCodeLoginEnabled) {
      setEmailAuthMode("password");
    }
  }, [passwordLoginEnabled, emailCodeLoginEnabled]);

  const channel = loginForm.channel === "phone" ? "phone" : "email";
  const agreementChecked = agreementEnabled ? loginForm.agreementAccepted : true;
  const effectiveEmailAuthMode: LoginEmailAuthMode =
    !passwordLoginEnabled ? "code" : !emailCodeLoginEnabled ? "password" : emailAuthMode;
  const canSubmit = canSubmitLoginForm(loginForm, {
    emailAuthMode: effectiveEmailAuthMode,
    isSubmitting: isSubmittingLogin,
    agreementEnabled
  });

  function setChannel(next: "email" | "phone") {
    setLoginForm((current) => ({
      ...current,
      channel: next,
      captcha: ""
    }));
    if (next === "email") setEmailAuthMode(passwordLoginEnabled ? "password" : "code");
  }

  async function persistRememberedLogin(snapshot: LoginFormState, mode: LoginEmailAuthMode) {
    const api = window.newbrain;
    if (!api?.saveRememberedLogin || !api.clearRememberedLogin) return;
    if (!rememberLogin) {
      rememberedLoginRef.current = null;
      await api.clearRememberedLogin();
      return;
    }
    const next = mergeRememberedLogin(
      rememberedLoginRef.current,
      snapshot,
      snapshot.channel !== "phone" && mode === "password"
    );
    if (!next) return;
    await api.saveRememberedLogin(next);
    rememberedLoginRef.current = next;
  }

  function startAlipay() {
    if (!onAlipayQrLogin) return;
    if (agreementEnabled && !agreementChecked) {
      onAlipayQrLogin();
      return;
    }
    setPanelView("alipay");
    onAlipayQrLogin();
  }

  return (
    <main className="codex-shell login-shell">
      <section className="login-stage">
        <div className="login-panel">
          <button
            className="login-panel-close"
            type="button"
            aria-label="关闭"
            title="关闭"
            onClick={() => void window.newbrain?.controlWindow("close")}
          >
            ×
          </button>

          <div className="login-panel-brand">
            <img src={brandIcon} alt="" width={56} height={56} />
            <strong>
              新脑子
              <em>就是好使</em>
            </strong>
          </div>

          {panelView === "alipay" && alipayEnabled ? (
            <div className="login-wait">
              <div className="login-wait-icon" aria-hidden="true">
                支
              </div>
              <h2>在浏览器中完成扫码</h2>
              <p>已打开支付宝官方授权页。扫码成功后，此窗口会自动继续。</p>
              <button type="button" className="login-ghost-btn" onClick={() => setPanelView("form")}>
                取消
              </button>
            </div>
          ) : (
            <div className="login-panel-form">
              <div className="login-segment" role="tablist" aria-label="登录方式">
                <button
                  type="button"
                  className={channel === "email" ? "active" : undefined}
                  role="tab"
                  aria-selected={channel === "email"}
                  onClick={() => setChannel("email")}
                >
                  邮箱
                </button>
                <button
                  type="button"
                  className={channel === "phone" ? "active" : undefined}
                  role="tab"
                  aria-selected={channel === "phone"}
                  onClick={() => setChannel("phone")}
                >
                  手机
                </button>
              </div>

              {channel === "email" ? (
                <>
                  <label className="login-field">
                    <span>邮箱</span>
                    <input
                      autoComplete="username"
                      value={loginForm.email}
                      onChange={(event) =>
                        setLoginForm((current) => ({ ...current, email: event.target.value }))
                      }
                      placeholder="请输入邮箱"
                      type="email"
                    />
                  </label>

                  {effectiveEmailAuthMode === "password" ? (
                    <div className="login-fields-block">
                      <label className="login-field">
                        <span>密码</span>
                        <input
                          autoComplete="current-password"
                          value={loginForm.password}
                          onChange={(event) =>
                            setLoginForm((current) => ({ ...current, password: event.target.value }))
                          }
                          placeholder="请输入密码"
                          type="password"
                        />
                      </label>
                      {emailCodeLoginEnabled ? (
                        <button
                          type="button"
                          className="login-alt-link"
                          onClick={() => {
                            setEmailAuthMode("code");
                          }}
                        >
                          改用邮箱验证码登录
                        </button>
                      ) : null}
                    </div>
                  ) : (
                    <div className="login-fields-block">
                      <label className="login-field">
                        <span>邮箱验证码</span>
                        <div className="login-code-row">
                          <input
                            value={loginForm.captcha}
                            onChange={(event) =>
                              setLoginForm((current) => ({ ...current, captcha: event.target.value }))
                            }
                            placeholder="6 位验证码"
                            inputMode="numeric"
                            maxLength={6}
                          />
                          <button
                            type="button"
                            onClick={onSendLoginCode}
                            disabled={
                              isSendingLoginCode ||
                              loginCodeCooldownSeconds > 0 ||
                              !loginForm.email.trim()
                            }
                          >
                            {isSendingLoginCode
                              ? "发送中..."
                              : loginCodeCooldownSeconds > 0
                                ? `${loginCodeCooldownSeconds}s`
                                : "发送"}
                          </button>
                        </div>
                      </label>
                      {passwordLoginEnabled ? (
                        <button
                          type="button"
                          className="login-alt-link"
                          onClick={() => {
                            setEmailAuthMode("password");
                            setLoginForm((current) => ({ ...current, captcha: "" }));
                          }}
                        >
                          改用密码登录
                        </button>
                      ) : null}
                    </div>
                  )}
                </>
              ) : (
                <>
                  <label className="login-field">
                    <span>手机号</span>
                    <input
                      autoComplete="tel"
                      value={loginForm.phone}
                      onChange={(event) =>
                        setLoginForm((current) => ({
                          ...current,
                          phone: normalizeCnMobileInput(event.target.value)
                        }))
                      }
                      placeholder="11 位手机号"
                      type="tel"
                      inputMode="numeric"
                      maxLength={11}
                    />
                  </label>
                  <label className="login-field">
                    <span>短信验证码</span>
                    <div className="login-code-row">
                      <input
                        value={loginForm.captcha}
                        onChange={(event) =>
                          setLoginForm((current) => ({ ...current, captcha: event.target.value }))
                        }
                        placeholder="6 位验证码"
                        inputMode="numeric"
                        maxLength={6}
                      />
                      <button
                        type="button"
                        onClick={onSendLoginCode}
                        disabled={
                          isSendingLoginCode ||
                          loginCodeCooldownSeconds > 0 ||
                          !isCnMobile(loginForm.phone)
                        }
                      >
                        {isSendingLoginCode
                          ? "发送中..."
                          : loginCodeCooldownSeconds > 0
                            ? `${loginCodeCooldownSeconds}s`
                            : "获取验证码"}
                      </button>
                    </div>
                  </label>
                </>
              )}

              <label className="login-agreement-row">
                <input
                  checked={rememberLogin}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    setRememberLogin(checked);
                    if (!checked) {
                      rememberedLoginRef.current = null;
                      void window.newbrain?.clearRememberedLogin?.().catch(() => undefined);
                    }
                  }}
                  type="checkbox"
                />
                <span>记住邮箱、密码和手机号</span>
              </label>

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
                  <button
                    type="button"
                    className="login-inline-link"
                    onClick={() => setAgreementDialog("policy")}
                  >
                    {authStatus.agreement?.policy_title || "使用政策"}
                  </button>
                </span>
              </label>

              {errorMessage ? <div className="login-error-banner">{errorMessage}</div> : null}

              <button
                className="login-submit-btn"
                disabled={!canSubmit}
                type="button"
                onClick={() => {
                  const snapshot = loginForm;
                  const mode = effectiveEmailAuthMode;
                  const agreement = agreementEnabled
                    ? ((document.querySelector("[data-login-agreement]") as HTMLInputElement | null)?.checked ??
                      loginForm.agreementAccepted)
                    : true;
                  void Promise.resolve(onLoginSubmit(agreement, mode))
                    .then((succeeded) => {
                      if (succeeded !== true) return;
                      return persistRememberedLogin(snapshot, mode);
                    })
                    .catch(() => undefined);
                }}
              >
                {isSubmittingLogin && panelView === "form" ? "登录中..." : "继续"}
              </button>

              {alipayEnabled ? (
                <>
                  <div className="login-divider">或</div>
                  <button
                    type="button"
                    className="login-oauth-btn"
                    disabled={isSubmittingLogin}
                    onClick={startAlipay}
                  >
                    <span className="login-oauth-mark" aria-hidden="true">
                      支
                    </span>
                    支付宝扫码登录
                  </button>
                </>
              ) : null}

              <div className="login-hints login-service-hints">
                <span>{authServiceStatusLabel(authStatus)}</span>
                {authStatus.last_error ? <em>{String(authStatus.last_error)}</em> : null}
                {loginCeremonyEnabled ? (
                  <span className="login-ceremony-promo">欢庆国庆 · 找到彩蛋有好礼</span>
                ) : null}
              </div>
            </div>
          )}
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

      {loginCeremonyEnabled ? (
        <button
          type="button"
          className="login-easter-hotspot"
          aria-label="彩蛋入口"
          title="移入展开"
          onMouseEnter={(event) => openLoginCeremonyFromHotspot(event.currentTarget)}
        >
          <svg viewBox="0 0 30 20" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <rect width="30" height="20" fill="#de2910" />
            <g fill="#ffde00">
              <polygon points="5,2.2 5.7,4.3 8,4.3 6.15,5.6 6.85,7.8 5,6.5 3.15,7.8 3.85,5.6 2,4.3 4.3,4.3" />
              <polygon
                transform="translate(8.2,1.6) scale(0.32) rotate(25)"
                points="5,2.2 5.7,4.3 8,4.3 6.15,5.6 6.85,7.8 5,6.5 3.15,7.8 3.85,5.6 2,4.3 4.3,4.3"
              />
              <polygon
                transform="translate(10.2,3.4) scale(0.32) rotate(-15)"
                points="5,2.2 5.7,4.3 8,4.3 6.15,5.6 6.85,7.8 5,6.5 3.15,7.8 3.85,5.6 2,4.3 4.3,4.3"
              />
              <polygon
                transform="translate(10.2,5.8) scale(0.32) rotate(-35)"
                points="5,2.2 5.7,4.3 8,4.3 6.15,5.6 6.85,7.8 5,6.5 3.15,7.8 3.85,5.6 2,4.3 4.3,4.3"
              />
              <polygon
                transform="translate(8.2,7.4) scale(0.32) rotate(-50)"
                points="5,2.2 5.7,4.3 8,4.3 6.15,5.6 6.85,7.8 5,6.5 3.15,7.8 3.85,5.6 2,4.3 4.3,4.3"
              />
            </g>
          </svg>
        </button>
      ) : null}

      <LoginCeremonyOverlay enabled={loginCeremonyEnabled} onContinue={() => undefined} />
    </main>
  );
}
