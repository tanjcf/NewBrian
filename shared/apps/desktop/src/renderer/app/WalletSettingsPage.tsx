// @ts-nocheck
import { useEffect, useRef, useState } from "react";

const FEATURE_UNDER_DEVELOPMENT_MESSAGE = "该接口处于开发中，暂时无法使用。";

function unwrapIpcErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  // Electron IPC wraps remote errors; prefer the trailing business message.
  return raw.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/i, "").trim() || raw;
}

function formatRedeemError(error: unknown): string {
  const message = unwrapIpcErrorMessage(error);
  if (!message.trim()) return "兑换失败，请稍后重试。";
  if (/请先登录|login required|AUTH_UNAUTHORIZED|unauthorized/i.test(message)) {
    return "请先登录后再兑换。";
  }
  if (/redeem code is invalid|code is required|invalid redeem/i.test(message)) {
    return "兑换码无效，请检查后重试。";
  }
  if (/redeem code is not active|not active/i.test(message) && /redeem/i.test(message)) {
    return "兑换码未启用或已停用。";
  }
  if (/redeem code expired|expired/i.test(message) && /redeem|兑换/i.test(message)) {
    return "兑换码已过期。";
  }
  if (/usage limit reached|already used|update failed/i.test(message)) {
    return "兑换码已使用或次数已用尽。";
  }
  if (/missing subscription plan/i.test(message)) {
    return "兑换码缺少套餐配置，请联系发放方。";
  }
  if (/ECONNREFUSED|ENOTFOUND|Failed to fetch|fetch failed|无法连接/i.test(message)) {
    return "无法连接 spring-app，请确认网关可用后重试。";
  }
  if (/处于开发中|尚未接入|not implemented|404|501/i.test(message)) {
    return FEATURE_UNDER_DEVELOPMENT_MESSAGE;
  }
  return message;
}

function formatFeatureAvailabilityError(error: unknown): string {
  const message = unwrapIpcErrorMessage(error);
  if (!message.trim()) return FEATURE_UNDER_DEVELOPMENT_MESSAGE;
  if (
    /充值支付尚未开通|套餐购买尚未开通|支付通道尚未接通|暂不支持在线|spring-app 未返回|spring-app 未确认|超额扣款开关未接入|支付交接码|handoff|请先登录/i.test(
      message
    )
  ) {
    return message;
  }
  if (/ECONNREFUSED|ENOTFOUND|Failed to fetch|fetch failed/i.test(message)) {
    return "无法连接 spring-app，请确认网关可用后重试。";
  }
  if (
    /is not defined|not implemented|尚未接入|尚未由|即将上线|处于开发中|ENOENT|ECONNREFUSED|ENOTFOUND|Failed to fetch|fetch failed|Unable to fetch subscription|订阅信息加载失败|gatewayOrigin|insufficient wallet balance|wallet overage debit is disabled/i.test(
      message
    )
  ) {
    if (/insufficient wallet balance/i.test(message)) return "钱包余额不足，请先充值。";
    if (/wallet overage debit is disabled|enable wallet overage debit/i.test(message)) {
      return "套餐额度已用尽。请开启「超出额度用钱包余额扣款」，或充值/升级套餐后再试。";
    }
    return FEATURE_UNDER_DEVELOPMENT_MESSAGE;
  }
  return message;
}

function money(value: unknown): string {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? amount.toFixed(2) : "0.00";
}

