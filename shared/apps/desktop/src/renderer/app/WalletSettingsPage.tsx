// @ts-nocheck
import { useEffect, useRef, useState } from "react";

const FEATURE_UNDER_DEVELOPMENT_MESSAGE = "该接口处于开发中，暂时无法使用。";
const PAYMENT_UNAVAILABLE_MESSAGE = "在线充值/购买尚未开通，暂不支持支付到账。请使用兑换码获取权益。";

function formatFeatureAvailabilityError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  // Electron IPC wraps remote errors; prefer the trailing business message.
  const message = raw.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/i, "").trim() || raw;
  if (!message.trim()) return FEATURE_UNDER_DEVELOPMENT_MESSAGE;
  if (/充值支付尚未开通|套餐购买尚未开通|支付通道尚未接通|暂不支持在线|spring-app 未返回|spring-app 未确认|超额扣款开关未接入/i.test(message)) {
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
    if (/not implemented|501/i.test(message)) return PAYMENT_UNAVAILABLE_MESSAGE;
    return FEATURE_UNDER_DEVELOPMENT_MESSAGE;
  }
  return message;
}

function money(value: unknown): string {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? amount.toFixed(2) : "0.00";
}

function unwrapList(payload: unknown): any[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    if (Array.isArray(record.items)) return record.items as any[];
    if (Array.isArray(record.data)) return record.data as any[];
    if (Array.isArray(record.records)) return record.records as any[];
  }
  return [];
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
  const [wallet, setWallet] = useState<any>(null);
  const [plans, setPlans] = useState<any[]>([]);
  const [rechargeAmount, setRechargeAmount] = useState("50");
  const [rechargeMethod, setRechargeMethod] = useState("wechat");
  const [overageEnabled, setOverageEnabled] = useState(false);
  const [overageBusy, setOverageBusy] = useState(false);
  const [invoiceRecords, setInvoiceRecords] = useState<any[]>([]);
  const [invoiceRequests, setInvoiceRequests] = useState<any[]>([]);
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<number[]>([]);
  const [invoiceDialogOpen, setInvoiceDialogOpen] = useState(false);
  const [invoiceBusy, setInvoiceBusy] = useState(false);
  const [invoiceForm, setInvoiceForm] = useState({ title: "", taxId: "", email: displayUserEmail || "" });
  const loadingRef = useRef(false);
  const settledRef = useRef(false);

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
      if (!settledRef.current) setWalletError("");
      const next = await api.getBillingSubscription();
      applyWalletPayload(next);
      if (api.getSubscriptionCatalog) {
        const catalog = await api.getSubscriptionCatalog().catch(() => []);
        setPlans(unwrapList(catalog));
      }
      if (typeof api?.listWalletInvoiceRecords === "function") {
        const records = await api.listWalletInvoiceRecords({ limit: 50 }).catch(() => []);
        setInvoiceRecords(unwrapList(records));
      }
      if (typeof api?.listWalletInvoiceRequests === "function") {
        const requests = await api.listWalletInvoiceRequests({ limit: 20 }).catch(() => []);
        setInvoiceRequests(unwrapList(requests));
      }
      if (next?.under_development) {
        setWalletError(FEATURE_UNDER_DEVELOPMENT_MESSAGE);
      } else {
        setWalletError("");
      }
      settledRef.current = true;
    } catch (error) {
      setWallet((current: any) => current || { summary: {}, subscriptions: [] });
      setWalletError(formatFeatureAvailabilityError(error));
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

  const redeem = async () => {
    if (!code.trim() || redeeming) return;
    if (!api?.redeemCode) {
      setWalletError(FEATURE_UNDER_DEVELOPMENT_MESSAGE);
      return;
    }
    setRedeeming(true);
    setWalletError("");
    setWalletMessage("");
    try {
      await api.redeemCode({ code: code.trim() });
      setCode("");
      setWalletMessage("兑换成功，钱包权益已更新。");
      settledRef.current = false;
      await loadWallet(true);
    } catch (error) {
      setWalletError(formatFeatureAvailabilityError(error));
    } finally {
      setRedeeming(false);
    }
  };

  const recharge = async () => {
    if (busy) return;
    setWalletError(PAYMENT_UNAVAILABLE_MESSAGE);
    setWalletMessage("");
  };

  const purchase = async (_planId: number, _paymentMethod: string) => {
    if (busy) return;
    setWalletError(PAYMENT_UNAVAILABLE_MESSAGE);
    setWalletMessage("");
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

  const toggleInvoiceRecord = (id: number) => {
    setSelectedInvoiceIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    );
  };

  const openInvoiceDialog = () => {
    if (!selectedInvoiceIds.length) {
      setWalletError("请先勾选至少一条可开票记录。");
      return;
    }
    setWalletError("");
    setInvoiceForm((current) => ({
      ...current,
      email: current.email || displayUserEmail || ""
    }));
    setInvoiceDialogOpen(true);
  };

  const submitInvoiceRequest = async () => {
    if (invoiceBusy) return;
    if (typeof api?.createWalletInvoiceRequest !== "function") {
      setWalletError("开票接口未接入 spring-app，无法提交。");
      return;
    }
    const title = String(invoiceForm.title || "").trim();
    if (!title) {
      setWalletError("请填写发票抬头。");
      return;
    }
    if (!selectedInvoiceIds.length) {
      setWalletError("请先勾选至少一条可开票记录。");
      return;
    }
    setInvoiceBusy(true);
    setWalletError("");
    setWalletMessage("");
    try {
      await api.createWalletInvoiceRequest({
        invoice_title: title,
        tax_no: String(invoiceForm.taxId || "").trim() || undefined,
        contact_email: String(invoiceForm.email || "").trim() || undefined,
        redeem_log_ids: selectedInvoiceIds
      });
      setInvoiceDialogOpen(false);
      setSelectedInvoiceIds([]);
      setInvoiceForm((current) => ({ ...current, title: "", taxId: "" }));
      setWalletMessage("开票申请已提交到 spring-app，请等待开票处理。");
      settledRef.current = false;
      await loadWallet(true);
    } catch (error) {
      setWalletError(formatFeatureAvailabilityError(error));
    } finally {
      setInvoiceBusy(false);
    }
  };

  const invoiceStatusText = (status: unknown) => {
    const normalized = String(status || "").toLowerCase();
    if (normalized === "issued") return "已开票";
    if (normalized === "processing") return "开票中";
    if (normalized === "rejected") return "已驳回";
    if (normalized === "requested") return "已申请";
    return status ? String(status) : "处理中";
  };

  // 只展示接口返回的可购套餐；禁止本地占位目录（曾导致先闪 Starter/Pro/Team 再消失）。
  const catalog = Array.isArray(plans)
    ? plans.filter((plan: any) => {
        const id = Number(plan?.id || 0);
        const price = Number(plan?.price ?? 0);
        const isDefault = Boolean(plan?.is_default_for_new_users ?? plan?.isDefaultForNewUsers);
        return id > 0 && Number.isFinite(price) && price > 0 && !isDefault;
      })
    : [];

  return (
    <div className="wallet-settings-page">
      <div className="settings-page-head">
        <div>
          <h3>钱包</h3>
          <p>公测阶段请使用兑换码获取权益；在线充值与购买尚未开通。</p>
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
      <section className="settings-card wallet-recharge-card">
        <div className="settings-card-head">
          <div>
            <strong>充值</strong>
            <p>在线充值支付尚未开通；公测阶段不会模拟到账，请使用兑换码。</p>
          </div>
        </div>
        <div className="wallet-recharge-actions">
          <input
            aria-label="充值金额"
            placeholder="充值金额"
            inputMode="decimal"
            value={rechargeAmount}
            onChange={(event) => setRechargeAmount(event.target.value)}
            disabled
          />
          <select
            aria-label="支付方式"
            value={rechargeMethod}
            onChange={(event) => setRechargeMethod(event.target.value)}
            disabled
          >
            <option value="wechat">微信支付</option>
            <option value="alipay">支付宝</option>
          </select>
          <button type="button" onClick={() => void recharge()} disabled={busy}>
            立即充值
          </button>
        </div>
        <small>支付通道未接通前，充值与购买均不可到账，避免误发权益。</small>
      </section>
      <section className="wallet-package-section">
        <div className="settings-card-head">
          <div>
            <strong>套餐</strong>
            <p>在线购买尚未开通；请使用兑换码获取套餐权益。</p>
          </div>
          <button type="button" onClick={() => document.getElementById("wallet-redeem-code")?.focus()}>
            输入兑换码
          </button>
        </div>
        <div className="wallet-package-list">
          {catalog.map((plan: any, index: number) => {
            const id = Number(plan.id || 0);
            const title = String(plan.plan_name || plan.name || `套餐 ${index + 1}`);
            const priceLabel = String(plan.price_display || `¥${money(plan.price)}`);
            const meta = `余额 ¥${money(plan.balance_delta)} · 并发 ${Number(plan.concurrency_limit || 1)} 路${
              plan.duration_days ? ` · ${plan.duration_days} 天` : ""
            }`;
            return (
              <article key={`${id}-${title}-${index}`} className={plan.recommended ? "recommended" : undefined}>
                <strong>{title}</strong>
                <b>{priceLabel}</b>
                <span>{meta}</span>
                <div>
                  <button type="button" disabled={busy || id <= 0} onClick={() => void purchase(id, "balance")}>
                    余额购买
                  </button>
                  <button type="button" disabled={busy || id <= 0} onClick={() => void purchase(id, "wechat")}>
                    微信购买
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => document.getElementById("wallet-redeem-code")?.focus()}
                  >
                    兑换
                  </button>
                </div>
              </article>
            );
          })}
        </div>
        {!catalog.length ? <small>暂无可购买套餐（免费保底档不在目录中）。请刷新，或先在管理端上线付费套餐。</small> : null}
      </section>
      <section className="settings-card wallet-redeem-card">
        <strong>兑换码</strong>
        <p>输入 spring-app 发放的兑换码。</p>
        <div>
          <input
            id="wallet-redeem-code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void redeem();
            }}
            placeholder="请输入兑换码"
            disabled={redeeming}
          />
          <button type="button" onClick={() => void redeem()} disabled={redeeming || !code.trim()}>
            {redeeming ? "处理中…" : "确认兑换"}
          </button>
        </div>
      </section>

      <section className="invoice-center">
        <div className="invoice-center-head">
          <div>
            <h4>开发票</h4>
            <p>勾选可开票兑换记录，提交后调用 spring-app 开票接口。</p>
          </div>
          <button
            type="button"
            className="invoice-primary-button"
            disabled={invoiceBusy || !selectedInvoiceIds.length}
            onClick={openInvoiceDialog}
          >
            申请开票
          </button>
        </div>

        <div className="invoice-section-title">可开票记录</div>
        <div className="invoice-record-list">
          {invoiceRecords.length === 0 ? (
            <div className="invoice-empty">暂无可开票记录（需有入账金额且未申请过开票的兑换记录）。</div>
          ) : (
            invoiceRecords.map((item: any) => {
              const id = Number(item.id || 0);
              const checked = selectedInvoiceIds.includes(id);
              const title = String(item.title || item.plan_name || `兑换记录 #${id}`);
              const createdAt = String(item.created_at || "--");
              return (
                <label key={id} className="invoice-record-row" style={{ cursor: "pointer" }}>
                  <span style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleInvoiceRecord(id)}
                      disabled={invoiceBusy || id <= 0}
                    />
                    <span>
                      <strong>{title}</strong>
                      <span>
                        {createdAt} · ¥{money(item.amount)}
                      </span>
                    </span>
                  </span>
                </label>
              );
            })
          )}
        </div>

        <div className="invoice-section-title">开票申请</div>
        <div className="invoice-record-list">
          {invoiceRequests.length === 0 ? (
            <div className="invoice-empty">暂无开票申请。</div>
          ) : (
            invoiceRequests.map((item: any) => (
              <div key={String(item.id)} className="invoice-record-row">
                <div>
                  <strong>{String(item.invoice_title || "未命名抬头")}</strong>
                  <span>
                    ¥{money(item.amount)} · {String(item.contact_email || "--")}
                  </span>
                </div>
                <div className="invoice-record-meta">
                  <em className={String(item.status || "") === "issued" ? "issued" : "pending"}>
                    {invoiceStatusText(item.status)}
                  </em>
                  <span>{String(item.created_at || "")}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      {walletMessage ? <small className="wallet-success">{walletMessage}</small> : null}
      {walletError ? <small className="wallet-error">{walletError}</small> : null}

      {invoiceDialogOpen ? (
        <div
          className="invoice-dialog-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="wallet-invoice-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !invoiceBusy) setInvoiceDialogOpen(false);
          }}
        >
          <div className="invoice-dialog">
            <div className="invoice-dialog-head">
              <div>
                <h4 id="wallet-invoice-title">申请电子发票</h4>
                <p>已选 {selectedInvoiceIds.length} 条记录，将提交到 spring-app。</p>
              </div>
              <button type="button" onClick={() => setInvoiceDialogOpen(false)} disabled={invoiceBusy}>
                ×
              </button>
            </div>
            <label>
              <span>发票抬头</span>
              <input
                value={invoiceForm.title}
                onChange={(event) => setInvoiceForm({ ...invoiceForm, title: event.target.value })}
                placeholder="请输入企业或个人抬头"
                disabled={invoiceBusy}
              />
            </label>
            <label>
              <span>
                纳税人识别号 <em>选填</em>
              </span>
              <input
                value={invoiceForm.taxId}
                onChange={(event) => setInvoiceForm({ ...invoiceForm, taxId: event.target.value })}
                placeholder="请输入统一社会信用代码"
                disabled={invoiceBusy}
              />
            </label>
            <label>
              <span>接收邮箱</span>
              <input
                type="email"
                value={invoiceForm.email}
                onChange={(event) => setInvoiceForm({ ...invoiceForm, email: event.target.value })}
                placeholder="invoice@example.com"
                disabled={invoiceBusy}
              />
            </label>
            {walletError ? <div className="invoice-form-error">{walletError}</div> : null}
            <div className="invoice-dialog-actions">
              <button type="button" onClick={() => setInvoiceDialogOpen(false)} disabled={invoiceBusy}>
                取消
              </button>
              <button
                type="button"
                className="invoice-primary-button"
                onClick={() => void submitInvoiceRequest()}
                disabled={invoiceBusy}
              >
                {invoiceBusy ? "提交中…" : "提交申请"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
