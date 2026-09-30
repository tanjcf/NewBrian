// @ts-nocheck
import { useEffect, useRef, useState } from "react";
import { initialDesktopPreferences } from "./desktop-model";
import { projectWorkspaces } from "./workspace-visibility";
import { WalletSettingsPage } from "./WalletSettingsPage";

const FEATURE_UNDER_DEVELOPMENT_MESSAGE = "该接口处于开发中，暂时无法使用。";

function formatFeatureAvailabilityError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (!message.trim()) return FEATURE_UNDER_DEVELOPMENT_MESSAGE;
  if (
    /is not defined|not implemented|尚未接入|尚未由|即将上线|处于开发中|Error invoking remote method|ENOENT|ECONNREFUSED|ENOTFOUND|Failed to fetch|fetch failed|404|501|Unable to fetch subscription|订阅信息加载失败|gatewayOrigin/i.test(message)
  ) {
    return FEATURE_UNDER_DEVELOPMENT_MESSAGE;
  }
  return message;
}

export function SettingsWorkspace(ctx: any) {
  const { authStatus, setAuthStatus, setActiveSettingsSection, activeSettingsSection, setActiveFeature, setPreviewMode, modelConfig, setModelConfig, apiKeyConfigured, isUsingLoginSession, handleLogout, isAuthenticated, displayUserAvatar, displayUserName, displayUserEmail, displayUserPlan, onAccountProfileChange, saveDesktopPreferences, setDesktopPreferences, setChatUsesProject, setComposerPermission, isComposingNewThread, newThreadScope, environmentEnvText, setEnvironmentEnvText, formatEnvText, mcpServers, mcpDraft, setMcpDraft, editingMcpId, saveModelConfig, saveMcpServers, resetMcpDraft, handleSaveMcpServer, loadMcpDraft, handleDeleteMcpServer, handleToggleMcpServer, handleTestMcpServer, handleStartMcpServer, handleStopMcpServer, handleLoadMcpLogs, handleClearMcpLogs, handleInspectMcpServer, testingMcpId, mcpHealth, mcpLogs, expandedMcpLogId, setExpandedMcpLogId, mcpInspection, systemTools, setSystemTools, api, runAction, archivedThreads, workspaceCatalog, addExistingProject, selectedWorkspace, setSelectedWorkspaceId, setSelectedThreadId, setArchivedThreadIds, deleteThread, setWorkspaceCatalog, renderFeaturePanel, SettingsNavIcon, SettingsSwitch, writeClipboard, shellCommand, setShellCommand, bootstrapState, snapshot, desktopBootstrapStatus, setChatStatus, setErrorMessage } = ctx;
  const desktopPreferences = {
    ...initialDesktopPreferences,
    ...(ctx.desktopPreferences || {}),
    appearance: { ...initialDesktopPreferences.appearance, ...(ctx.desktopPreferences?.appearance || {}) },
    configuration: { ...initialDesktopPreferences.configuration, ...(ctx.desktopPreferences?.configuration || {}) },
    personalization: { ...initialDesktopPreferences.personalization, ...(ctx.desktopPreferences?.personalization || {}) },
    permissions: { ...initialDesktopPreferences.permissions, ...(ctx.desktopPreferences?.permissions || {}) },
    hooks: { ...initialDesktopPreferences.hooks, ...(ctx.desktopPreferences?.hooks || {}) },
    git: { ...initialDesktopPreferences.git, ...(ctx.desktopPreferences?.git || {}) },
    environment: { ...initialDesktopPreferences.environment, ...(ctx.desktopPreferences?.environment || {}) },
    editor: { ...initialDesktopPreferences.editor, ...(ctx.desktopPreferences?.editor || {}) },
    popup: { ...initialDesktopPreferences.popup, ...(ctx.desktopPreferences?.popup || {}) },
    dictation: { ...initialDesktopPreferences.dictation, ...(ctx.desktopPreferences?.dictation || {}) },
    notifications: { ...initialDesktopPreferences.notifications, ...(ctx.desktopPreferences?.notifications || {}) },
    shortcuts: { ...initialDesktopPreferences.shortcuts, ...(ctx.desktopPreferences?.shortcuts || {}) },
    worktree: { ...initialDesktopPreferences.worktree, ...(ctx.desktopPreferences?.worktree || {}) },
    browser: { ...initialDesktopPreferences.browser, ...(ctx.desktopPreferences?.browser || {}) },
    market: { ...initialDesktopPreferences.market, ...(ctx.desktopPreferences?.market || {}) },
    brain: { ...initialDesktopPreferences.brain, ...(ctx.desktopPreferences?.brain || {}) }
  };
  const visibleProjectWorkspaces = projectWorkspaces(workspaceCatalog ?? []);
  const authorizedModelOptions = [
    { id: "auto", model: "auto", label: "Auto", provider: modelConfig.provider || "" },
    ...(Array.isArray(modelConfig.availableModels) ? modelConfig.availableModels : [])
  ];
  const dictationAvailable = Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
  const accountProfileKey = "newbrain.accountProfile.v1";
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const [accountProfile, setAccountProfile] = useState(() => {
    try { return JSON.parse(localStorage.getItem(accountProfileKey) || "{}"); } catch { return {}; }
  });
  const [accountEdit, setAccountEdit] = useState<null | { type: "email" | "phone" | "password"; value: string }>(null);
  const [accountEditError, setAccountEditError] = useState("");
  const [accountCodeSending, setAccountCodeSending] = useState(false);
  const [localAppUpdateStatus, setLocalAppUpdateStatus] = useState(null);
  const [localAppUpdateBusy, setLocalAppUpdateBusy] = useState(false);
  const [appUpdateMessage, setAppUpdateMessage] = useState("");
  const appUpdateStatus = ctx.appUpdateStatus ?? localAppUpdateStatus;
  const appUpdateBusy = Boolean(ctx.appUpdateBusy || localAppUpdateBusy);
  const [mcpSettingsView, setMcpSettingsView] = useState<"list" | "new" | "edit">("list");
  const [mcpWorkingDirectory, setMcpWorkingDirectory] = useState("");
  const [mcpBearerTokenEnv, setMcpBearerTokenEnv] = useState("");
  const [mcpHeaders, setMcpHeaders] = useState<Array<{ key: string; value: string }>>([]);
  const [mcpHeaderEnv, setMcpHeaderEnv] = useState<Array<{ key: string; value: string }>>([]);
  const [settingsSavedMessage, setSettingsSavedMessage] = useState("");
  const [knowledgeSyncBusy, setKnowledgeSyncBusy] = useState(false);
  const [knowledgeSyncNotice, setKnowledgeSyncNotice] = useState("");
  const [recordingShortcut, setRecordingShortcut] = useState("");
  const [browserManagePanel, setBrowserManagePanel] = useState<"history" | "passwords" | "contacts" | null>(null);
  const [browserHistoryRows, setBrowserHistoryRows] = useState<Array<{ id: string; url: string; title: string; visitedAt: string }>>([]);
  const [browserCredentialRows, setBrowserCredentialRows] = useState<Array<{ id: string; origin: string; username: string; hasPassword: boolean; updatedAt: string }>>([]);
  const [browserContactRows, setBrowserContactRows] = useState<Array<{ id: string; name: string; email: string; phone: string; updatedAt: string }>>([]);
  const [browserCredentialDraft, setBrowserCredentialDraft] = useState({ origin: "", username: "", password: "" });
  const [browserContactDraft, setBrowserContactDraft] = useState({ name: "", email: "", phone: "" });
  const compareSemver = (left, right) => {
    const parts = (value) => String(value || "0")
      .replace(/^v/i, "")
      .split("-", 1)[0]
      .split(".")
      .map((part) => Number.parseInt(part, 10) || 0);
    const leftParts = parts(left);
    const rightParts = parts(right);
    for (let index = 0; index < 3; index += 1) {
      const difference = (leftParts[index] || 0) - (rightParts[index] || 0);
      if (difference !== 0) return difference;
    }
    return 0;
  };
  const refreshAppUpdateStatus = async () => {
    if (!api?.getAppUpdateStatus) return;
    try {
      const status = await api.getAppUpdateStatus();
      setLocalAppUpdateStatus(status);
      setAppUpdateMessage("");
    } catch (error) {
      setAppUpdateMessage(error instanceof Error ? error.message : String(error));
    }
  };
  const startDesktopAppUpdate = async () => {
    if (typeof ctx.startDesktopAppUpdate === "function") {
      await ctx.startDesktopAppUpdate();
      return;
    }
    if (!api?.startAppUpdate || appUpdateBusy) return;
    setLocalAppUpdateBusy(true);
    try {
      const result = await api.startAppUpdate();
      setAppUpdateMessage(result.detail || (result.ok ? "已打开安装程序" : "更新失败"));
      setChatStatus?.(result.detail || "");
      await refreshAppUpdateStatus();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setAppUpdateMessage(detail);
      setErrorMessage?.(detail);
    } finally {
      setLocalAppUpdateBusy(false);
    }
  };
  const verifyDesktopAppUpdate = async () => {
    if (!api?.verifyAppUpdate || appUpdateBusy) return;
    setLocalAppUpdateBusy(true);
    try {
      const result = await api.verifyAppUpdate({
        releaseId: appUpdateStatus?.releaseId,
        ok: true
      });
      setAppUpdateMessage(result.detail || "验证已提交");
      setChatStatus?.(result.detail || "验证已提交");
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setAppUpdateMessage(detail);
      setErrorMessage?.(detail);
    } finally {
      setLocalAppUpdateBusy(false);
    }
  };
  useEffect(() => {
    if (activeSettingsSection !== "account") return;
    void refreshAppUpdateStatus();
  }, [activeSettingsSection, api]);
  const updateDesktopPreferences = (updater: (current: any) => any) => {
    const next = updater(desktopPreferences);
    setDesktopPreferences(next);
    void saveDesktopPreferences(next);
  };
  const updateAppearancePreference = (patch: Record<string, unknown>) => {
    updateDesktopPreferences((current) => ({
      ...current,
      appearance: {
        ...current.appearance,
        ...patch
      }
    }));
  };
  const runSettingsSave = async (label: string, action?: () => void | Promise<void>) => {
    await action?.();
    setSettingsSavedMessage(`${label}已保存`);
    setChatStatus?.(`${label}已保存`);
    window.setTimeout(() => setSettingsSavedMessage(""), 1800);
  };
  const formatShortcutEvent = (event: KeyboardEvent) => {
    const parts = [];
    if (event.ctrlKey) parts.push("Ctrl");
    if (event.altKey) parts.push("Alt");
    if (event.shiftKey) parts.push("Shift");
    if (event.metaKey) parts.push("Meta");
    const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
    if (!["Control", "Alt", "Shift", "Meta"].includes(key)) parts.push(key);
    return parts.join("+");
  };
  const saveShortcut = (id: string, shortcut: string) => {
    const nextShortcuts = { ...(desktopPreferences.shortcuts || {}), [id]: shortcut };
    updateDesktopPreferences((current) => ({ ...current, shortcuts: nextShortcuts }));
    setSettingsSavedMessage("快捷键已保存");
    setChatStatus?.("快捷键已保存");
  };
  const renderShortcutRecorder = (
    id: string,
    value: string,
    placeholder: string,
    onSave: (shortcut: string) => void
  ) => (
    <button
      type="button"
      className={`shortcut-recorder${recordingShortcut === id ? " recording" : ""}`}
      title="双击后按下新的快捷键"
      onDoubleClick={(event) => {
        event.currentTarget.focus();
        setRecordingShortcut(id);
      }}
      onKeyDown={(event) => {
        if (recordingShortcut !== id) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.key === "Escape") {
          setRecordingShortcut("");
          return;
        }
        const nextShortcut = formatShortcutEvent(event.nativeEvent);
        if (!nextShortcut) return;
        onSave(nextShortcut);
        setRecordingShortcut("");
        setSettingsSavedMessage("快捷键已保存");
        setChatStatus?.("快捷键已保存");
      }}
    >
      {recordingShortcut === id ? "按下快捷键..." : (value || placeholder)}
    </button>
  );
  const [mcpEnvPassthrough, setMcpEnvPassthrough] = useState<string[]>([]);
  function readExtendedMcpFields(server: any) {
    const lines = String(server?.env || "").split("\n").filter(Boolean);
    setMcpWorkingDirectory(lines.find((line) => line.startsWith("NEWBRAIN_MCP_CWD="))?.slice(15) || "");
    setMcpBearerTokenEnv(lines.find((line) => line.startsWith("NEWBRAIN_MCP_BEARER_ENV="))?.slice(22) || "");
    setMcpEnvPassthrough(lines.filter((line) => line.startsWith("NEWBRAIN_MCP_ENV_PASS=" )).map((line) => line.slice(20)));
    setMcpHeaders(lines.filter((line) => line.startsWith("NEWBRAIN_MCP_HEADER=")).map((line) => { const value=line.slice(18); const index=value.indexOf(":"); return { key:index < 0 ? value : value.slice(0,index), value:index < 0 ? "" : value.slice(index+1) }; }));
    setMcpHeaderEnv(lines.filter((line) => line.startsWith("NEWBRAIN_MCP_HEADER_ENV=")).map((line) => { const value=line.slice(22); const index=value.indexOf(":"); return { key:index < 0 ? value : value.slice(0,index), value:index < 0 ? "" : value.slice(index+1) }; }));
  }

  function openMcpSettingsEditor(server?: any) {
    if (server) {
      loadMcpDraft(server);
      readExtendedMcpFields(server);
      setMcpSettingsView("edit");
    } else {
      resetMcpDraft();
      setMcpWorkingDirectory(""); setMcpBearerTokenEnv(""); setMcpHeaders([]); setMcpHeaderEnv([]); setMcpEnvPassthrough([]);
      setMcpSettingsView("new");
    }
  }

  function openFigmaDesktopMcpPreset() {
    const existing = mcpServers.find((server: any) => {
      const name = String(server.name || "").toLowerCase();
      const url = String(server.url || "");
      return name.includes("figma") || url.includes("127.0.0.1:3845") || url.includes("mcp.figma.com");
    });
    if (existing) {
      openMcpSettingsEditor(existing);
      setChatStatus?.("已打开现有 Figma MCP 配置。");
      return;
    }
    resetMcpDraft();
    setMcpWorkingDirectory(""); setMcpBearerTokenEnv(""); setMcpHeaders([]); setMcpHeaderEnv([]); setMcpEnvPassthrough([]);
    setMcpDraft((current: any) => ({
      ...current,
      name: "Figma Desktop",
      transport: "sse",
      command: "",
      args: "",
      url: "http://127.0.0.1:3845/mcp",
      enabled: true
    }));
    setMcpSettingsView("new");
    setChatStatus?.("已预填 Figma 桌面 MCP：请先在 Figma Dev Mode 启用桌面 MCP，再保存并启动。");
  }

  async function saveMcpSettingsEditor() {
    const baseEnv = String(mcpDraft.env || "").split("\n").filter((line) => line && !line.startsWith("NEWBRAIN_MCP_"));
    const extended = [
      mcpWorkingDirectory && `NEWBRAIN_MCP_CWD=${mcpWorkingDirectory}`,
      mcpBearerTokenEnv && `NEWBRAIN_MCP_BEARER_ENV=${mcpBearerTokenEnv}`,
      ...mcpEnvPassthrough.filter(Boolean).map((value) => `NEWBRAIN_MCP_ENV_PASS=${value}`),
      ...mcpHeaders.filter((row) => row.key).map((row) => `NEWBRAIN_MCP_HEADER=${row.key}:${row.value}`),
      ...mcpHeaderEnv.filter((row) => row.key).map((row) => `NEWBRAIN_MCP_HEADER_ENV=${row.key}:${row.value}`)
    ].filter(Boolean);
    await handleSaveMcpServer({ ...mcpDraft, env: [...baseEnv, ...extended].join("\n") });
    setMcpSettingsView("list");
  }

  const shownEmail = displayUserEmail;
  const shownPhone = accountProfile.phone || "已绑定账号";
  const shownAvatar = accountProfile.avatar || "";

  function saveAvatarFile(file?: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setErrorMessage("请选择图片文件。");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setErrorMessage("头像文件不能超过 2 MB。");
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => setErrorMessage("头像读取失败，请换一张图片再试。");
    reader.onload = () => saveAccountProfile({ avatar: String(reader.result || "") });
    reader.readAsDataURL(file);
  }

  function saveAccountProfile(next: Record<string, string>) {
    const localProfile = next.avatar ? { avatar: next.avatar } : {};
    const merged = { ...accountProfile, ...localProfile };
    localStorage.setItem(accountProfileKey, JSON.stringify(merged));
    setAccountProfile(merged);
    onAccountProfileChange?.(merged);
    setChatStatus("头像已保存到 NewBrain 本地配置。");
  }