export function WalletSettingsPage(props: {
  api: any;
  displayUserEmail?: string;
}) {
  const { api, displayUserEmail } = props;
  const [code, setCode] = useState("");
  const [redeeming, setRedeeming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [walletMessage, setWalletMessage] = useState("");
  const [walletError, setWalletError] = useState("");
  const [redeemMessage, setRedeemMessage] = useState("");
  const [redeemError, setRedeemError] = useState("");
  const [wallet, setWallet] = useState<any>(null);
  const [overageEnabled, setOverageEnabled] = useState(false);
  const [overageBusy, setOverageBusy] = useState(false);
  const loadingRef = useRef(false);
  const settledRef = useRef(false);
  const redeemInFlightRef = useRef(false);

  const applyWalletPayload = (next: any) => {
    const source =
      next?.subscription && typeof next.subscription === "object"
        ? next.subscription
        : next && typeof next === "object"
          ? next
          : { summary: {}, subscriptions: [] };
    setWallet(source);
    const summary = source?.summary && typeof source.summary === "object" ? source.summary : source;
    const enabled = Boolean(
      summary?.wallet_overage_enabled
        ?? summary?.walletOverageEnabled
        ?? source?.wallet_overage_enabled
        ?? source?.walletOverageEnabled
        ?? false
    );
    setOverageEnabled(enabled);
  };

  const loadWallet = async (force = false) => {
    if (!force && (loadingRef.current || settledRef.current)) return;
    if (!api?.getBillingSubscription) {
      setWalletError(FEATURE_UNDER_DEVELOPMENT_MESSAGE);
      settledRef.current = true;
      return;
    }
    loadingRef.current = true;
    try {
      // Do not clear redeem feedback while a redeem attempt is in flight or just finished.
      if (!settledRef.current && !redeemInFlightRef.current) setWalletError("");
      const next = await api.getBillingSubscription();
      applyWalletPayload(next);
      if (next?.under_development) {
        if (!redeemInFlightRef.current) setWalletError(FEATURE_UNDER_DEVELOPMENT_MESSAGE);
      } else if (!redeemInFlightRef.current) {
        setWalletError("");
      }
      settledRef.current = true;
    } catch (error) {
      setWallet((current: any) => current || { summary: {}, subscriptions: [] });
      if (!redeemInFlightRef.current) {
        setWalletError(formatFeatureAvailabilityError(error));
      }
      settledRef.current = true;
    } finally {
      loadingRef.current = false;
    }
  };

  useEffect(() => {
    void loadWallet(false);
  }, [api]);

  const summary = wallet?.summary || {};
  const subscriptions = Array.isArray(wallet?.subscriptions) ? wallet.subscriptions : [];
  const subscription =
    subscriptions.find((item: any) => ["active", "valid"].includes(String(item.status || "").toLowerCase())) ||
    subscriptions[0] ||
    summary ||
    {};
  const balance = Number(
    summary.available_balance ?? summary.balance ?? subscription.available_balance ?? subscription.balance ?? 0
  );
  const planName = String(subscription.plan_name || summary.plan_name || "").trim();
  const expiresText = String(subscription.expires_at_display || summary.expires_at_display || subscription.expires_at || summary.expires_at || "").trim();
  const concurrency = Number(subscription.concurrency_limit ?? summary.concurrency_limit ?? 0);
  const usageSubscriptions = (subscriptions.length ? subscriptions : planName ? [subscription] : []).filter((item: any) => {
    const name = String(item?.plan_name || item?.plan_code || "").trim();
    return Boolean(name);
  });
  const usagePercent = (used: unknown, quota: unknown) => {
    const usedNum = Number(used ?? 0);
    const quotaNum = Number(quota ?? 0);
    if (!Number.isFinite(usedNum) || !Number.isFinite(quotaNum) || quotaNum <= 0) return 0;
    return Math.max(0, Math.min(100, Math.round((usedNum / quotaNum) * 100)));
  };
  const usageStatusLabel = (item: any) => {
    const raw = String(item?.status_label || item?.status || "").trim();
    const normalized = raw.toLowerCase();
    if (["active", "valid", "有效"].includes(normalized) || normalized.includes("active")) return "有效";
    if (["expired", "已过期"].includes(normalized) || normalized.includes("expir")) return "已过期";
    return raw || "有效";
  };

  const openWalletPortal = async () => {
    if (busy) return;
    if (typeof api?.openWalletPayment !== "function") {
      setWalletError(FEATURE_UNDER_DEVELOPMENT_MESSAGE);
      return;
    }
    setBusy(true);
    setWalletError("");
    setWalletMessage("");
    try {
      const result = await api.openWalletPayment({ intent: "recharge" });
      const warning = String(result?.warning || "").trim();
      setWalletMessage(
        warning ||
          "已在系统默认浏览器打开钱包页。充值或购买套餐完成后，可返回点击刷新余额。"
      );
    } catch (error) {
      setWalletError(formatFeatureAvailabilityError(error));
    } finally {
      setBusy(false);
    }
  };

  const redeem = async () => {
    if (!code.trim() || redeeming || redeemInFlightRef.current) return;
    if (!api?.redeemCode) {
      setRedeemError(FEATURE_UNDER_DEVELOPMENT_MESSAGE);
      setRedeemMessage("");
      return;
    }
    redeemInFlightRef.current = true;
    setRedeeming(true);
    setRedeemError("");
    setRedeemMessage("");
    try {
      const result = await api.redeemCode({ code: code.trim() });
      if (result && typeof result === "object" && result.ok === false) {
        throw new Error(String(result.message || result.detail || "兑换失败，请稍后重试。"));
      }
      setCode("");
      const summarySource =
        result?.result && typeof result.result === "object"
          ? result.result
          : result && typeof result === "object"
            ? result
            : null;
      if (summarySource) {
        applyWalletPayload({ subscription: summarySource, summary: summarySource });
      }
      const planHint = String(
        summarySource?.plan_name ||
          summarySource?.summary?.plan_name ||
          result?.result?.plan_name ||
          result?.plan_name ||
          ""
      ).trim();
      setRedeemMessage(planHint ? `兑换成功：已开通「${planHint}」。` : "兑换成功，钱包权益已更新。");
      settledRef.current = false;
      try {
        await loadWallet(true);
      } catch {
        /* redeem already succeeded; keep redeemMessage */
      }
    } catch (error) {
      setRedeemMessage("");
      setRedeemError(formatRedeemError(error));
    } finally {
      setRedeeming(false);
      redeemInFlightRef.current = false;
    }
  };

  const toggleOverage = async () => {
    if (overageBusy) return;
    if (typeof api?.setWalletOverageEnabled !== "function") {
      setWalletError("超额扣款开关未接入 spring-app，无法保存。");
      return;
    }
    const next = !overageEnabled;
    const previous = overageEnabled;
    setOverageBusy(true);
    setWalletError("");
    setWalletMessage("");
    try {
      const result = await api.setWalletOverageEnabled({ enabled: next });
      applyWalletPayload(result);
      const confirmed = Boolean(
        result?.wallet_overage_enabled ??
          result?.walletOverageEnabled ??
          result?.summary?.wallet_overage_enabled ??
          result?.summary?.walletOverageEnabled
      );
      if (confirmed !== next) {
        throw new Error("spring-app 未确认开关状态，请刷新后重试。");
      }
      setOverageEnabled(confirmed);
      setWalletMessage(
        confirmed
          ? "已同步 spring-app：套餐额度用尽后将使用钱包余额扣款。"
          : "已同步 spring-app：超出套餐额度时不会扣钱包余额。"
      );
      settledRef.current = false;
      await loadWallet(true);
    } catch (error) {
      setOverageEnabled(previous);
      setWalletError(formatFeatureAvailabilityError(error));
      settledRef.current = false;
      try {
        await loadWallet(true);
      } catch {
        /* keep previous error */
      }
    } finally {
      setOverageBusy(false);
    }
  };

  return (
    <div className="wallet-settings-page">
      <div className="settings-page-head">
        <div>
          <h3>钱包</h3>
        </div>
        <button
          type="button"
          onClick={() => {
            settledRef.current = false;
            void loadWallet(true);
          }}
        >
          刷新余额
        </button>
      </div>
      <section className="wallet-summary-card">
        <div>
          <span>钱包余额</span>
          <strong>¥{money(balance)}</strong>
          <p>{displayUserEmail || "当前登录账号"}</p>
        </div>
        <dl>
          <div>
            <dt>当前套餐</dt>
            <dd>{planName || "暂无套餐"}</dd>
          </div>
          <div>
            <dt>有效期</dt>
            <dd>{expiresText || "--"}</dd>
          </div>
          <div>
            <dt>并发</dt>
            <dd>{Number.isFinite(concurrency) ? concurrency : 0} 路</dd>
          </div>
        </dl>
      </section>

      <section className="wallet-usage-section">
        <div className="settings-card-head">
          <div>
            <strong>费用与用量</strong>
            <p>展示当前套餐的每日 / 月度费用额度使用情况。</p>
          </div>
        </div>
        {usageSubscriptions.length ? (
          <div className="wallet-usage-list">
            {usageSubscriptions.map((item: any, index: number) => {
              const name = String(item.plan_name || item.plan_code || `套餐 ${index + 1}`);
              const provider = String(item.provider_name || item.vendor_name || item.provider || "").trim();
              const dailyUsed = Number(item.daily_cost_used ?? item.daily_used ?? 0);
              const dailyQuota = Number(item.daily_quota ?? 0);
              const monthlyUsed = Number(item.monthly_cost_used ?? item.monthly_used ?? 0);
              const monthlyQuota = Number(item.monthly_quota ?? 0);
              const dailyPct = usagePercent(dailyUsed, dailyQuota);
              const monthlyPct = usagePercent(monthlyUsed, monthlyQuota);
              const status = usageStatusLabel(item);
              return (
                <article key={`${name}-${String(item.expires_at || item.id || index)}`} className="wallet-usage-card">
                  <div className="wallet-usage-card-head">
                    <div className="wallet-usage-title-row">
                      <strong>{name}</strong>
                      {provider ? <span className="wallet-usage-provider">{provider}</span> : null}
                    </div>
                    <em className={status === "有效" ? "on" : ""}>{status}</em>
                  </div>
                  <div className="wallet-usage-meter">
                    <div className="wallet-usage-meter-row">
                      <span>每日</span>
                      <b>
                        ¥{money(dailyUsed)} / ¥{money(dailyQuota)}
                      </b>
                    </div>
                    <div className="wallet-usage-meter-bar" aria-hidden="true">
                      <i style={{ width: `${dailyPct}%` }} />
                    </div>
                  </div>
                  <div className="wallet-usage-meter">
                    <div className="wallet-usage-meter-row">
                      <span>月度</span>
                      <b>
                        ¥{money(monthlyUsed)} / ¥{money(monthlyQuota)}
                      </b>
                    </div>
                    <div className="wallet-usage-meter-bar" aria-hidden="true">
                      <i style={{ width: `${monthlyPct}%` }} />
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <small className="wallet-usage-empty">暂无套餐用量数据，请点击刷新余额后重试。</small>
        )}
      </section>

      <section className="settings-card wallet-portal-card">
        <div className="settings-card-head">
          <div>
            <strong>充值 / 升级套餐</strong>
            <p>点击后打开网页钱包；无需再次登录，可在网页中完成充值与购买套餐。</p>
          </div>
        </div>
        <div className="wallet-recharge-actions">
          <button type="button" className="wallet-portal-btn" disabled={busy} onClick={() => void openWalletPortal()}>
            {busy ? "正在打开…" : "充值 / 升级套餐"}
          </button>
        </div>
      </section>

      <section className="settings-card wallet-overage-card">
        <div className="settings-card-head">
          <div>
            <strong>超出额度用钱包余额扣款</strong>
            <p>开启/关闭会立即调用 spring-app 保存；本地不会假成功。开启后，套餐日/月额度用尽时可用钱包余额继续扣款；关闭后超出部分不会扣钱包。</p>
          </div>
          <button
            type="button"
            className={overageEnabled ? "wallet-overage-switch on" : "wallet-overage-switch"}
            aria-pressed={overageEnabled}
            disabled={overageBusy || busy}
            onClick={() => void toggleOverage()}
          >
            <span>{overageEnabled ? "已开启" : "已关闭"}</span>
          </button>
        </div>
        <small>{overageEnabled ? "当前允许超额扣钱包余额。" : "当前禁止超额扣钱包余额（默认）。"}</small>
      </section>

      <section className="settings-card wallet-redeem-card">
        <strong>兑换码</strong>
        <p>输入 spring-app 发放的兑换码。</p>
        <div>
          <input
            id="wallet-redeem-code"
            value={code}
            onChange={(event) => {
              setCode(event.target.value);
              if (redeemError) setRedeemError("");
              if (redeemMessage) setRedeemMessage("");
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") void redeem();
            }}
            placeholder="请输入兑换码"
            disabled={redeeming}
            aria-invalid={Boolean(redeemError)}
            aria-describedby={redeemError ? "wallet-redeem-feedback" : redeemMessage ? "wallet-redeem-feedback" : undefined}
          />
          <button type="button" onClick={() => void redeem()} disabled={redeeming || !code.trim()}>
            {redeeming ? "处理中…" : "确认兑换"}
          </button>
        </div>
        {redeemMessage ? (
          <small id="wallet-redeem-feedback" className="wallet-success" role="status" aria-live="polite">
            {redeemMessage}
          </small>
        ) : null}
        {redeemError ? (
          <small id="wallet-redeem-feedback" className="wallet-error" role="alert" aria-live="assertive">
            {redeemError}
          </small>
        ) : null}
      </section>

      {walletMessage ? <small className="wallet-success">{walletMessage}</small> : null}
      {walletError ? <small className="wallet-error">{walletError}</small> : null}
    </div>
  );
}
