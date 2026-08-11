export interface DesktopAuthApiUser {
  id?: string;
  name?: string;
  email?: string;
  idp?: string;
  iat?: number;
  amr?: string[];
  acr?: string;
  mfa?: boolean;
  role?: string;
}

export interface DesktopAuthApiAccount {
  id?: string;
  planType?: string;
  structure?: string;
  isConversationClassifierEnabledForWorkspace?: boolean;
  isFinservEnabledWorkspace?: boolean;
  isFedrampCompliantWorkspace?: boolean;
  isDelinquent?: boolean;
  residencyRegion?: string;
  computeResidency?: string;
}

export interface DesktopAuthUserState {
  id?: string;
  email?: string;
  display_name?: string;
  idp?: string;
  iat?: number;
  amr?: string[];
  acr?: string;
  mfa?: boolean;
  role?: string;
  plan?: string;
  avatar_text?: string;
}

function computeAvatarText(value: string) {
  const normalized = value.trim();
  if (!normalized) return "未";
  return (Array.from(normalized)[0] ?? "U").toUpperCase();
}

export function maskEmail(value: string) {
  const trimmed = value.trim().toLowerCase();
  const separatorIndex = trimmed.indexOf("@");
  if (separatorIndex <= 1) return trimmed ? "***" : "";
  return `${trimmed.slice(0, Math.min(2, separatorIndex))}***${trimmed.slice(separatorIndex)}`;
}

function inferPlanLabel(role: string) {
  return role.trim().toLowerCase() === "admin" ? "管理员" : "已登录";
}

export function buildDesktopAuthUser(input?: DesktopAuthUserState) {
  const email = input?.email?.trim() || "";
  const displayName = input?.display_name?.trim() || email || "用户";
  const role = input?.role?.trim() || "user";
  return {
    id: input?.id?.trim() || "",
    email,
    display_name: displayName,
    idp: input?.idp?.trim() || "",
    iat: typeof input?.iat === "number" ? input.iat : undefined,
    amr: Array.isArray(input?.amr) ? input.amr.filter((item): item is string => typeof item === "string") : [],
    acr: input?.acr?.trim() || "",
    mfa: Boolean(input?.mfa),
    role,
    plan: input?.plan?.trim() || inferPlanLabel(role),
    avatar_text: input?.avatar_text?.trim() || computeAvatarText(displayName || email || role)
  };
}

export function buildDesktopAuthUserFromApi(payloadUser?: DesktopAuthApiUser, fallbackEmail = "") {
  return buildDesktopAuthUser({
    id: typeof payloadUser?.id === "string" ? payloadUser.id : "",
    email: typeof payloadUser?.email === "string" ? payloadUser.email : fallbackEmail,
    display_name: typeof payloadUser?.name === "string"
      ? payloadUser.name
      : typeof payloadUser?.email === "string" ? payloadUser.email : fallbackEmail,
    idp: typeof payloadUser?.idp === "string" ? payloadUser.idp : "",
    iat: typeof payloadUser?.iat === "number" ? payloadUser.iat : undefined,
    amr: Array.isArray(payloadUser?.amr) ? payloadUser.amr.filter((item): item is string => typeof item === "string") : [],
    acr: typeof payloadUser?.acr === "string" ? payloadUser.acr : "",
    mfa: Boolean(payloadUser?.mfa),
    role: typeof payloadUser?.role === "string" ? payloadUser.role : "user"
  });
}

export function buildDesktopAuthAccountFromApi(payloadAccount?: DesktopAuthApiAccount) {
  if (!payloadAccount) return undefined;
  return {
    id: typeof payloadAccount.id === "string" ? payloadAccount.id : "",
    plan_type: typeof payloadAccount.planType === "string" ? payloadAccount.planType : "",
    structure: typeof payloadAccount.structure === "string" ? payloadAccount.structure : "",
    conversation_classifier_enabled: Boolean(payloadAccount.isConversationClassifierEnabledForWorkspace),
    finserv_enabled: Boolean(payloadAccount.isFinservEnabledWorkspace),
    fedramp_compliant: Boolean(payloadAccount.isFedrampCompliantWorkspace),
    delinquent: Boolean(payloadAccount.isDelinquent),
    residency_region: typeof payloadAccount.residencyRegion === "string" ? payloadAccount.residencyRegion : "",
    compute_residency: typeof payloadAccount.computeResidency === "string" ? payloadAccount.computeResidency : ""
  };
}

export function extractDesktopAuthErrorMessage(payload: unknown, status: number) {
  const record = payload as Record<string, unknown> | null;
  const code = typeof record?.code === "string" ? record.code : "";
  const message = typeof record?.message === "string" ? record.message : `认证失败 (${status})`;
  const detail = typeof record?.detail === "string" ? record.detail : typeof record?.error === "string" ? record.error : "";
  const requestId = typeof record?.request_id === "string" ? record.request_id : "";
  const segments = [code ? `${code}: ${message}` : message];
  if (detail && detail !== message) segments.push(detail);
  if (requestId) segments.push(`request_id=${requestId}`);
  return segments.join(" | ");
}

export function normalizeConnectionErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes("fetch failed") ? "无法连接认证服务，请检查网络或服务器地址。" : message;
}

export function isRetryableModelGatewayError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const cause = typeof error === "object" && error !== null && "cause" in error
    ? (error as { cause?: unknown }).cause
    : undefined;
  const causeCode = typeof cause === "object" && cause !== null && "code" in cause
    ? String((cause as { code?: unknown }).code ?? "")
    : "";
  const causeMessage = cause instanceof Error ? cause.message : typeof cause === "string" ? cause : "";
  const haystack = `${message}\n${causeCode}\n${causeMessage}`;
  return /HTTP\s+(?:429|500|502|503|504)\b|可重试|retry|timeout|timed out|aborted due to timeout|fetch failed|failed to fetch|econnreset|econnrefused|enotfound|eai_again|und_err_connect_timeout|und_err_headers_timeout|und_err_body_timeout|无法连接模型网关|连接模型网关超时|stream inactive|did not include assistant content or tool calls|stream ended before a terminal event/i.test(haystack);
}

export function createCookieHeaderFromSetCookie(setCookies: string[]) {
  const pairs = new Map<string, string>();
  for (const cookie of setCookies) {
    const [firstPart] = cookie.split(";");
    const separatorIndex = firstPart.indexOf("=");
    if (separatorIndex <= 0) continue;
    const name = firstPart.slice(0, separatorIndex).trim();
    const value = firstPart.slice(separatorIndex + 1).trim();
    if (name) pairs.set(name, value);
  }
  return [...pairs.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

export function readSetCookieHeaders(response: Pick<Response, "headers">) {
  const rawHeaders = response.headers as Headers & {
    getSetCookie?: () => string[];
    raw?: () => Record<string, string[]>;
  };
  if (typeof rawHeaders.getSetCookie === "function") return rawHeaders.getSetCookie();
  if (typeof rawHeaders.raw === "function") return rawHeaders.raw()["set-cookie"] ?? [];
  const single = response.headers.get("set-cookie");
  return single ? [single] : [];
}