function PrototypeBillingSettingsPage() {
    const billingCacheKey = "newbrain.billingSnapshot.v1";
    const [billing, setBilling] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState("");
    useEffect(() => {
      try {
        const saved = JSON.parse(localStorage.getItem(billingCacheKey) || "null");
        if (saved && typeof saved === "object") setBilling(saved);
      } catch {
        // Ignore invalid cache.
      }
    }, []);

    const loadBilling = async () => {
      setLoading(true);
      setLoadError("");
      try {
        const data = await api.getBillingSubscription();
        const subscriptions = Array.isArray(data?.subscriptions) ? data.subscriptions : [];
        if (data && (subscriptions.length > 0 || Array.isArray(data.billing_history))) {
          setBilling(data);
          localStorage.setItem(billingCacheKey, JSON.stringify(data));
        } else {
          setBilling((current: any) => current || data || { summary: {}, subscriptions: [] });
        }
      } catch (error) {
        setLoadError(formatFeatureAvailabilityError(error));
      } finally {
        setLoading(false);
      }
    };

    useEffect(() => {
      void loadBilling();
    }, []);

    const subscriptions = Array.isArray(billing?.subscriptions) ? billing.subscriptions : [];
    const activeSubscription =
      subscriptions.find((item: any) => ["active", "valid"].includes(String(item.status || "").toLowerCase())) ||
      subscriptions[0] ||
      {};
    const numberValue = (value: unknown, fallback = 0) => {
      const next = Number(value);
      return Number.isFinite(next) ? next : fallback;
    };
    const percent = (used: unknown, quota: unknown, fallback: number) => {
      const usedValue = numberValue(used);
      const quotaValue = numberValue(quota);
      return quotaValue > 0 ? Math.min(100, Math.max(0, (usedValue / quotaValue) * 100)) : fallback;
    };
    const dateOnly = (value: unknown, fallback: string) => {
      if (!value) return fallback;
      const date = new Date(String(value));
      return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : String(value);
    };
    const formatMoney = (value: unknown, currencyValue: unknown = "CNY") => {
      const currencyCandidate = String(currencyValue || "CNY").toUpperCase();
      const currency = /^[A-Z]{3}$/.test(currencyCandidate) ? currencyCandidate : "CNY";
      const amount = numberValue(value);
      return new Intl.NumberFormat("zh-CN", {
        style: "currency",
        currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }).format(amount);
    };
    const planName = activeSubscription.plan_name || activeSubscription.plan_code || "暂无有效订阅";
    const renewalDate = dateOnly(activeSubscription.expires_at || activeSubscription.expires_at_display, "--");
    const planPrice = formatMoney(
      activeSubscription.price ?? activeSubscription.amount ?? activeSubscription.monthly_price,
      activeSubscription.currency
    );
    const dailyUsed = activeSubscription.daily_used ?? activeSubscription.daily_cost_used ?? 0;
    const dailyQuota = activeSubscription.daily_quota ?? 0;
    const monthlyUsed = activeSubscription.monthly_used ?? activeSubscription.monthly_cost_used ?? 0;
    const monthlyQuota = activeSubscription.monthly_quota ?? 0;
    const dailyAmountLabel = `${formatMoney(dailyUsed, activeSubscription.currency)} / ${formatMoney(dailyQuota, activeSubscription.currency)}`;
    const monthlyAmountLabel = `${formatMoney(monthlyUsed, activeSubscription.currency)} / ${formatMoney(monthlyQuota, activeSubscription.currency)}`;
    const bills = (Array.isArray(billing?.billing_history) ? billing.billing_history : []).map((item: any, index: number) => ({
      id: String(item.id || item.invoice_id || item.order_id || `bill-${index}`),
      date: dateOnly(item.paid_at || item.payment_date || item.created_at || item.date, "--"),
      amount: formatMoney(
        item.amount ?? item.total_amount ?? item.paid_amount ?? item.price,
        item.currency || item.currency_code
      ),
      status: String(item.status || item.payment_status || "paid"),
      downloadUrl: String(item.invoice_url || item.download_url || item.receipt_url || "")
    }));
    const statusText = (status: string) => {
      const normalized = status.toLowerCase();
      if (["paid", "success", "succeeded", "completed"].includes(normalized)) return "已支付";
      if (["pending", "processing"].includes(normalized)) return "处理中";
      if (["refunded", "refund"].includes(normalized)) return "已退款";
      if (["failed", "canceled", "cancelled"].includes(normalized)) return "失败";
      return status || "未知";
    };

    return (
      <div className="billing-page billing-prototype-page">
        <div className="settings-page-head">
          <div>
            <h3>订阅与计费</h3>
            <p>管理你的订阅计划和账单</p>
          </div>
        </div>

        {loadError ? (
          <div className="billing-state-message billing-state-error">
            <strong>订阅信息加载失败</strong>
            <span>{loadError}</span>
            <button type="button" onClick={() => void loadBilling()}>重试</button>
          </div>
        ) : null}

        <section className="billing-prototype-card billing-current-plan">
          <div>
            <p>当前套餐</p>
            <strong>{planName}</strong>
            <span>{planPrice}/月 · 下次续费日期： {renewalDate}</span>
          </div>
          <button type="button" disabled title={FEATURE_UNDER_DEVELOPMENT_MESSAGE}>管理订阅（开发中）</button>
        </section>

        <section className="billing-prototype-card billing-month-usage">
          <h4>金额额度</h4>
          <div className="billing-prototype-usage-row">
            <div><span>每日金额额度</span><strong>{dailyAmountLabel}</strong></div>
            <i><b className="token" style={{ width: `${percent(dailyUsed, dailyQuota, 0)}%` }} /></i>
          </div>
          <div className="billing-prototype-usage-row">
            <div><span>月度金额额度</span><strong>{monthlyAmountLabel}</strong></div>
            <i><b className="task" style={{ width: `${percent(monthlyUsed, monthlyQuota, 0)}%` }} /></i>
          </div>
        </section>

        <section className="billing-prototype-history">
          <h4>账单历史</h4>
          <div>
            {bills.length === 0 ? <div className="invoice-empty">暂无历史账单</div> : bills.map((bill: any) => (
              <article key={bill.id}>
                <span><strong>{bill.date}</strong><em>{statusText(bill.status)}</em></span>
                <span>
                  <strong>{bill.amount}</strong>
                  {bill.downloadUrl ? (
                    <button type="button" onClick={() => window.open(bill.downloadUrl, "_blank", "noopener")}>查看收据</button>
                  ) : null}
                </span>
              </article>
            ))}
          </div>
        </section>

        {loading ? <div className="billing-prototype-sync">正在同步线上订阅信息...</div> : null}
      </div>
    );
  }

function renderSettingsWorkspace() {
    return (
      <div className="settings-workspace prototype-settings">
        <div className="settings-workspace-head">
          <div>
            <h2>设置</h2>
            <p>管理你的账号信息与工作台配置。</p>
          </div>
        </div>

        <div className="settings-workspace-body">
          <aside className="settings-workspace-nav prototype">
            <div className="settings-nav-block settings-return-block">
              <button
                type="button"
                onClick={() => {
                  setActiveFeature("new-chat");
                  setPreviewMode("workspace");
                }}
              >
                <span className="settings-nav-icon" aria-hidden="true">←</span>
                <strong>返回应用</strong>
              </button>
            </div>

            <div className="settings-nav-block">
              <span>账户</span>
              <button
                type="button"
                className={activeSettingsSection === "account" ? "active" : ""}
                onClick={() => setActiveSettingsSection("account")}
              >
                <SettingsNavIcon name="user" />
                <strong>账号</strong>
              </button>
              <button
                type="button"
                className={activeSettingsSection === "billing" ? "active" : ""}
                onClick={() => setActiveSettingsSection("billing")}
              >
                <SettingsNavIcon name="card" />
                <strong>钱包</strong>
              </button>
            </div>

            <div className="settings-nav-block">
              <span>设置</span>
              <button
                type="button"
                className={activeSettingsSection === "model" ? "active" : ""}
                onClick={() => setActiveSettingsSection("model")}
              >
                <SettingsNavIcon name="gear" />
                <strong>常规</strong>
              </button>
              <button
                type="button"
                className={activeSettingsSection === "appearance" ? "active" : ""}
                onClick={() => setActiveSettingsSection("appearance")}
              >
                <SettingsNavIcon name="sun" />
                <strong>外观</strong>
              </button>
              <button
                type="button"
                className={activeSettingsSection === "configuration" ? "active" : ""}
                onClick={() => setActiveSettingsSection("configuration")}
              >
                <SettingsNavIcon name="dial" />
                <strong>配置</strong>
              </button>
              <button
                type="button"
                className={activeSettingsSection === "personalization" ? "active" : ""}
                onClick={() => setActiveSettingsSection("personalization")}
              >
                <SettingsNavIcon name="clock" />
                <strong>个性化</strong>
              </button>
              <button
                type="button"
                className={activeSettingsSection === "mcp" ? "active" : ""}
                onClick={() => setActiveSettingsSection("mcp")}
              >
                <SettingsNavIcon name="link" />
                <strong>MCP 服务器</strong>
              </button>
              <button
                type="button"
                className={activeSettingsSection === "hooks" ? "active" : ""}
                onClick={() => setActiveSettingsSection("hooks")}
              >
                <SettingsNavIcon name="anchor" />
                <strong>钩子</strong>
              </button>
              <button
                type="button"
                className={activeSettingsSection === "git" ? "active" : ""}
                onClick={() => setActiveSettingsSection("git")}
              >
                <SettingsNavIcon name="git" />
                <strong>Git</strong>
              </button>
              <button
                type="button"
                className={activeSettingsSection === "environment" ? "active" : ""}
                onClick={() => setActiveSettingsSection("environment")}
              >
                <SettingsNavIcon name="screen" />
                <strong>环境</strong>
              </button>
              <button
                type="button"
                className={activeSettingsSection === "worktree" ? "active" : ""}
                onClick={() => setActiveSettingsSection("worktree")}
              >
                <SettingsNavIcon name="worktree" />
                <strong>工作树</strong>
              </button>
              <button
                type="button"
                className={activeSettingsSection === "browser" ? "active" : ""}
                onClick={() => setActiveSettingsSection("browser")}
              >
                <SettingsNavIcon name="browser" />
                <strong>浏览器</strong>
              </button>
              <button
                type="button"
                className={activeSettingsSection === "computer" ? "active" : ""}
                onClick={() => {
                  setActiveSettingsSection("computer");
                  if (api) {
                    void api.getSystemTools().then(setSystemTools).catch(() => setSystemTools([]));
                  }
                }}
              >
                <SettingsNavIcon name="spark" />
                <strong>电脑操控</strong>
              </button>
              <button
                type="button"
                className={activeSettingsSection === "archived" ? "active" : ""}
                onClick={() => setActiveSettingsSection("archived")}
              >
                <SettingsNavIcon name="archive" />
                <strong>已归档对话</strong>
              </button>
              <button
                type="button"
                className={activeSettingsSection === "shortcuts" ? "active" : ""}
                onClick={() => setActiveSettingsSection("shortcuts")}
              >
                <SettingsNavIcon name="keyboard" />
                <strong>键盘快捷键</strong>
              </button>
            </div>
          </aside>

          <section className="settings-workspace-content prototype">
            {settingsSavedMessage ? <div className="settings-save-toast">{settingsSavedMessage}</div> : null}
            {activeSettingsSection === "billing" ? <WalletSettingsPage api={api} displayUserEmail={displayUserEmail} /> : null}
            {activeSettingsSection === "account" ? (
              <>
                <div className="settings-page-head">
                  <div>
                    <h3>账号</h3>
                    <p>管理你的账号信息</p>
                  </div>
                </div>

                <section className="account-profile-card">
                  <div className="account-profile-avatar">
                    {shownAvatar ? <img src={shownAvatar} alt="账户头像" /> : displayUserAvatar}
                  </div>
                  <div className="account-profile-info">
                    <strong>{displayUserName}</strong>
                    <span>{shownEmail}</span>
                    <em>{displayUserPlan}</em>
                  </div>
                  <input
                    ref={avatarInputRef}
                    id="account-avatar-input"
                    className="account-avatar-input"
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={(event) => {
                      saveAvatarFile(event.target.files?.[0]);
                      event.currentTarget.value = "";
                    }}
                  />
                  <button type="button" onClick={() => avatarInputRef.current?.click()}>编辑头像</button>
                </section>

                <div className="account-settings-list">
                  <div className="account-settings-row">
                    <label>用户名</label>
                    <input value={isAuthenticated ? displayUserName : ""} readOnly />
                  </div>
                  <div className="account-settings-row">
                    <label>邮箱</label>
                    <div className="account-settings-value">
                      <span>{isAuthenticated ? shownEmail : "未设置"}</span>
                      <button type="button" onClick={() => {
                        setAccountEditError("");
                        setAccountEdit({ type: "email", value: shownEmail, code: "" });
                      }}>修改</button>
                    </div>
                  </div>
                  <div className="account-settings-row">
                    <label>手机号</label>
                    <div className="account-settings-value">
                      <span>{isAuthenticated ? shownPhone : "未设置"}</span>
                      <button type="button" disabled title="手机号修改尚未接入认证服务">暂不支持</button>
                    </div>
                  </div>
                  <div className="account-settings-row">
                    <label>密码</label>
                    <div className="account-settings-value">
                      <span>••••••••</span>
                      <button type="button" onClick={() => {
                        setAccountEditError("");
                        setAccountEdit({ type: "password", value: "", currentPassword: "", newPassword: "", confirmPassword: "" });
                      }}>修改密码</button>
                    </div>
                  </div>
                  <div className="account-settings-row">
                    <label>软件版本</label>
                    <div className="account-settings-value">
                      <span>
                        {appUpdateStatus?.currentVersion || "—"}
                        {appUpdateStatus?.available && appUpdateStatus.latestVersion
                          ? ` → ${appUpdateStatus.latestVersion}`
                          : ""}
                      </span>
                      {appUpdateStatus?.available ? (
                        <button
                          type="button"
                          className="primary"
                          disabled={appUpdateBusy}
                          onClick={() => void startDesktopAppUpdate()}
                        >
                          {appUpdateBusy ? "正在更新…" : "更新"}
                        </button>
                      ) : null}
                    </div>
                  </div>
                  {appUpdateStatus ? (
                    <p className="account-password-notice">
                      {appUpdateMessage || appUpdateStatus.detail}
                      {appUpdateStatus.channel ? `（${appUpdateStatus.channel}）` : ""}
                      {!String(appUpdateMessage || appUpdateStatus.detail || "").includes("不会删除")
                        ? " 更新仅替换程序文件，不会删除聊天记录、项目与本地历史。"
                        : ""}
                    </p>
                  ) : null}
                  {appUpdateStatus?.releaseId
                    && !appUpdateStatus.available
                    && compareSemver(appUpdateStatus.currentVersion, appUpdateStatus.latestVersion || "") >= 0 ? (
                    <div className="account-settings-row">
                      <label>更新验证</label>
                      <div className="account-settings-value">
                        <span>升级后使用是否正常</span>
                        <button
                          type="button"
                          disabled={appUpdateBusy}
                          onClick={() => void verifyDesktopAppUpdate()}
                        >
                          更新后使用正常
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>

                {accountEdit ? (
                  <div className="account-edit-overlay" role="presentation" onMouseDown={() => {
                    setAccountEdit(null);
                    setAccountEditError("");
                  }}>
                    <form
                      className="account-edit-dialog"
                      role="dialog"
                      aria-modal="true"
                      onMouseDown={(event) => event.stopPropagation()}
                      onSubmit={async (event) => {
                        event.preventDefault();
                        if (accountEdit.type === "password") {
                          const currentPassword = String(accountEdit.currentPassword || "").trim();
                          const newPassword = String(accountEdit.newPassword || "").trim();
                          const confirmPassword = String(accountEdit.confirmPassword || "").trim();
                          setAccountEditError("");
                          if (!currentPassword || !newPassword || !confirmPassword) {
                            setAccountEditError("请输入当前密码、新密码和确认密码。");
                            return;
                          }
                          if (newPassword.length < 8) {
                            setAccountEditError("新密码至少需要 8 位。");
                            return;
                          }
                          if (newPassword !== confirmPassword) {
                            setAccountEditError("两次输入的新密码不一致。");
                            return;
                          }
                          try {
                            if (!api?.changeAuthPassword) throw new Error("当前版本不支持修改密码。");
                            const result = await api.changeAuthPassword({ currentPassword, newPassword });
                            setChatStatus(result.detail || "密码已修改。");
                            setAccountEdit(null);
                            setAccountEditError("");
                          } catch (error) {
                            setAccountEditError(error instanceof Error ? error.message : String(error));
                          }
                          return;
                        }
                        const value = accountEdit.value.trim();
                        if (accountEdit.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
                          setAccountEditError("请输入有效邮箱地址。");
                          return;
                        }
                        if (accountEdit.type === "email") {
                          const code = String(accountEdit.code || "").trim();
                          setAccountEditError("");
                          if (!code) {
                            setAccountEditError("请输入邮箱验证码。");
                            return;
                          }
                          try {
                            if (!api?.changeAuthEmail) throw new Error("当前版本不支持修改邮箱。");
                            const result = await api.changeAuthEmail({ email: value, code });
                            if (!api?.getAuthStatus) throw new Error("认证状态刷新接口不可用。");
                            setAuthStatus?.(await api.getAuthStatus());
                            setChatStatus(result.detail || "邮箱已修改。");
                            setAccountEdit(null);
                            setAccountEditError("");
                          } catch (error) {
                            setAccountEditError(error instanceof Error ? error.message : String(error));
                          }
                          return;
                        }
                        if (accountEdit.type === "phone" && !/^\+?[0-9\s-]{6,20}$/.test(value)) {
                          setErrorMessage("Please enter a valid phone number.");
                          return;
                        }
                        saveAccountProfile({ [accountEdit.type]: value });
                        setAccountEdit(null);
                      }}
                    >
                      <div className="account-edit-dialog-head">
                        <div>
                          <strong>{accountEdit.type === "email" ? "修改邮箱" : accountEdit.type === "phone" ? "修改手机号" : "修改密码"}</strong>
                          <span>{accountEdit.type === "password" ? "密码由当前登录认证服务管理" : accountEdit.type === "email" ? "需要通过新邮箱验证码验证后才能修改" : "修改后将保存到本机 NewBrain 配置"}</span>
                        </div>
                        <button type="button" aria-label="关闭" onClick={() => {
                          setAccountEdit(null);
                          setAccountEditError("");
                        }}>×</button>
                      </div>
                      {accountEdit.type === "password" ? (
                        <div className="account-password-fields">
                          <input
                            autoFocus
                            type="password"
                            placeholder="当前密码"
                            value={accountEdit.currentPassword || ""}
                            onChange={(event) => {
                              setAccountEditError("");
                              setAccountEdit({ ...accountEdit, currentPassword: event.target.value });
                            }}
                          />
                          <input
                            type="password"
                            placeholder="新密码（至少 8 位）"
                            value={accountEdit.newPassword || ""}
                            onChange={(event) => {
                              setAccountEditError("");
                              setAccountEdit({ ...accountEdit, newPassword: event.target.value });
                            }}
                          />
                          <input
                            type="password"
                            placeholder="确认新密码"
                            value={accountEdit.confirmPassword || ""}
                            onChange={(event) => {
                              setAccountEditError("");
                              setAccountEdit({ ...accountEdit, confirmPassword: event.target.value });
                            }}
                          />
                          {accountEditError ? <p className="account-edit-error">{accountEditError}</p> : null}
                          <p className="account-password-notice">密码会提交到当前登录认证服务，NewBrain 不会在本机保存密码。</p>
                        </div>
                      ) : accountEdit.type === "email" ? (
                        <div className="account-password-fields">
                          <input
                            autoFocus
                            type="email"
                            placeholder="新邮箱"
                            value={accountEdit.value}
                            onChange={(event) => {
                              setAccountEditError("");
                              setAccountEdit({ ...accountEdit, value: event.target.value });
                            }}
                          />
                          <div className="account-code-row">
                            <input
                              type="text"
                              inputMode="numeric"
                              placeholder="邮箱验证码"
                              value={accountEdit.code || ""}
                              onChange={(event) => {
                                setAccountEditError("");
                                setAccountEdit({ ...accountEdit, code: event.target.value });
                              }}
                            />
                            <button
                              type="button"
                              disabled={accountCodeSending}
                              onClick={async () => {
                                const email = String(accountEdit.value || "").trim();
                                setAccountEditError("");
                                if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                                  setAccountEditError("请输入有效邮箱地址。");
                                  return;
                                }
                                try {
                                  setAccountCodeSending(true);
                                  await api.sendLoginCode({ email });
                                  setChatStatus("验证码已发送，请检查邮箱。");
                                } catch (error) {
                                  setAccountEditError(error instanceof Error ? error.message : String(error));
                                } finally {
                                  setAccountCodeSending(false);
                                }
                              }}
                            >
                              {accountCodeSending ? "发送中" : "获取验证码"}
                            </button>
                          </div>
                          {accountEditError ? <p className="account-edit-error">{accountEditError}</p> : null}
                          <p className="account-password-notice">修改邮箱需要先通过新邮箱验证码验证。</p>
                        </div>
                      ) : (
                        <input
                          autoFocus
                          type="tel"
                          value={accountEdit.value}
                          onChange={(event) => setAccountEdit({ ...accountEdit, value: event.target.value })}
                        />
                      )}
                      <div className="account-edit-actions">
                        <button type="button" onClick={() => {
                          setAccountEdit(null);
                          setAccountEditError("");
                        }}>取消</button>
                        <button className="primary" type="submit">{accountEdit.type === "password" ? "修改密码" : "保存"}</button>
                      </div>
                    </form>
                  </div>
                ) : null}

                <section className="settings-card">
                  <div className="settings-card-head">
                    <div>
                      <strong>私有模型凭据</strong>
                      <p>公司模型始终通过登录会话访问，不向桌面端下发公司密钥。这里只配置你自行购买的私有模型凭据。</p>
                    </div>
                  </div>
                  <label className="settings-field">
                    <span>开发者 API 密钥</span>
                    <input
                      value={modelConfig.apiKey}
                      onChange={(event) => setModelConfig((current) => ({ ...current, apiKey: event.target.value }))}
                      placeholder={apiKeyConfigured ? "已安全保存；输入新密钥可替换" : "sk-..."}
                      type="password"
                      autoComplete="new-password"
                    />
                  </label>
                  <p className="settings-field-hint">密钥只写入操作系统保护的本地凭据保险库。保存后界面、配置文件和日志都不能回读明文。</p>
                  <div className="inline-actions">
                    <button type="button" onClick={() => void runSettingsSave("凭据", saveModelConfig)}>
                      保存凭据
                    </button>
                  </div>
                </section>

                <button className="settings-logout" type="button" onClick={() => void handleLogout()}>
                  退出登录
                </button>
              </>
            ) : activeSettingsSection === "model" ? (
              <div className="codex-general-page">
                <div className="codex-general-title">
                  <h3>常规</h3>
                </div>

                <section className="codex-settings-section">
                  <h4>工作模式</h4>
                  <p>选择 newbrain 显示多少技术细节</p>
                  <div className="codex-mode-grid">
                    <button
                      type="button"
                      className={`codex-mode-card${(desktopPreferences.personalization.workMode || "coding") === "coding" ? " active" : ""}`}
                      aria-pressed={(desktopPreferences.personalization.workMode || "coding") === "coding"}
                      onClick={() => updateDesktopPreferences((current) => ({
                        ...current,
                        personalization: { ...current.personalization, workMode: "coding" }
                      }))}
                    >
                      <span className="codex-mode-icon">▣</span>
                      <span>
                        <strong>适用于编程</strong>
                        <em>更具技术性的回复和控制</em>
                      </span>
                      <i />
                    </button>
                    <button
                      type="button"
                      className={`codex-mode-card${desktopPreferences.personalization.workMode === "everyday" ? " active" : ""}`}
                      aria-pressed={desktopPreferences.personalization.workMode === "everyday"}
                      onClick={() => updateDesktopPreferences((current) => ({
                        ...current,
                        personalization: { ...current.personalization, workMode: "everyday" }
                      }))}
                    >
                      <span className="codex-mode-icon">◌</span>
                      <span>
                        <strong>适用于日常工作</strong>
                        <em>同样强大，技术细节更少</em>
                      </span>
                      <i />
                    </button>
                  </div>
                </section>

                <section className="codex-settings-section">
                  <h4>权限</h4>
                  <div className="codex-setting-list">
                    <button type="button" className="codex-setting-row" aria-pressed={!desktopPreferences.permissions?.fullAccess} onClick={() => {
                      setComposerPermission?.("agent");
                      updateDesktopPreferences((current) => ({
                        ...current,
                        configuration: { ...current.configuration, requireApprovalForShell: false },
                        permissions: { ...(current.permissions || {}), fullAccess: false }
                      }));
                    }}>
                      <span><strong>替我审批</strong><em>newbrain 可以读取和编辑工作区文件，并自动审核额外访问权限请求。</em></span>
                      <SettingsSwitch enabled={!desktopPreferences.permissions?.fullAccess} />
                    </button>
                    <button type="button" className="codex-setting-row" aria-pressed={Boolean(desktopPreferences.permissions?.fullAccess)} onClick={() => {
                      const fullAccess = !desktopPreferences.permissions?.fullAccess;
                      setComposerPermission?.(fullAccess ? "full" : "agent");
                      updateDesktopPreferences((current) => ({
                        ...current,
                        configuration: { ...current.configuration, requireApprovalForShell: false },
                        permissions: { ...(current.permissions || { fullAccess: false }), fullAccess }
                      }));
                    }}>
                      <span><strong>完全访问权限</strong><em>当 newbrain 以完全访问权限运行时，无需你批准，即可编辑你的电脑上的任何文件并运行联网命令。</em></span>
                      <SettingsSwitch enabled={Boolean(desktopPreferences.permissions?.fullAccess)} />
                    </button>
                  </div>
                </section>

                <section className="codex-settings-section">
                  <h4>常规</h4>
                  <div className="codex-setting-list">
                    <button type="button" className="codex-setting-row" onClick={() => updateDesktopPreferences((current) => ({ ...current, launchAtLogin: current.launchAtLogin === false }))}>
                      <span><strong>开机自启动</strong><em>登录系统后自动打开 newbrain</em></span>
                      <SettingsSwitch enabled={desktopPreferences.launchAtLogin !== false} />
                    </button>
                    <div className="codex-setting-row">
                      <span><strong>默认文件打开目标</strong><em>默认打开文件和文件夹的位置</em></span>
                      <select
                        className="codex-pill-select"
                        value={desktopPreferences.environment.defaultOpenTarget || "visual-studio"}
                        onChange={(event) => {
                          const next = {
                            ...desktopPreferences,
                            environment: {
                              ...desktopPreferences.environment,
                              defaultOpenTarget: event.target.value as "visual-studio" | "system" | "explorer"
                            }
                          };
                          updateDesktopPreferences(() => next);
                        }}
                      >
                        <option value="visual-studio">Visual Studio</option>
                        <option value="system">系统默认</option>
                        <option value="explorer">文件资源管理器</option>
                      </select>
                    </div>
                    <div className="codex-setting-row">
                      <span><strong>集成终端 Shell</strong><em>选择要在集成终端中打开的 Shell。</em></span>
                      <select
                        className="codex-pill-select"
                        value={desktopPreferences.environment.terminalShell || "powershell.exe"}
                        onChange={(event) => {
                          const next = {
                            ...desktopPreferences,
                            environment: {
                              ...desktopPreferences.environment,
                              terminalShell: event.target.value
                            }
                          };
                          updateDesktopPreferences(() => next);
                        }}
                      >
                        <option value="powershell.exe">PowerShell</option>
                        <option value="pwsh.exe">PowerShell 7</option>
                        <option value="cmd.exe">Command Prompt</option>
                        <option value="bash.exe">Git Bash</option>
                      </select>
                    </div>
                    <div className="codex-setting-row">
                      <span><strong>语言</strong><em>应用 UI 语言</em></span>
                      <select
                        className="codex-pill-select"
                        value={desktopPreferences.editor?.language || "auto"}
                        onChange={(event) => {
                          const next = {
                            ...desktopPreferences,
                            editor: {
                              ...(desktopPreferences.editor || { language: "auto", sendShortcut: "enter" }),
                              language: event.target.value as "auto" | "zh-CN" | "en-US"
                            }
                          };
                          updateDesktopPreferences(() => next);
                        }}
                      >
                        <option value="auto">自动检测</option>
                        <option value="zh-CN">简体中文</option>
                        <option value="en-US">English</option>
                      </select>
                    </div>
                    <button type="button" className="codex-setting-row" onClick={() => updateDesktopPreferences((current) => ({ ...current, personalization: { ...current.personalization, proactiveUpdates: !current.personalization.proactiveUpdates } }))}>
                      <span><strong>建议提示</strong><em>搜索项目文件和已连接应用，建议下一步操作</em></span>
                      <SettingsSwitch enabled={desktopPreferences.personalization.proactiveUpdates} />
                    </button>
                    <button type="button" className="codex-setting-row" onClick={() => updateDesktopPreferences((current) => ({ ...current, personalization: { ...current.personalization, autoSkillEnabled: !current.personalization.autoSkillEnabled } }))}>
                      <span><strong>Skill 自动唤醒</strong><em>关闭时仅使用「选择技能」中明确选中的 Skill；开启后允许按关键词与启发式自动启用专业 Skill</em></span>
                      <SettingsSwitch enabled={Boolean(desktopPreferences.personalization.autoSkillEnabled)} />
                    </button>
                    <button type="button" className="codex-setting-row" onClick={() => updateDesktopPreferences((current) => ({ ...current, personalization: { ...current.personalization, reviewFindingsFirst: !current.personalization.reviewFindingsFirst } }))}>
                      <span><strong>{"\u4ee3\u7801\u5ba1\u67e5\u4f18\u5148\u5217\u98ce\u9669"}</strong><em>{"\u5ba1\u67e5\u4ee3\u7801\u65f6\u5148\u5c55\u793a\u7f3a\u9677\u3001\u98ce\u9669\u548c\u9700\u8981\u4fee\u590d\u7684\u95ee\u9898"}</em></span>
                      <SettingsSwitch enabled={desktopPreferences.personalization.reviewFindingsFirst} />
                    </button>
                  </div>
                </section>

                <section className="codex-settings-section">
                  <h4>编辑器</h4>
                  <div className="codex-setting-list">
                    <div className="codex-setting-row">
                      <span><strong>Send shortcut</strong><em>Choose when Enter sends a prompt or inserts a new line</em></span>
                      <select
                        className="codex-pill-select"
                        value={desktopPreferences.editor?.sendShortcut || "enter"}
                        onChange={(event) => {
                          const next = {
                            ...desktopPreferences,
                            editor: {
                              ...(desktopPreferences.editor || { language: "auto", sendShortcut: "enter" }),
                              sendShortcut: event.target.value as "enter" | "mod-enter"
                            }
                          };
                          updateDesktopPreferences(() => next);
                        }}
                      >
                        <option value="enter">Enter</option>
                        <option value="mod-enter">Ctrl / ⌘ + Enter</option>
                      </select>
                    </div>
                    <div className="codex-setting-row">
                      <span><strong>跟进行为</strong><em>在 newbrain 运行时将后续操作加入队列，或引导当前运行。</em></span>
                      <div className="codex-segment">
                        <button
                          type="button"
                          className={(desktopPreferences.editor?.followBehavior || "queue") === "queue" ? "active" : ""}
                          aria-pressed={(desktopPreferences.editor?.followBehavior || "queue") === "queue"}
                          onClick={() => updateDesktopPreferences((current) => ({
                            ...current,
                            editor: { ...(current.editor || { language: "auto", sendShortcut: "enter" }), followBehavior: "queue" }
                          }))}
                        >
                          排队
                        </button>
                        <button
                          type="button"
                          className={desktopPreferences.editor?.followBehavior === "guide" ? "active" : ""}
                          aria-pressed={desktopPreferences.editor?.followBehavior === "guide"}
                          onClick={() => updateDesktopPreferences((current) => ({
                            ...current,
                            editor: { ...(current.editor || { language: "auto", sendShortcut: "enter" }), followBehavior: "guide" }
                          }))}
                        >
                          引导
                        </button>
                      </div>
                    </div>
                  </div>
                </section>

                <section className="codex-settings-section">
                  <h4>弹出窗口</h4>
                  <div className="codex-setting-list">
                    <div className="codex-setting-row">
                      <span><strong>弹出窗口快捷键</strong><em>为弹出窗口设置全局快捷键。留空则保持关闭。</em></span>
                      <div className="codex-inline-actions">
                        {renderShortcutRecorder(
                          "popup-shortcut",
                          desktopPreferences.popup?.shortcut || "",
                          "禁用",
                          (shortcut) => {
                            updateDesktopPreferences((current) => ({
                              ...current,
                              popup: { ...(current.popup || { defaultProjectlessChat: false }), shortcut }
                            }));
                          }
                        )}
                        <button type="button" className="ghost" onClick={() => updateDesktopPreferences((current) => ({
                          ...current,
                          popup: { ...(current.popup || { defaultProjectlessChat: false }), shortcut: "Alt+Space" }
                        }))}>Alt+Space</button>
                        <button type="button" className="ghost" onClick={() => updateDesktopPreferences((current) => ({
                          ...current,
                          popup: { ...(current.popup || { defaultProjectlessChat: false }), shortcut: "" }
                        }))}>清除</button>
                      </div>
                    </div>
                    <button type="button" className="codex-setting-row" onClick={() => {
                      const defaultProjectlessChat = !desktopPreferences.popup?.defaultProjectlessChat;
                      updateDesktopPreferences((current) => ({
                        ...current,
                        popup: { ...(current.popup || { shortcut: "" }), defaultProjectlessChat }
                      }));
                      setSettingsSavedMessage(defaultProjectlessChat ? "已默认使用无项目聊天" : "已关闭无项目聊天默认值");
                      setChatStatus?.(defaultProjectlessChat ? "已默认使用无项目聊天" : "已关闭无项目聊天默认值");
                      if (isComposingNewThread && newThreadScope === "chat") {
                        setChatUsesProject?.(!defaultProjectlessChat);
                      }
                    }}>
                      <span><strong>默认使用无项目聊天</strong><em>无需项目即可开始新聊天</em></span>
                      <SettingsSwitch enabled={Boolean(desktopPreferences.popup?.defaultProjectlessChat)} />
                    </button>
                  </div>
                </section>

                {dictationAvailable ? <section className="codex-settings-section">
                  <h4>听写（实验性）</h4>
                  <div className="codex-setting-list">
                    <div className="codex-setting-row">
                      <span><strong>麦克风</strong><em>由当前操作系统和 Chromium 语音服务提供</em></span>
                      <select
                        className="codex-pill-select"
                        value={desktopPreferences.dictation?.microphone || "system"}
                        onChange={(event) => {
                          updateDesktopPreferences((current) => ({
                            ...current,
                            dictation: { ...(current.dictation || {}), microphone: event.target.value as "system" | "default" }
                          }));
                          setSettingsSavedMessage("麦克风设置已保存");
                          setChatStatus?.("麦克风设置已保存");
                        }}
                      >
                        <option value="system">系统默认</option>
                        <option value="default">默认输入设备</option>
                      </select>
                    </div>
                    <div className="codex-setting-row">
                      <span><strong>按住听写快捷键</strong><em>NewBrain 窗口处于活动状态时，按住即可在输入框听写</em></span>
                      <div className="codex-inline-actions">
                        {renderShortcutRecorder(
                          "dictation-hold",
                          desktopPreferences.dictation?.holdShortcut || "",
                          "关闭",
                          (holdShortcut) => updateDesktopPreferences((current) => ({
                            ...current,
                            dictation: { ...(current.dictation || {}), holdShortcut }
                          }))
                        )}
                        <button type="button" className="ghost" onClick={() => updateDesktopPreferences((current) => ({
                          ...current,
                          dictation: { ...(current.dictation || {}), holdShortcut: "" }
                        }))}>清除</button>
                      </div>
                    </div>
                    <div className="codex-setting-row">
                      <span><strong>切换听写快捷键</strong><em>NewBrain 窗口处于活动状态时，按一次开始，再按一次停止</em></span>
                      <div className="codex-inline-actions">
                        {renderShortcutRecorder(
                          "dictation-toggle",
                          desktopPreferences.dictation?.toggleShortcut || "",
                          "关闭",
                          (toggleShortcut) => updateDesktopPreferences((current) => ({
                            ...current,
                            dictation: { ...(current.dictation || {}), toggleShortcut }
                          }))
                        )}
                        <button type="button" className="ghost" onClick={() => updateDesktopPreferences((current) => ({
                          ...current,
                          dictation: { ...(current.dictation || {}), toggleShortcut: "" }
                        }))}>清除</button>
                      </div>
                    </div>
                    <button type="button" className="codex-setting-row" onClick={() => {
                      const keepBarVisible = !desktopPreferences.dictation?.keepBarVisible;
                      updateDesktopPreferences((current) => ({
                        ...current,
                        dictation: { ...(current.dictation || {}), keepBarVisible }
                      }));
                      setSettingsSavedMessage(keepBarVisible ? "听写栏已设为常显" : "听写栏常显已关闭");
                      setChatStatus?.(keepBarVisible ? "听写栏已设为常显" : "听写栏常显已关闭");
                    }}>
                      <span><strong>保持听写栏可见</strong><em>听写未录制时显示小型快捷键提醒</em></span>
                      <SettingsSwitch enabled={Boolean(desktopPreferences.dictation?.keepBarVisible)} />
                    </button>
                    <button
                      type="button"
                      className="codex-setting-row"
                      aria-expanded={desktopPreferences.dictation?.dictionaryOpen !== false}
                      onClick={() => updateDesktopPreferences((current) => ({
                        ...current,
                        dictation: {
                          ...(current.dictation || {}),
                          dictionaryOpen: current.dictation?.dictionaryOpen === false
                        }
                      }))}
                    >
                      <span><strong>听写词典</strong><em>听写应能识别的单词或短语</em></span>
                      <span className="codex-row-caret">{desktopPreferences.dictation?.dictionaryOpen === false ? ">" : "v"}</span>
                    </button>
                    {desktopPreferences.dictation?.dictionaryOpen !== false ? (
                      (desktopPreferences.dictation?.dictionaryEntries?.length
                        ? desktopPreferences.dictation.dictionaryEntries
                        : [{ timestamp: "6月30日 22:06", phrase: "Yeah." }]
                      ).map((entry: any, index: number) => (
                        <div className="codex-setting-row codex-dict-row" key={`${entry.timestamp}-${entry.phrase}-${index}`}>
                          <span>{entry.timestamp}</span>
                          <em>{entry.phrase}</em>
                          <button
                            type="button"
                            className="codex-icon-button"
                            aria-label={`复制词典短语 ${entry.phrase}`}
                            onClick={() => {
                              void writeClipboard(String(entry.phrase || ""));
                              setChatStatus("已复制听写词典短语。");
                            }}
                          >
                            ⧉
                          </button>
                        </div>
                      ))
                    ) : null}
                  </div>
                </section> : null}

                <section className="codex-settings-section">
                  <h4>通知</h4>
                  <div className="codex-setting-list">
                    <div className="codex-setting-row">
                      <span><strong>轮次完成通知</strong><em>设置 newbrain 完成任务时的提醒</em></span>
                      <select
                        className="codex-pill-select"
                        value={desktopPreferences.notifications?.turnComplete || "when-unfocused"}
                        onChange={(event) => updateDesktopPreferences((current) => ({
                          ...current,
                          notifications: {
                            ...(current.notifications || { permission: true, question: true }),
                            turnComplete: event.target.value as "never" | "when-unfocused" | "always"
                          }
                        }))}
                      >
                        <option value="when-unfocused">仅当应用失焦时</option>
                        <option value="always">始终通知</option>
                        <option value="never">从不通知</option>
                      </select>
                    </div>
                    <button type="button" className="codex-setting-row" onClick={() => updateDesktopPreferences((current) => ({
                      ...current,
                      notifications: { ...(current.notifications || { turnComplete: "when-unfocused", question: true }), permission: !current.notifications?.permission }
                    }))}>
                      <span><strong>启用权限通知</strong><em>在需要通知权限时显示提醒</em></span>
                      <SettingsSwitch enabled={desktopPreferences.notifications?.permission !== false} />
                    </button>
                    <button type="button" className="codex-setting-row" onClick={() => updateDesktopPreferences((current) => ({
                      ...current,
                      notifications: { ...(current.notifications || { turnComplete: "when-unfocused", permission: true }), question: !current.notifications?.question }
                    }))}>
                      <span><strong>启用问题通知</strong><em>需要输入才能继续时显示提醒</em></span>
                      <SettingsSwitch enabled={desktopPreferences.notifications?.question !== false} />
                    </button>
                  </div>
                </section>
              </div>
            ) : activeSettingsSection === "mcp" ? (
              <>
                <div className="mcp-proto-page">
                  <div className="page-heading-row" style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", marginBottom: 18 }}>
                    <div>
                      <h3 style={{ margin: "0 0 6px" }}>MCP 服务器</h3>
                      <p style={{ margin: 0, color: "#6f7680" }}>连接外部工具和数据源。写 Figma 云端稿优先接 Figma Desktop MCP。</p>
                    </div>
                    <div className="inline-actions" style={{ display: "flex", gap: 8 }}>
                      <button type="button" onClick={() => openFigmaDesktopMcpPreset()}>＋ Figma Desktop MCP</button>
                      <button type="button" className="catalog-create" style={{ minHeight: 36 }} onClick={() => openMcpSettingsEditor()}>＋ 添加服务器</button>
                    </div>
                  </div>
                  <div className="mcp-proto-list">
                    {mcpServers.map((server: any) => {
                      const health = mcpHealth?.[server.id];
                      const endpoint = server.transport === "sse" || server.transport === "http" ? server.url : server.command || "local";
                      const tags = [
                        String(server.transport || "stdio").toUpperCase(),
                        health?.ok ? "已连接" : server.enabled ? "已启用" : "已停用",
                        endpoint ? String(endpoint).slice(0, 48) : ""
                      ].filter(Boolean);
                      return (
                        <article className="mcp-proto-card" key={server.id}>
                          <div className="mcp-proto-card-head">
                            <div>
                              <h3>{server.name}</h3>
                              <p>{endpoint || "未配置连接信息"}</p>
                              <div className="mcp-proto-chips">{tags.map((tag: string) => <span key={tag}>{tag}</span>)}</div>
                            </div>
                            <div className="mcp-proto-actions">
                              <button
                                type="button"
                                className={`settings-toggle${server.enabled ? " on" : ""}`}
                                aria-label={server.enabled ? `停用 ${server.name}` : `启用 ${server.name}`}
                                onClick={() => void handleToggleMcpServer(server.id)}
                              ><span /></button>
                              {server.enabled ? (
                                <button type="button" onClick={() => void handleStopMcpServer?.(server)}>停止</button>
                              ) : (
                                <button type="button" onClick={() => void handleStartMcpServer?.(server)}>启动</button>
                              )}
                              <button type="button" onClick={() => openMcpSettingsEditor(server)} aria-label={`配置 ${server.name}`}>⚙</button>
                              <button type="button" className="danger" onClick={() => void handleDeleteMcpServer(server.id)}>删除</button>
                            </div>
                          </div>
                        </article>
                      );
                    })}
                    {!mcpServers.length ? <div className="environment-project-empty">尚未添加 MCP 服务器。</div> : null}
                  </div>
                  <section className="codex-mcp-group" style={{ marginTop: 18 }}>
                    <strong>来自插件</strong>
                    <div className="codex-mcp-plugin-source">{Array.from(new Set(mcpServers.filter((server: any) => String(server.id).includes(":")).map((server: any) => String(server.id).split(":")[0]))).join("、") || "暂无插件提供的 MCP 服务器"}</div>
                  </section>
                </div>

                {mcpSettingsView !== "list" ? (
                  <div className="catalog-modal-backdrop" role="presentation" onClick={() => setMcpSettingsView("list")}>
                    <section className="catalog-modal wide mcp-proto-dialog-panel" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
                      <header className="catalog-modal-head">
                        <h2>{mcpSettingsView === "new" ? "连接至自定义 MCP" : `更新 ${mcpDraft.name || "MCP"}`}</h2>
                        <button type="button" className="icon-btn" aria-label="关闭" onClick={() => setMcpSettingsView("list")}>×</button>
                      </header>
                      <div className="catalog-modal-body codex-mcp-editor">
                        {mcpSettingsView === "edit" ? (
                          <div className="inline-actions" style={{ marginBottom: 12 }}>
                            <button type="button" className="danger" onClick={async () => { await handleDeleteMcpServer(editingMcpId); setMcpSettingsView("list"); }}>🗑 卸载</button>
                            <button type="button" disabled={testingMcpId === editingMcpId} onClick={() => {
                              const server = mcpServers.find((item: any) => item.id === editingMcpId);
                              if (server) void handleTestMcpServer(server);
                            }}>{testingMcpId === editingMcpId ? "测试中" : "测试连接"}</button>
                          </div>
                        ) : null}
                        {mcpSettingsView === "new" ? <label className="codex-mcp-field"><span>名称</span><input value={mcpDraft.name} onChange={(event) => setMcpDraft((current: any) => ({ ...current, name: event.target.value }))} placeholder="MCP server name" /></label> : null}
                        {mcpSettingsView === "new" ? <div className="codex-mcp-transport"><button type="button" className={mcpDraft.transport === "stdio" ? "active" : ""} onClick={() => setMcpDraft((current: any) => ({ ...current, transport: "stdio" }))}>STDIO</button><button type="button" className={mcpDraft.transport === "sse" ? "active" : ""} onClick={() => setMcpDraft((current: any) => ({ ...current, transport: "sse" }))}>流式 HTTP</button></div> : null}
                        {mcpDraft.transport === "stdio" ? (
                          <>
                            <label className="codex-mcp-field"><span>启动命令</span><input value={mcpDraft.command} onChange={(event) => setMcpDraft((current: any) => ({ ...current, command: event.target.value }))} placeholder="openai-dev-mcp serve-sqlite" /></label>
                            <div className="codex-mcp-field"><span>参数</span>{String(mcpDraft.args || "").split("\n").map((arg: string, index: number, rows: string[]) => <div className="codex-mcp-pair single" key={`arg-${index}`}><input value={arg} onChange={(event) => { const next=[...rows]; next[index]=event.target.value; setMcpDraft((current:any)=>({...current,args:next.join("\n")})); }} /><button type="button" onClick={() => setMcpDraft((current:any)=>({...current,args:rows.filter((_:string,i:number)=>i!==index).join("\n")}))}>⌫</button></div>)}<button type="button" className="codex-mcp-add-row" onClick={() => setMcpDraft((current:any)=>({...current,args:current.args ? `${current.args}\n` : "\n"}))}>＋ 添加参数</button></div>
                            <div className="codex-mcp-field"><span>环境变量</span>{String(mcpDraft.env || "").split("\n").filter((line:string)=>line && !line.startsWith("NEWBRAIN_MCP_")).map((line:string,index:number,rows:string[])=>{const at=line.indexOf("=");const key=at<0?line:line.slice(0,at);const value=at<0?"":line.slice(at+1);return <div className="codex-mcp-pair" key={`env-${index}`}><input placeholder="键" value={key} onChange={(event)=>{const next=[...rows];next[index]=`${event.target.value}=${value}`;setMcpDraft((current:any)=>({...current,env:next.join("\n")}));}}/><input placeholder="值" value={value} onChange={(event)=>{const next=[...rows];next[index]=`${key}=${event.target.value}`;setMcpDraft((current:any)=>({...current,env:next.join("\n")}));}}/><button type="button" onClick={()=>setMcpDraft((current:any)=>({...current,env:rows.filter((_:string,i:number)=>i!==index).join("\n")}))}>⌫</button></div>})}<button type="button" className="codex-mcp-add-row" onClick={()=>setMcpDraft((current:any)=>({...current,env:current.env?`${current.env}\nNEW_KEY=`:"NEW_KEY="}))}>＋ 添加环境变量</button></div>
                            <div className="codex-mcp-field"><span>环境变量传递</span>{mcpEnvPassthrough.map((value,index)=><div className="codex-mcp-pair single" key={`pass-${index}`}><input value={value} onChange={(event)=>setMcpEnvPassthrough((rows)=>rows.map((row,i)=>i===index?event.target.value:row))}/><button type="button" onClick={()=>setMcpEnvPassthrough((rows)=>rows.filter((_,i)=>i!==index))}>⌫</button></div>)}<button type="button" className="codex-mcp-add-row" onClick={()=>setMcpEnvPassthrough((rows)=>[...rows,""])}>＋ 添加变量</button></div>
                            <label className="codex-mcp-field"><span>工作目录</span><input value={mcpWorkingDirectory} onChange={(event)=>setMcpWorkingDirectory(event.target.value)} placeholder="~/code" /></label>
                          </>
                        ) : (
                          <>
                            <label className="codex-mcp-field"><span>URL</span><input value={mcpDraft.url} onChange={(event)=>setMcpDraft((current:any)=>({...current,url:event.target.value}))} placeholder="http://127.0.0.1:1080" /></label>
                            <label className="codex-mcp-field"><span>Bearer 令牌环境变量</span><input value={mcpBearerTokenEnv} onChange={(event)=>setMcpBearerTokenEnv(event.target.value)} /></label>
                            <div className="codex-mcp-field"><span>标头</span>{mcpHeaders.map((row,index)=><div className="codex-mcp-pair" key={`header-${index}`}><input value={row.key} onChange={(event)=>setMcpHeaders((rows)=>rows.map((item,i)=>i===index?{...item,key:event.target.value}:item))}/><input value={row.value} onChange={(event)=>setMcpHeaders((rows)=>rows.map((item,i)=>i===index?{...item,value:event.target.value}:item))}/><button type="button" onClick={()=>setMcpHeaders((rows)=>rows.filter((_,i)=>i!==index))}>⌫</button></div>)}<button type="button" className="codex-mcp-add-row" onClick={()=>setMcpHeaders((rows)=>[...rows,{key:"",value:""}])}>＋ 添加标头</button></div>
                            <div className="codex-mcp-field"><span>来自环境变量的标头</span>{mcpHeaderEnv.map((row,index)=><div className="codex-mcp-pair" key={`header-env-${index}`}><input placeholder="键" value={row.key} onChange={(event)=>setMcpHeaderEnv((rows)=>rows.map((item,i)=>i===index?{...item,key:event.target.value}:item))}/><input placeholder="值" value={row.value} onChange={(event)=>setMcpHeaderEnv((rows)=>rows.map((item,i)=>i===index?{...item,value:event.target.value}:item))}/><button type="button" onClick={()=>setMcpHeaderEnv((rows)=>rows.filter((_,i)=>i!==index))}>⌫</button></div>)}<button type="button" className="codex-mcp-add-row" onClick={()=>setMcpHeaderEnv((rows)=>[...rows,{key:"",value:""}])}>＋ 添加变量</button></div>
                          </>
                        )}
                      </div>
                      <footer className="catalog-modal-foot">
                        <button type="button" onClick={() => setMcpSettingsView("list")}>取消</button>
                        <button type="button" className="catalog-create" onClick={() => void saveMcpSettingsEditor()}>保存</button>
                      </footer>
                    </section>
                  </div>
                ) : null}
              </>            ) : activeSettingsSection === "appearance" ? (
              <div className="appearance-reference-page">
                <h3>{"\u5916\u89c2"}</h3>
                <div className="appearance-preview-grid">
                  {(["system", "light", "dark"] as const).map((theme) => (
                    <button
                      key={theme}
                      type="button"
                      className={"appearance-preview-card " + theme + (desktopPreferences.appearance.theme === theme ? " active" : "")}
                      onClick={() => updateAppearancePreference({ theme })}
                    >
                      <span><i /><b /><em /></span>
                      <strong>{theme === "system" ? "\u7cfb\u7edf" : theme === "light" ? "\u6d45\u8272" : "\u6df1\u8272"}</strong>
                    </button>
                  ))}
                </div>
                <div className="appearance-diff-preview">
                  <div className="appearance-diff-pane removed">
                    <code><span>1</span> const themePreview: ThemeConfig = {"{"}</code>
                    <code><span>2</span>   surface: "sidebar",</code>
                    <code><span>3</span>   accent: "#2563eb",</code>
                    <code><span>4</span>   contrast: 42,</code>
                    <code><span>5</span> {"};"}</code>
                  </div>
                  <div className="appearance-diff-pane added">
                    <code><span>1</span> const themePreview: ThemeConfig = {"{"}</code>
                    <code><span>2</span>   surface: "sidebar-elevated",</code>
                    <code><span>3</span>   accent: "#0ea5e9",</code>
                    <code><span>4</span>   contrast: 68,</code>
                    <code><span>5</span> {"};"}</code>
                  </div>
                </div>
                {(["light", "dark"] as const).map((kind) => (
                  <section className="appearance-reference-panel" key={kind}>
                    <div className="appearance-reference-panel-head">
                      <strong>{kind === "light" ? "\u6d45\u8272\u4e3b\u9898" : "\u6df1\u8272\u4e3b\u9898"}</strong>
                      <span>{"\u5bfc\u5165"}</span>
                      <span>{"\u590d\u5236\u4e3b\u9898"}</span>
                      <button type="button" className={"appearance-theme-picker " + kind}><i>Aa</i><em>Codex</em><b>?</b></button>
                    </div>
                    {[
                      ["\u5f3a\u8c03\u8272", desktopPreferences.appearance.accentColor, "accent", "accentColor"],
                      ["\u80cc\u666f", desktopPreferences.appearance.backgroundColor, "background", "backgroundColor"],
                      ["\u524d\u666f", desktopPreferences.appearance.foregroundColor, "foreground", "foregroundColor"],
                      ["UI \u5b57\u4f53", desktopPreferences.appearance.uiFontFamily, "font", "uiFontFamily"],
                      ["\u4ee3\u7801\u5b57\u4f53", desktopPreferences.appearance.codeFontFamily, "font", "codeFontFamily"]
                    ].map(([label, value, type, key]) => (
                      <div className="appearance-reference-row" key={kind + "-" + label}>
                        <span>{label}</span>
                        <label className={"appearance-token " + (type === "accent" ? "accent" : type === "background" && kind === "dark" ? "dark" : "")}>{type !== "font" ? <i /> : null}<input type={type === "font" ? "text" : "color"} value={value} onChange={(event) => updateAppearancePreference({ [key]: event.target.value })} /><em>{value}</em></label>
                      </div>
                    ))}
                    <div className="appearance-reference-row"><span>{"\u534a\u900f\u660e\u4fa7\u8fb9\u680f"}</span><button type="button" className={"appearance-switch " + (desktopPreferences.appearance.sidebarTranslucent ? "enabled" : "")} onClick={() => updateAppearancePreference({ sidebarTranslucent: !desktopPreferences.appearance.sidebarTranslucent })}><i /></button></div>
                    <div className="appearance-reference-row"><span>{"\u5bf9\u6bd4\u5ea6"}</span><input type="range" min="0" max="100" value={desktopPreferences.appearance.contrast} onChange={(event) => updateAppearancePreference({ contrast: Number(event.target.value) })} /><em>{desktopPreferences.appearance.contrast}</em></div>
                  </section>
                ))}
                <section className="appearance-reference-panel">
                  <button type="button" className="appearance-option-row" onClick={() => updateAppearancePreference({ pointerCursor: !desktopPreferences.appearance.pointerCursor })}><span><strong>{"\u4f7f\u7528\u6307\u9488\u5149\u6807"}</strong><em>{"\u60ac\u505c\u4ea4\u4e92\u5143\u7d20\u65f6\u5207\u6362\u4e3a\u6307\u9488\u5149\u6807"}</em></span><span className={"appearance-switch " + (desktopPreferences.appearance.pointerCursor ? "enabled" : "")}><i /></span></button>
                  <div className="appearance-option-row"><span><strong>{"\u51cf\u5c11\u52a8\u6001\u6548\u679c"}</strong><em>{"\u51cf\u5c11\u52a8\u753b\u6548\u679c\u6216\u5339\u914d\u7cfb\u7edf\u8bbe\u7f6e"}</em></span><div className="appearance-segmented">{["\u7cfb\u7edf", "\u5f00\u542f", "\u5173\u95ed"].map((label, index) => <button type="button" key={label} className={(desktopPreferences.appearance.reduceMotion ? 1 : 0) === index ? "active" : ""} onClick={() => updateAppearancePreference({ reduceMotion: index === 1 })}>{label}</button>)}</div></div>
                  <div className="appearance-option-row"><span><strong>UI {"\u5b57\u53f7"}</strong><em>{"\u8c03\u6574\u754c\u9762\u57fa\u51c6\u5b57\u53f7\uff08Ctrl+\u6eda\u8f6e\u53ef\u7b49\u6bd4\u7f29\u653e\uff09"}</em></span><label className="appearance-number"><input type="number" min="11" max="28" value={desktopPreferences.appearance.uiFontSize} onChange={(event) => updateAppearancePreference({ uiFontSize: Number(event.target.value) || 14 })} /> px</label></div>
                  <div className="appearance-option-row"><span><strong>{"\u4ee3\u7801\u5b57\u4f53\u5927\u5c0f"}</strong><em>{"\u8c03\u6574\u804a\u5929\u548c\u5dee\u5f02\u89c6\u56fe\u4e2d\u4ee3\u7801\u57fa\u7840\u5b57\u53f7\uff08\u968f UI \u5b57\u53f7\u7b49\u6bd4\uff09"}</em></span><label className="appearance-number"><input type="number" min="10" max="24" value={desktopPreferences.appearance.codeFontSize} onChange={(event) => updateAppearancePreference({ codeFontSize: Number(event.target.value) || 12 })} /> px</label></div>
                  <div className="appearance-option-row"><span><strong>{"\u5dee\u5f02\u6807\u8bb0"}</strong><em>{"\u4f7f\u7528\u989c\u8272\u6216 +/- \u6807\u8bb0\u663e\u793a\u66f4\u6539"}</em></span><div className="appearance-segmented">{["\u989c\u8272", "+/-"].map((label) => <button type="button" key={label} className={(desktopPreferences.appearance.diffMarks === "color" ? "\u989c\u8272" : "+/-") === label ? "active" : ""} onClick={() => updateAppearancePreference({ diffMarks: label === "\u989c\u8272" ? "color" : "marks" })}>{label}</button>)}</div></div>
                </section>
              </div>
            ) : activeSettingsSection === "configuration" ? (
              <>
                <div className="settings-page-head">
                  <div><h3>配置</h3><p>模型配置和运行策略会分别保存到真实配置文件。</p></div>
                  <button type="button" onClick={() => void runSettingsSave("配置", async () => { await saveModelConfig(); await saveDesktopPreferences(); })}>保存配置</button>
                </div>
                <section className="settings-card">
                  <div className="settings-grid">
                    <label className="settings-field"><span>默认模型</span><select value={modelConfig.model} disabled={authorizedModelOptions.length === 0} onChange={(event) => setModelConfig((current) => ({ ...current, model: event.target.value }))}>{authorizedModelOptions.length === 0 ? <option value="">当前套餐无可用模型</option> : authorizedModelOptions.map((item: any) => <option key={item.id} value={item.model}>{item.label || item.model}</option>)}</select></label>
                    <label className="settings-field"><span>评审模型</span><select value={modelConfig.reviewModel} disabled={authorizedModelOptions.filter((item: any) => String(item.model || "").toLowerCase() !== "auto").length === 0} onChange={(event) => setModelConfig((current) => ({ ...current, reviewModel: event.target.value }))}>{authorizedModelOptions.filter((item: any) => String(item.model || "").toLowerCase() !== "auto").length === 0 ? <option value="">当前套餐无可用模型</option> : authorizedModelOptions.filter((item: any) => String(item.model || "").toLowerCase() !== "auto").map((item: any) => <option key={item.id} value={item.model}>{item.label || item.model}</option>)}</select></label>
                    <label className="settings-field"><span>Auto Optimize</span><select value={modelConfig.optimizeFor === "cost" || modelConfig.optimizeFor === "intelligence" ? modelConfig.optimizeFor : "balanced"} disabled={String(modelConfig.model || "").toLowerCase() !== "auto"} onChange={(event) => setModelConfig((current) => ({ ...current, optimizeFor: event.target.value }))}><option value="cost">省钱 (cost)</option><option value="balanced">均衡 (balanced)</option><option value="intelligence">效果优先 (intelligence)</option></select></label>
                    <label className="settings-field"><span>推理强度</span><select value={modelConfig.reasoningEffort} onChange={(event) => setModelConfig((current) => ({ ...current, reasoningEffort: event.target.value as ModelConfigState["reasoningEffort"] }))}><option value="low">low</option><option value="medium">medium</option><option value="high">high</option></select></label>
                    <label className="settings-field"><span>接口模式</span><select value={modelConfig.wireApi} onChange={(event) => setModelConfig((current) => ({ ...current, wireApi: event.target.value === "chat.completions" ? "chat.completions" : "responses" }))}><option value="responses">responses</option><option value="chat.completions">chat.completions</option></select></label>
                  </div>
                  <div className="settings-preference-list">
                    <button type="button" onClick={() => setDesktopPreferences((current) => ({ ...current, configuration: { ...current.configuration, requireApprovalForShell: !current.configuration.requireApprovalForShell } }))}><span>Shell 命令需要审批</span><SettingsSwitch enabled={desktopPreferences.configuration.requireApprovalForShell} /></button>
                    <button type="button" onClick={() => setDesktopPreferences((current) => ({ ...current, configuration: { ...current.configuration, saveResponses: !current.configuration.saveResponses } }))}><span>保存模型响应</span><SettingsSwitch enabled={desktopPreferences.configuration.saveResponses} /></button>
                    <button type="button" onClick={() => setDesktopPreferences((current) => ({ ...current, configuration: { ...current.configuration, telemetryEnabled: !current.configuration.telemetryEnabled } }))}><span>写入诊断日志</span><SettingsSwitch enabled={desktopPreferences.configuration.telemetryEnabled} /></button>
                    <button
                      type="button"
                      onClick={() => setDesktopPreferences((current) => ({
                        ...current,
                        market: {
                          ...current.market,
                          directClawhubAllowed: !(current.market?.directClawhubAllowed ?? true)
                        }
                      }))}
                    >
                      <span>
                        <strong>ClawHub 直连</strong>
                        <em>直接访问 https://clawhub.ai 搜索/安装技能；关闭后仅允许本地 zip 导入</em>
                      </span>
                      <SettingsSwitch enabled={desktopPreferences.market?.directClawhubAllowed ?? true} />
                    </button>
                  </div>
                </section>
              </>
            ) : activeSettingsSection === "personalization" ? (
              <>
                <div className="settings-page-head"><div><h3>个性化</h3><p>协作语气和输出习惯会被持久化。</p></div><button type="button" onClick={() => void runSettingsSave("个性化", async () => { await saveModelConfig(); await saveDesktopPreferences(); })}>保存个性化</button></div>
                <section className="settings-card"><label className="settings-field"><span>系统提示词</span><textarea value={modelConfig.systemPrompt} onChange={(event) => setModelConfig((current) => ({ ...current, systemPrompt: event.target.value }))} rows={8} /></label></section>
                <section className="settings-card">
                  <div className="settings-card-head">
                    <div>
                      <strong>用户知识同步</strong>
                      <p>将本地用户知识（全局偏好、项目规则等）与 spring-app 账号空间手动同步。不会在后台自动上传或拉取。</p>
                    </div>
                  </div>
                  {knowledgeSyncNotice ? <p className="settings-field-hint">{knowledgeSyncNotice}</p> : null}
                  <div className="inline-actions">
                    <button
                      type="button"
                      disabled={knowledgeSyncBusy || !api?.syncUserKnowledge}
                      onClick={() => {
                        if (!api?.syncUserKnowledge) return;
                        setKnowledgeSyncBusy(true);
                        setKnowledgeSyncNotice("");
                        void api.syncUserKnowledge({ forceFullPull: false }).then((result) => {
                          if (result.status === "skipped") {
                            setKnowledgeSyncNotice(result.message || "未登录，无法同步。");
                            return;
                          }
                          if (!result.ok || result.status === "error") {
                            setKnowledgeSyncNotice(result.message || "同步失败。");
                            return;
                          }
                          setKnowledgeSyncNotice(
                            `同步完成：拉取 ${result.pulled} 条，推送 ${result.pushed} 条，版本 ${result.generation}${result.conflictRetried ? `（冲突重试 ${result.conflictRetried} 次）` : ""}。`
                          );
                        }).catch((error) => {
                          setKnowledgeSyncNotice(error instanceof Error ? error.message : String(error));
                        }).finally(() => setKnowledgeSyncBusy(false));
                      }}
                    >
                      {knowledgeSyncBusy ? "同步中..." : "立即同步用户知识"}
                    </button>
                  </div>
                </section>
                <section className="settings-card muted"><div className="settings-preference-list">
                  <button type="button" onClick={() => setDesktopPreferences((current) => ({ ...current, personalization: { ...current.personalization, proactiveUpdates: !current.personalization.proactiveUpdates } }))}><span>主动说明正在做什么</span><SettingsSwitch enabled={desktopPreferences.personalization.proactiveUpdates} /></button>
                  <button type="button" onClick={() => setDesktopPreferences((current) => ({ ...current, personalization: { ...current.personalization, autoSkillEnabled: !current.personalization.autoSkillEnabled } }))}><span>Skill 自动唤醒</span><SettingsSwitch enabled={Boolean(desktopPreferences.personalization.autoSkillEnabled)} /></button>
                  <button type="button" onClick={() => setDesktopPreferences((current) => ({ ...current, personalization: { ...current.personalization, includeVerificationSummary: !current.personalization.includeVerificationSummary } }))}><span>完成后附带验证结果</span><SettingsSwitch enabled={desktopPreferences.personalization.includeVerificationSummary} /></button>
                  <button type="button" onClick={() => setDesktopPreferences((current) => ({ ...current, personalization: { ...current.personalization, reviewFindingsFirst: !current.personalization.reviewFindingsFirst } }))}><span>代码审查优先列风险</span><SettingsSwitch enabled={desktopPreferences.personalization.reviewFindingsFirst} /></button>
                </div></section>
              </>
            ) : activeSettingsSection === "hooks" ? (
              <>
                <div className="settings-page-head"><div><h3>钩子</h3><p>命令前后钩子已接入运行记录，保存后立即生效。</p></div><button type="button" onClick={() => void runSettingsSave("钩子", saveDesktopPreferences)}>保存钩子</button></div>
                <div className="settings-hook-list">
                  {([
                    ["beforeCommand", "命令前：记录执行意图"],
                    ["afterCommand", "命令后：记录执行结果"],
                    ["beforeCommit", "提交前：展示 diff 摘要"],
                    ["afterTask", "任务结束：记录验证摘要"]
                  ] as Array<[keyof Pick<DesktopPreferencesState["hooks"], "beforeCommand" | "afterCommand" | "beforeCommit" | "afterTask">, string]>).map(([key, label]) => (
                    <section className="settings-card" key={key}>
                      <button type="button" className="settings-card-head" onClick={() => setDesktopPreferences((current) => ({ ...current, hooks: { ...current.hooks, [key]: !current.hooks[key] } }))}>
                        <div><strong>{label}</strong><p>{desktopPreferences.hooks[key] ? "已启用" : "已停用"}</p></div>
                        <SettingsSwitch enabled={desktopPreferences.hooks[key]} />
                      </button>
                    </section>
                  ))}
                </div>
                <section className="settings-card">
                  <div className="settings-grid">
                    <label className="settings-field"><span>命令前脚本</span><textarea value={desktopPreferences.hooks.beforeCommandScript} onChange={(event) => setDesktopPreferences((current) => ({ ...current, hooks: { ...current.hooks, beforeCommandScript: event.target.value } }))} rows={3} /></label>
                    <label className="settings-field"><span>命令后脚本</span><textarea value={desktopPreferences.hooks.afterCommandScript} onChange={(event) => setDesktopPreferences((current) => ({ ...current, hooks: { ...current.hooks, afterCommandScript: event.target.value } }))} rows={3} /></label>
                    <label className="settings-field"><span>提交前脚本</span><textarea value={desktopPreferences.hooks.beforeCommitScript} onChange={(event) => setDesktopPreferences((current) => ({ ...current, hooks: { ...current.hooks, beforeCommitScript: event.target.value } }))} rows={3} /></label>
                    <label className="settings-field"><span>任务后脚本</span><textarea value={desktopPreferences.hooks.afterTaskScript} onChange={(event) => setDesktopPreferences((current) => ({ ...current, hooks: { ...current.hooks, afterTaskScript: event.target.value } }))} rows={3} /></label>
                  </div>
                </section>
              </>
            ) : activeSettingsSection === "git" ? (
              <>
                <div className="settings-page-head"><div><h3>Git</h3></div></div>
                <section className="settings-card git-settings-card">
                  <div className="git-setting-row">
                    <div><strong>分支前缀</strong><p>在 NewBrain 中创建新分支时使用的前缀</p></div>
                    <input value={desktopPreferences.git.branchPrefix} onChange={(event) => setDesktopPreferences((current) => ({ ...current, git: { ...current.git, branchPrefix: event.target.value } }))} />
                  </div>
                  <div className="git-setting-row">
                    <div><strong>拉取请求合并方法</strong><p>选择 NewBrain 合并拉取请求的方法</p></div>
                    <div className="git-merge-method" role="group" aria-label="拉取请求合并方法">
                      <button type="button" className={desktopPreferences.git.pullRequestMergeMethod === "merge" ? "active" : ""} onClick={() => setDesktopPreferences((current) => ({ ...current, git: { ...current.git, pullRequestMergeMethod: "merge" } }))}>合并</button>
                      <button type="button" className={desktopPreferences.git.pullRequestMergeMethod === "squash" ? "active" : ""} onClick={() => setDesktopPreferences((current) => ({ ...current, git: { ...current.git, pullRequestMergeMethod: "squash" } }))}>压缩</button>
                    </div>
                  </div>
                  {([
                    ["forcePushWithLease", "始终强制推送", "从 NewBrain 推送时使用 --force-with-lease 参数"],
                    ["createDraftPullRequests", "创建草稿拉取请求", "从 NewBrain 创建 PR 时默认使用草稿拉取请求"],
                    ["autoDeleteOldWorktrees", "自动删除旧工作树", "推荐大多数用户启用。仅当你需要手动管理工作树和磁盘使用空间时，再关闭此功能。"]
                  ] as Array<["forcePushWithLease" | "createDraftPullRequests" | "autoDeleteOldWorktrees", string, string]>).map(([key, title, description]) => (
                    <button className="git-setting-row git-setting-toggle" type="button" key={key} onClick={() => setDesktopPreferences((current) => ({ ...current, git: { ...current.git, [key]: !current.git[key] } }))}>
                      <div><strong>{title}</strong><p>{description}</p></div><SettingsSwitch enabled={desktopPreferences.git[key]} />
                    </button>
                  ))}
                  <div className="git-setting-row">
                    <div><strong>自动删除限制</strong><p>自动清理较旧工作树前保留的 NewBrain 工作树数量。删除前会创建快照，因此被清理的工作树始终可恢复。</p></div>
                    <input className="git-limit-input" type="number" min="1" max="100" value={desktopPreferences.git.autoDeleteWorktreeLimit} onChange={(event) => setDesktopPreferences((current) => ({ ...current, git: { ...current.git, autoDeleteWorktreeLimit: Math.max(1, Math.min(100, Number(event.target.value) || 1)) } }))} />
                  </div>
                </section>
                <section className="git-commit-instructions">
                  <div className="git-commit-instructions-head"><div><h4>提交指令</h4><p>已添加到提交信息生成提示中</p></div><button type="button" onClick={() => void runSettingsSave("提交指令", saveDesktopPreferences)}>保存</button></div>
                  <textarea value={desktopPreferences.git.commitInstructions} onChange={(event) => setDesktopPreferences((current) => ({ ...current, git: { ...current.git, commitInstructions: event.target.value } }))} placeholder="添加提交消息指引..." rows={5} />
                </section>
              </>            ) : activeSettingsSection === "environment" ? (
              <>
                <div className="settings-page-head"><div><h3>环境</h3><p>管理运行环境与额外环境变量。</p></div><button type="button" onClick={() => void runSettingsSave("环境", saveDesktopPreferences)}>保存环境</button></div>
                <section className="environment-projects">
                  <div className="environment-projects-head">
                    <strong>选择项目</strong>
                    <button type="button" onClick={async () => { const added = await addExistingProject?.(); if (added) setChatStatus("项目已添加到环境列表。"); }}>添加项目</button>
                  </div>
                  <div className="environment-project-list">
                    {visibleProjectWorkspaces.map((workspace: any) => {
                      const selected = workspace.id === selectedWorkspace?.id;
                      return (
                        <div className={`environment-project-row${selected ? " selected" : ""}`} key={workspace.id}>
                          <span className="environment-project-icon" aria-hidden="true">▣</span>
                          <strong>{workspace.name}</strong>
                          {workspace.role || workspace.owner ? <em>{workspace.role || workspace.owner}</em> : null}
                          <button type="button" title={selected ? "当前项目" : `选择 ${workspace.name}`} aria-label={selected ? `${workspace.name} 是当前项目` : `选择项目 ${workspace.name}`} onClick={() => { setSelectedWorkspaceId(workspace.id); setSelectedThreadId(workspace.threads?.[0]?.id ?? ""); setChatStatus(`已选择项目：${workspace.name}`); }}>{selected ? "✓" : "+"}</button>
                        </div>
                      );
                    })}
                    {!visibleProjectWorkspaces.length ? <div className="environment-project-empty">暂无项目，点击“添加项目”选择一个本地目录。</div> : null}
                  </div>
                </section>                <section className="settings-card">
                  <div className="settings-grid">
                    <label className="settings-field"><span>自动初始化 Conda</span><button type="button" className="settings-inline-toggle" onClick={() => setDesktopPreferences((current) => ({ ...current, environment: { ...current.environment, autoBootstrapConda: !current.environment.autoBootstrapConda } }))}><SettingsSwitch enabled={desktopPreferences.environment.autoBootstrapConda} /></button></label>
                  </div>
                  <label className="settings-field">
                    <span>Figma 访问令牌</span>
                    <input
                      type="password"
                      autoComplete="off"
                      placeholder="figd_…（Personal Access Token）"
                      value={(() => {
                        const line = String(environmentEnvText || "").split(/\r?\n/).find((row: string) => row.startsWith("FIGMA_ACCESS_TOKEN="));
                        return line ? line.slice("FIGMA_ACCESS_TOKEN=".length) : "";
                      })()}
                      onChange={(event) => {
                        const token = event.target.value;
                        const rows = String(environmentEnvText || "").split(/\r?\n/).filter((row: string) => row && !row.startsWith("FIGMA_ACCESS_TOKEN="));
                        if (token.trim()) rows.push(`FIGMA_ACCESS_TOKEN=${token}`);
                        setEnvironmentEnvText(rows.join("\n"));
                      }}
                    />
                    <em className="settings-field-hint">内置 Figma 插件写入云端设计稿/FigJam 需要此令牌，或在 MCP 中连接 Figma。未配置时仍可用聊天 Mermaid / Visualize 画本地流程图。</em>
                  </label>
                  <label className="settings-field"><span>额外环境变量</span><textarea value={environmentEnvText} onChange={(event) => setEnvironmentEnvText(event.target.value)} placeholder={"KEY=value\nFIGMA_ACCESS_TOKEN=figd_xxx"} rows={5} /></label>
                  <dl className="settings-facts"><div><dt>平台</dt><dd>{bootstrapState}</dd></div><div><dt>工作目录</dt><dd>{snapshot.session.workspacePath}</dd></div><div><dt>Conda</dt><dd>{desktopBootstrapStatus.conda.status}</dd></div></dl>
                </section>
              </>
            ) : activeSettingsSection === "worktree" ? (
              <>
                <div className="settings-page-head"><div><h3>工作树</h3><p>开启隔离后可真实创建 Git worktree。</p></div><button type="button" onClick={() => void runSettingsSave("工作树", saveDesktopPreferences)}>保存工作树</button></div>
                <section className="settings-card">
                  <label className="settings-field"><span>工作树根目录</span><input value={desktopPreferences.worktree.rootDir} onChange={(event) => setDesktopPreferences((current) => ({ ...current, worktree: { ...current.worktree, rootDir: event.target.value } }))} /></label>
                  <div className="settings-preference-list">
                    <button type="button" onClick={() => setDesktopPreferences((current) => ({ ...current, worktree: { ...current.worktree, defaultIsolated: !current.worktree.defaultIsolated } }))}><span>新任务默认隔离 worktree</span><SettingsSwitch enabled={desktopPreferences.worktree.defaultIsolated} /></button>
                    <button type="button" onClick={() => setDesktopPreferences((current) => ({ ...current, worktree: { ...current.worktree, keepArchived: !current.worktree.keepArchived } }))}><span>归档线程保留工作树</span><SettingsSwitch enabled={desktopPreferences.worktree.keepArchived} /></button>
                  </div>
                  <div className="inline-actions"><button type="button" disabled={!api || !selectedWorkspace} onClick={async () => { if (!api || !selectedWorkspace) return; const result = await api.createWorkspaceWorktree({ workspaceId: selectedWorkspace.id }); setChatStatus(result.detail); if (!result.ok) setErrorMessage(result.detail); }}>创建真实 worktree</button></div>
                </section>
              </>
            ) : activeSettingsSection === "browser" ? (
              <>
                <div className="settings-page-head">
                  <div>
                    <h3>浏览器</h3>
                    <p>管理 Browser Use 偏好与网站访问权限（对齐 Codex 桌面浏览器设置）。</p>
                  </div>
                  <button type="button" onClick={() => void runSettingsSave("浏览器", saveDesktopPreferences)}>保存浏览器</button>
                </div>
                <section className="settings-card">
                  <div className="settings-preference-list">
                    <button
                      type="button"
                      onClick={() => setDesktopPreferences((current) => ({
                        ...current,
                        browser: { ...current.browser, enabled: !current.browser.enabled }
                      }))}
                    >
                      <span>Browser：允许智能体操控内置浏览器</span>
                      <SettingsSwitch enabled={desktopPreferences.browser.enabled !== false} />
                    </button>
                  </div>
                </section>
                <section className="settings-card">
                  <h4>常规</h4>
                  <label className="settings-field">
                    <span>预览 URL</span>
                    <input
                      value={desktopPreferences.browser.previewUrl}
                      onChange={(event) => setDesktopPreferences((current) => ({
                        ...current,
                        browser: { ...current.browser, previewUrl: event.target.value }
                      }))}
                    />
                  </label>
                  <label className="settings-field">
                    <span>网页 URL 和链接打开位置</span>
                    <select
                      value={desktopPreferences.browser.openWebLinksIn || "in-app-browser"}
                      onChange={(event) => setDesktopPreferences((current) => ({
                        ...current,
                        browser: {
                          ...current.browser,
                          openWebLinksIn: event.target.value === "system" ? "system" : "in-app-browser"
                        }
                      }))}
                    >
                      <option value="in-app-browser">NewBrain 内置浏览器</option>
                      <option value="system">系统浏览器</option>
                    </select>
                  </label>
                  <label className="settings-field">
                    <span>本地 URL 打开位置</span>
                    <select
                      value={desktopPreferences.browser.openLocalLinksIn || "in-app-browser"}
                      onChange={(event) => setDesktopPreferences((current) => ({
                        ...current,
                        browser: {
                          ...current.browser,
                          openLocalLinksIn: event.target.value === "system" ? "system" : "in-app-browser"
                        }
                      }))}
                    >
                      <option value="in-app-browser">NewBrain 内置浏览器</option>
                      <option value="system">系统浏览器</option>
                    </select>
                  </label>
                  <div className="settings-preference-list">
                    <button type="button" onClick={() => setDesktopPreferences((current) => ({ ...current, browser: { ...current.browser, showFullUrl: !current.browser.showFullUrl } }))}>
                      <span>显示完整网址</span>
                      <SettingsSwitch enabled={Boolean(desktopPreferences.browser.showFullUrl)} />
                    </button>
                    <button type="button" onClick={() => setDesktopPreferences((current) => ({ ...current, browser: { ...current.browser, autoOpenPreview: !current.browser.autoOpenPreview } }))}>
                      <span>前端改动后自动打开本地预览</span>
                      <SettingsSwitch enabled={desktopPreferences.browser.autoOpenPreview} />
                    </button>
                    <button type="button" onClick={() => setDesktopPreferences((current) => ({ ...current, browser: { ...current.browser, preserveTabs: !current.browser.preserveTabs } }))}>
                      <span>保留上次浏览器标签</span>
                      <SettingsSwitch enabled={desktopPreferences.browser.preserveTabs} />
                    </button>
                    <button type="button" onClick={() => setDesktopPreferences((current) => ({ ...current, browser: { ...current.browser, highResScreenshots: !current.browser.highResScreenshots } }))}>
                      <span>截图验证使用高分辨率</span>
                      <SettingsSwitch enabled={desktopPreferences.browser.highResScreenshots} />
                    </button>
                  </div>
                  <label className="settings-field">
                    <span>批注截图</span>
                    <select
                      value={desktopPreferences.browser.annotatedScreenshots || "always"}
                      onChange={(event) => {
                        const value = event.target.value;
                        setDesktopPreferences((current) => ({
                          ...current,
                          browser: {
                            ...current.browser,
                            annotatedScreenshots: value === "ask" || value === "never" ? value : "always"
                          }
                        }));
                      }}
                    >
                      <option value="always">始终包含</option>
                      <option value="ask">询问</option>
                      <option value="never">从不</option>
                    </select>
                  </label>
                  <p className="subtle">截图有助于理解批注，但会增加用量。</p>
                  <div className="inline-actions">
                    <button type="button" disabled={!api} onClick={() => void api?.openBrowserPreview(desktopPreferences.browser.previewUrl)}>打开预览</button>
                    <button type="button" disabled={!api} onClick={async () => { const result = await api?.captureBrowserPreview(); if (result) setChatStatus(`截图已保存: ${result.path}`); }}>截取预览</button>
                    <button
                      type="button"
                      disabled={!api?.clearBrowserBrowsingData}
                      onClick={async () => {
                        const result = await api?.clearBrowserBrowsingData?.();
                        setChatStatus(result?.detail || "已清除浏览数据");
                      }}
                    >
                      清除浏览数据
                    </button>
                    <button
                      type="button"
                      disabled={!api?.listBrowserHistory}
                      onClick={async () => {
                        try {
                          const rows = await api?.listBrowserHistory?.();
                          setBrowserHistoryRows(rows || []);
                          setBrowserManagePanel("history");
                          setChatStatus(`浏览历史 ${rows?.length ?? 0} 条`);
                        } catch (error) {
                          setErrorMessage(error instanceof Error ? error.message : String(error));
                        }
                      }}
                    >
                      管理浏览历史
                    </button>
                  </div>
                  {browserManagePanel === "history" ? (
                    <div className="mcp-server-list" style={{ marginTop: 12 }}>
                      {browserHistoryRows.length === 0 ? <p className="subtle">暂无历史记录。</p> : null}
                      {browserHistoryRows.map((row) => (
                        <article key={row.id} className="mcp-server-item enabled">
                          <div className="mcp-server-main">
                            <strong>{row.title || row.url}</strong>
                            <p className="subtle">{row.url}</p>
                            <p className="subtle">{row.visitedAt}</p>
                          </div>
                          <div className="mcp-server-actions">
                            <button
                              type="button"
                              className="danger"
                              disabled={!api?.removeBrowserHistoryEntry}
                              onClick={async () => {
                                try {
                                  const rows = await api?.removeBrowserHistoryEntry?.(row.id);
                                  setBrowserHistoryRows(rows || []);
                                } catch (error) {
                                  setErrorMessage(error instanceof Error ? error.message : String(error));
                                }
                              }}
                            >
                              删除
                            </button>
                          </div>
                        </article>
                      ))}
                      <div className="inline-actions">
                        <button
                          type="button"
                          className="danger"
                          disabled={!api?.clearBrowserHistory}
                          onClick={async () => {
                            try {
                              await api?.clearBrowserHistory?.();
                              setBrowserHistoryRows([]);
                              setChatStatus("已清空浏览历史");
                            } catch (error) {
                              setErrorMessage(error instanceof Error ? error.message : String(error));
                            }
                          }}
                        >
                          清空历史
                        </button>
                        <button type="button" onClick={() => setBrowserManagePanel(null)}>关闭</button>
                      </div>
                    </div>
                  ) : null}
                </section>
                <section className="settings-card">
                  <h4>自动填充和密码</h4>
                  <p className="subtle">密码与联系人保存在本地，不会进入模型上下文。</p>
                  <div className="inline-actions">
                    <button
                      type="button"
                      disabled={!api?.listBrowserCredentials}
                      onClick={async () => {
                        try {
                          const rows = await api?.listBrowserCredentials?.();
                          setBrowserCredentialRows(rows || []);
                          setBrowserManagePanel("passwords");
                          setChatStatus(rows?.length ? `已保存 ${rows.length} 条登录凭据（仅元数据）` : "暂无保存的密码");
                        } catch (error) {
                          setErrorMessage(error instanceof Error ? error.message : String(error));
                        }
                      }}
                    >
                      管理密码
                    </button>
                    <button
                      type="button"
                      disabled={!api?.listBrowserContacts}
                      onClick={async () => {
                        try {
                          const rows = await api?.listBrowserContacts?.();
                          setBrowserContactRows(rows || []);
                          setBrowserManagePanel("contacts");
                          setChatStatus(rows?.length ? `已保存 ${rows.length} 条联系人` : "暂无联系人");
                        } catch (error) {
                          setErrorMessage(error instanceof Error ? error.message : String(error));
                        }
                      }}
                    >
                      管理联系信息
                    </button>
                  </div>
                  {browserManagePanel === "passwords" ? (
                    <div className="mcp-server-list" style={{ marginTop: 12 }}>
                      <label className="settings-field"><span>Origin</span><input value={browserCredentialDraft.origin} onChange={(event) => setBrowserCredentialDraft((current) => ({ ...current, origin: event.target.value }))} /></label>
                      <label className="settings-field"><span>用户名</span><input value={browserCredentialDraft.username} onChange={(event) => setBrowserCredentialDraft((current) => ({ ...current, username: event.target.value }))} /></label>
                      <label className="settings-field"><span>密码</span><input type="password" autoComplete="new-password" value={browserCredentialDraft.password} onChange={(event) => setBrowserCredentialDraft((current) => ({ ...current, password: event.target.value }))} /></label>
                      <div className="inline-actions">
                        <button
                          type="button"
                          disabled={!api?.upsertBrowserCredential}
                          onClick={async () => {
                            try {
                              const rows = await api?.upsertBrowserCredential?.(browserCredentialDraft);
                              setBrowserCredentialRows(rows || []);
                              setBrowserCredentialDraft({ origin: "", username: "", password: "" });
                              setChatStatus("已保存凭据（本地加密）");
                            } catch (error) {
                              setErrorMessage(error instanceof Error ? error.message : String(error));
                            }
                          }}
                        >
                          保存凭据
                        </button>
                        <button type="button" onClick={() => setBrowserManagePanel(null)}>关闭</button>
                      </div>
                      {browserCredentialRows.map((row) => (
                        <article key={row.id} className="mcp-server-item enabled">
                          <div className="mcp-server-main">
                            <strong>{row.username}</strong>
                            <p className="subtle">{row.origin}{row.hasPassword ? " · 已加密密码" : ""}</p>
                          </div>
                          <div className="mcp-server-actions">
                            <button
                              type="button"
                              className="danger"
                              disabled={!api?.removeBrowserCredential}
                              onClick={async () => {
                                try {
                                  const rows = await api?.removeBrowserCredential?.(row.id);
                                  setBrowserCredentialRows(rows || []);
                                } catch (error) {
                                  setErrorMessage(error instanceof Error ? error.message : String(error));
                                }
                              }}
                            >
                              删除
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : null}
                  {browserManagePanel === "contacts" ? (
                    <div className="mcp-server-list" style={{ marginTop: 12 }}>
                      <label className="settings-field"><span>姓名</span><input value={browserContactDraft.name} onChange={(event) => setBrowserContactDraft((current) => ({ ...current, name: event.target.value }))} /></label>
                      <label className="settings-field"><span>邮箱</span><input value={browserContactDraft.email} onChange={(event) => setBrowserContactDraft((current) => ({ ...current, email: event.target.value }))} /></label>
                      <label className="settings-field"><span>电话</span><input value={browserContactDraft.phone} onChange={(event) => setBrowserContactDraft((current) => ({ ...current, phone: event.target.value }))} /></label>
                      <div className="inline-actions">
                        <button
                          type="button"
                          disabled={!api?.upsertBrowserContact}
                          onClick={async () => {
                            try {
                              const rows = await api?.upsertBrowserContact?.(browserContactDraft);
                              setBrowserContactRows(rows || []);
                              setBrowserContactDraft({ name: "", email: "", phone: "" });
                              setChatStatus("已保存联系人");
                            } catch (error) {
                              setErrorMessage(error instanceof Error ? error.message : String(error));
                            }
                          }}
                        >
                          保存联系人
                        </button>
                        <button type="button" onClick={() => setBrowserManagePanel(null)}>关闭</button>
                      </div>
                      {browserContactRows.map((row) => (
                        <article key={row.id} className="mcp-server-item enabled">
                          <div className="mcp-server-main">
                            <strong>{row.name}</strong>
                            <p className="subtle">{[row.email, row.phone].filter(Boolean).join(" · ") || "无联系方式"}</p>
                          </div>
                          <div className="mcp-server-actions">
                            <button
                              type="button"
                              className="danger"
                              disabled={!api?.removeBrowserContact}
                              onClick={async () => {
                                try {
                                  const rows = await api?.removeBrowserContact?.(row.id);
                                  setBrowserContactRows(rows || []);
                                } catch (error) {
                                  setErrorMessage(error instanceof Error ? error.message : String(error));
                                }
                              }}
                            >
                              删除
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : null}
                </section>
                <section className="settings-card">
                  <h4>扩展程序</h4>
                  <p className="subtle">内置浏览器扩展管理取决于 Electron 扩展加载能力；桌面端暂不支持。</p>
                  <div className="inline-actions">
                    <button type="button" disabled title="桌面端暂不支持">管理扩展</button>
                  </div>
                </section>
                <section className="settings-card">
                  <h4>下载</h4>
                  <label className="settings-field">
                    <span>位置</span>
                    <div className="inline-actions" style={{ marginTop: 0 }}>
                      <input
                        readOnly
                        value={desktopPreferences.browser.downloadDir || "系统下载文件夹"}
                      />
                      <button
                        type="button"
                        disabled={!api?.selectBrowserDownloadDir}
                        onClick={async () => {
                          const result = await api?.selectBrowserDownloadDir?.();
                          if (result?.path) {
                            setDesktopPreferences((current) => ({
                              ...current,
                              browser: { ...current.browser, downloadDir: result.path }
                            }));
                          }
                        }}
                      >
                        更改
                      </button>
                    </div>
                  </label>
                  <div className="settings-preference-list">
                    <button type="button" onClick={() => setDesktopPreferences((current) => ({ ...current, browser: { ...current.browser, askDownloadPath: !current.browser.askDownloadPath } }))}>
                      <span>下载前询问保存位置</span>
                      <SettingsSwitch enabled={Boolean(desktopPreferences.browser.askDownloadPath)} />
                    </button>
                  </div>
                </section>
                <section className="settings-card">
                  <h4>浏览器权限</h4>
                  <label className="settings-field">
                    <span>历史记录访问</span>
                    <select
                      value={desktopPreferences.browser.historyAccess || "always_ask"}
                      onChange={(event) => {
                        const value = event.target.value;
                        setDesktopPreferences((current) => ({
                          ...current,
                          browser: {
                            ...current.browser,
                            historyAccess: value === "allow" || value === "deny" ? value : "always_ask"
                          }
                        }));
                      }}
                    >
                      <option value="always_ask">始终询问</option>
                      <option value="allow">允许</option>
                      <option value="deny">拒绝</option>
                    </select>
                  </label>
                  <div className="settings-preference-list">
                    <button type="button" onClick={() => setDesktopPreferences((current) => ({ ...current, browser: { ...current.browser, siteToolsEnabled: !current.browser.siteToolsEnabled } }))}>
                      <span>启用站点工具（含 WebMCP 探测）</span>
                      <SettingsSwitch enabled={desktopPreferences.browser.siteToolsEnabled !== false} />
                    </button>
                  </div>
                </section>
                <section className="settings-card">
                  <h4>智能体权限</h4>
                  <p className="subtle">设置默认策略，并为站点添加例外。</p>
                  {(["browse", "download", "upload"] as const).map((action) => (
                    <label key={action} className="settings-field">
                      <span>默认 · {action === "browse" ? "浏览" : action === "download" ? "下载" : "上传"}</span>
                      <select
                        value={desktopPreferences.browser.agentPermissions?.defaults?.[action] || "require_approval"}
                        onChange={(event) => {
                          const value = event.target.value === "always_allow" || event.target.value === "deny"
                            ? event.target.value
                            : "require_approval";
                          setDesktopPreferences((current) => ({
                            ...current,
                            browser: {
                              ...current.browser,
                              agentPermissions: {
                                defaults: {
                                  browse: current.browser.agentPermissions?.defaults?.browse || "require_approval",
                                  download: current.browser.agentPermissions?.defaults?.download || "require_approval",
                                  upload: current.browser.agentPermissions?.defaults?.upload || "require_approval",
                                  [action]: value
                                },
                                exceptions: current.browser.agentPermissions?.exceptions || []
                              }
                            }
                          }));
                        }}
                      >
                        <option value="require_approval">需要批准</option>
                        <option value="always_allow">始终允许</option>
                        <option value="deny">拒绝</option>
                      </select>
                    </label>
                  ))}
                  <div className="mcp-server-list" style={{ marginTop: 12 }}>
                    {(desktopPreferences.browser.agentPermissions?.exceptions || []).map((row, index) => (
                      <article key={`${row.origin}-${index}`} className="mcp-server-item enabled">
                        <div className="mcp-server-main">
                          <label className="settings-field">
                            <span>Origin</span>
                            <input
                              value={row.origin}
                              onChange={(event) => {
                                const origin = event.target.value;
                                setDesktopPreferences((current) => {
                                  const exceptions = [...(current.browser.agentPermissions?.exceptions || [])];
                                  exceptions[index] = { ...exceptions[index], origin };
                                  return {
                                    ...current,
                                    browser: {
                                      ...current.browser,
                                      agentPermissions: {
                                        defaults: current.browser.agentPermissions?.defaults || {
                                          browse: "require_approval",
                                          download: "require_approval",
                                          upload: "require_approval"
                                        },
                                        exceptions
                                      }
                                    }
                                  };
                                });
                              }}
                            />
                          </label>
                          {(["browse", "download", "upload"] as const).map((action) => (
                            <label key={action} className="settings-field">
                              <span>{action === "browse" ? "浏览" : action === "download" ? "下载" : "上传"}</span>
                              <select
                                value={row[action]}
                                onChange={(event) => {
                                  const value = event.target.value === "always_allow" || event.target.value === "deny"
                                    ? event.target.value
                                    : "require_approval";
                                  setDesktopPreferences((current) => {
                                    const exceptions = [...(current.browser.agentPermissions?.exceptions || [])];
                                    exceptions[index] = { ...exceptions[index], [action]: value };
                                    return {
                                      ...current,
                                      browser: {
                                        ...current.browser,
                                        agentPermissions: {
                                          defaults: current.browser.agentPermissions?.defaults || {
                                            browse: "require_approval",
                                            download: "require_approval",
                                            upload: "require_approval"
                                          },
                                          exceptions
                                        }
                                      }
                                    };
                                  });
                                }}
                              >
                                <option value="require_approval">需要批准</option>
                                <option value="always_allow">始终允许</option>
                                <option value="deny">拒绝</option>
                              </select>
                            </label>
                          ))}
                        </div>
                        <div className="mcp-server-actions">
                          <button
                            type="button"
                            className="danger"
                            onClick={() => setDesktopPreferences((current) => ({
                              ...current,
                              browser: {
                                ...current.browser,
                                agentPermissions: {
                                  defaults: current.browser.agentPermissions?.defaults || {
                                    browse: "require_approval",
                                    download: "require_approval",
                                    upload: "require_approval"
                                  },
                                  exceptions: (current.browser.agentPermissions?.exceptions || []).filter((_, i) => i !== index)
                                }
                              }
                            }))}
                          >
                            删除
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                  <div className="inline-actions">
                    <button
                      type="button"
                      onClick={() => setDesktopPreferences((current) => ({
                        ...current,
                        browser: {
                          ...current.browser,
                          agentPermissions: {
                            defaults: current.browser.agentPermissions?.defaults || {
                              browse: "require_approval",
                              download: "require_approval",
                              upload: "require_approval"
                            },
                            exceptions: [
                              ...(current.browser.agentPermissions?.exceptions || []),
                              {
                                origin: "http://127.0.0.1:3000",
                                browse: "always_allow",
                                download: "require_approval",
                                upload: "require_approval"
                              }
                            ]
                          }
                        }
                      }))}
                    >
                      + 添加例外
                    </button>
                  </div>
                </section>
                <section className="settings-card">
                  <h4>开发者模式</h4>
                  <div className="settings-preference-list">
                    <button type="button" onClick={() => setDesktopPreferences((current) => ({ ...current, browser: { ...current.browser, fullCdpAccess: !current.browser.fullCdpAccess } }))}>
                      <span>启用完整 CDP 访问权限（风险升高）</span>
                      <SettingsSwitch enabled={Boolean(desktopPreferences.browser.fullCdpAccess)} />
                    </button>
                  </div>
                  <p className="subtle">完整 Chrome DevTools Protocol 可检查敏感浏览器内部状态；默认关闭。</p>
                  <div className="inline-actions">
                    <button
                      type="button"
                      disabled={!api?.getBrowserCdpAccess}
                      onClick={async () => {
                        const status = await api?.getBrowserCdpAccess?.();
                        setChatStatus(status?.detail || "CDP 状态未知");
                      }}
                    >
                      查看 CDP 状态
                    </button>
                    <button
                      type="button"
                      disabled={!api?.probeBrowserSiteTools}
                      onClick={async () => {
                        const result = await api?.probeBrowserSiteTools?.();
                        setChatStatus(result?.detail || "站点工具探测完成");
                      }}
                    >
                      探测站点工具
                    </button>
                  </div>
                </section>
              </>
            ) : activeSettingsSection === "computer" ? (
              <>
                <div className="settings-page-head">
                  <div><h3>电脑操控</h3><p>读取本机可用系统工具，并从桌面端直接打开。</p></div>
                  <button type="button" onClick={() => api && void api.getSystemTools().then(setSystemTools)}>刷新工具</button>
                </div>
                <section className="settings-card">
                  <div className="mcp-server-list">
                    {systemTools.length > 0 ? (
                      systemTools.map((tool) => (
                        <article key={tool.id} className={`mcp-server-item${tool.available ? " enabled" : ""}`}>
                          <div className="mcp-server-main">
                            <div className="mcp-server-title-row">
                              <strong>{tool.label}</strong>
                              <span className={`settings-status-chip${tool.available ? " connected" : ""}`}>
                                {tool.available ? "可用" : "不可用"}
                              </span>
                            </div>
                            <p>{tool.kind === "developer" ? "开发工具" : "系统工具"} · {tool.icon}</p>
                          </div>
                          <div className="mcp-server-actions">
                            <button
                              type="button"
                              disabled={!api || !tool.available}
                              onClick={async () => {
                                if (!api) return;
                                const result = await api.openSystemTool(tool.id);
                                setChatStatus(result.detail);
                                if (!result.ok) setErrorMessage(result.detail);
                              }}
                            >
                              打开
                            </button>
                          </div>
                        </article>
                      ))
                    ) : (
                      <div className="empty-hint"><p>没有检测到可用的电脑操控工具。点击刷新重新检测。</p></div>
                    )}
                  </div>
                </section>
              </>
            ) : activeSettingsSection === "shortcuts" ? (
              <>
                <div className="settings-page-head">
                  <div><h3>键盘快捷键</h3><p>这些快捷键与顶部菜单和应用导航使用同一套真实命令。</p></div>
                </div>
                <section className="settings-card">
                  <div className="settings-shortcut-list">
                    {[
                      ["new-chat", "新建对话", "Ctrl+N"],
                      ["global-search", "打开全局搜索", "Ctrl+K"],
                      ["open-folder", "打开文件夹", "Ctrl+O"],
                      ["open-settings", "打开设置", "Ctrl+,"],
                      ["toggle-sidebar", "切换侧边栏", "Ctrl+B"],
                      ["toggle-bottom-panel", "切换底部面板", "Ctrl+J"],
                      ["toggle-file-tree", "切换文件树", "Ctrl+Shift+E"],
                      ["open-browser-tab", "打开浏览器标签", "Ctrl+T"],
                      ["find-in-page", "页面内查找", "Ctrl+F"],
                      ["previous-thread", "上一个对话", "Ctrl+Shift+["],
                      ["next-thread", "下一个对话", "Ctrl+Shift+]"],
                      ["back", "后退", "Ctrl+["],
                      ["forward", "前进", "Ctrl+]"],
                      ["actual-size", "实际大小", "Ctrl+0"],
                      ["toggle-fullscreen", "切换全屏", "F11"]
                    ].map(([id, label, shortcut]) => (
                      <div key={id}>
                        <span>{label}</span>
                        <button
                          type="button"
                          className={`shortcut-recorder${recordingShortcut === id ? " recording" : ""}`}
                          title="双击后按下新的快捷键"
                          onDoubleClick={(event) => {
                            event.currentTarget.focus();
                            setRecordingShortcut(id);
                          }}
                          onKeyDown={(event) => {
                            if (recordingShortcut !== id) return;
                            event.preventDefault();
                            event.stopPropagation();
                            if (event.key === "Escape") {
                              setRecordingShortcut("");
                              return;
                            }
                            const nextShortcut = formatShortcutEvent(event.nativeEvent);
                            if (!nextShortcut) return;
                            saveShortcut(id, nextShortcut);
                            setRecordingShortcut("");
                          }}
                        >
                          {recordingShortcut === id ? "按下快捷键..." : (desktopPreferences.shortcuts?.[id] || shortcut)}
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              </>
            ) : activeSettingsSection === "archived" ? (
              <>
                <div className="settings-page-head">
                  <div><h3>已归档对话</h3><p>查看、恢复或删除本地归档线程。</p></div>
                  <button type="button" onClick={async () => {
                    let nextCatalog = workspaceCatalog;
                    if (api) {
                      for (const { workspace, thread } of archivedThreads) {
                        nextCatalog = await api.archiveWorkspaceThread({
                          workspaceId: workspace.id,
                          threadId: thread.id,
                          archived: false,
                          scope: thread.scope === "chat" ? "chat" : "project"
                        });
                      }
                      setWorkspaceCatalog(nextCatalog);
                    }
                    setArchivedThreadIds(new Set());
                  }}>恢复全部</button>
                </div>
                <section className="settings-card">
                  <div className="mcp-server-list">
                    {archivedThreads.length > 0 ? (
                      archivedThreads.map(({ workspace, thread }) => (
                        <article key={`${workspace.id}-${thread.id}`} className="mcp-server-item">
                          <div className="mcp-server-main">
                            <div className="mcp-server-title-row"><strong>{thread.title}</strong><span className="settings-status-chip">已归档</span></div>
                            <p>{workspace.name} · {thread.summary}</p>
                            <span className="mcp-server-meta">{new Date(thread.updatedAt).toLocaleString()}</span>
                          </div>
                          <div className="mcp-server-actions">
                            <button type="button" onClick={async () => {
                              if (api) {
                                const nextCatalog = await api.archiveWorkspaceThread({ workspaceId: workspace.id, threadId: thread.id, archived: false, scope: thread.scope === "chat" ? "chat" : "project" });
                                setWorkspaceCatalog(nextCatalog);
                              }
                              setArchivedThreadIds((current) => {
                                const next = new Set(current);
                                next.delete(thread.id);
                                return next;
                              });
                              setSelectedWorkspaceId(workspace.id);
                              setSelectedThreadId(thread.id);
                              setActiveFeature("new-chat");
                            }}>恢复并打开</button>
                            <button type="button" onClick={async () => {
                              if (api) {
                                const nextCatalog = await api.archiveWorkspaceThread({ workspaceId: workspace.id, threadId: thread.id, archived: false, scope: thread.scope === "chat" ? "chat" : "project" });
                                setWorkspaceCatalog(nextCatalog);
                              }
                              setArchivedThreadIds((current) => {
                                const next = new Set(current);
                                next.delete(thread.id);
                                return next;
                              });
                            }}>恢复</button>
                            <button type="button" disabled={!api || workspace.threads.length <= 1} onClick={async () => {
                              if (!api) return;
                              const nextCatalog = await api.deleteWorkspaceThread({ workspaceId: workspace.id, threadId: thread.id });
                              setWorkspaceCatalog(nextCatalog);
                              setArchivedThreadIds((current) => {
                                const next = new Set(current);
                                next.delete(thread.id);
                                return next;
                              });
                            }}>删除</button>
                          </div>
                        </article>
                      ))
                    ) : (
                      <div className="empty-hint"><p>当前没有已归档对话。</p></div>
                    )}
                  </div>
                </section>
              </>
            ) : null}
          </section>
        </div>
      </div>
    );
  }

  return renderSettingsWorkspace();
}
