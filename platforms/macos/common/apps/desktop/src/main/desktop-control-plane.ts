export type DesktopControlPlaneEnvelope = {
  protocol_version?: string;
  minimum_client_version?: string;
  generated_at?: string;
  [key: string]: unknown;
};

export type DesktopControlPlaneState = {
  version: 1;
  status: "ready";
  gateway_origin: string;
  protocol_version: string;
  minimum_client_version: string;
  client_version: string;
  synced_at: string;
  bootstrap: DesktopControlPlaneEnvelope;
  model_config: DesktopControlPlaneEnvelope;
  capabilities: DesktopControlPlaneEnvelope;
};

type FetchLike = typeof fetch;

export function isLoopbackGatewayBaseUrl(value: unknown): boolean {
  const raw = String(value ?? "").trim();
  if (!raw) return false;
  try {
    const host = new URL(raw).hostname.toLowerCase();
    return host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]";
  } catch {
    return /127\.0\.0\.1|localhost/i.test(raw);
  }
}

/** Domains that used to be package defaults but are parked/blocked and cannot reach the model gateway. */
export function isRetiredGatewayBaseUrl(value: unknown): boolean {
  const raw = String(value ?? "").trim();
  if (!raw) return false;
  try {
    const host = new URL(raw).hostname.toLowerCase();
    return host === "test.wangjietech.com" || host === "api.wangjietech.com" || host === "www.wangjietech.com";
  } catch {
    return /wangjietech\.com/i.test(raw);
  }
}

/** The shared test gateway. Production packages must not file exception tickets here. */
export function isTestEnvironmentGatewayBaseUrl(value: unknown): boolean {
  const raw = String(value ?? "").trim();
  if (!raw) return false;
  try {
    return new URL(raw).hostname.toLowerCase() === "203.0.113.10";
  } catch {
    return raw.includes("203.0.113.10");
  }
}

function preferProductionGateway(
  candidate: string,
  input: { isPackaged: boolean; productionBaseUrl: string }
): string {
  const production = String(input.productionBaseUrl ?? "").trim();
  if (
    input.isPackaged
    && production
    && !isTestEnvironmentGatewayBaseUrl(production)
    && !isLoopbackGatewayBaseUrl(production)
    && !isRetiredGatewayBaseUrl(production)
    && isTestEnvironmentGatewayBaseUrl(candidate)
  ) {
    return production;
  }
  return candidate;
}

export function migrateLegacyGatewayBaseUrl(configuredBaseUrl: unknown, bundledBaseUrl: unknown): string {
  const configured = String(configuredBaseUrl ?? "").trim();
  const bundled = String(bundledBaseUrl ?? "").trim();
  // Packaged MSI ships a production gateway. Never leave end-user configs on
  // loopback when a non-local bundled endpoint is available. Local developers
  // can still force localhost via NEWBRAIN_MODEL_BASE_URL.
  if (!configured) return bundled;
  if (
    (isLoopbackGatewayBaseUrl(configured) || isRetiredGatewayBaseUrl(configured))
    && bundled
    && !isLoopbackGatewayBaseUrl(bundled)
    && !isRetiredGatewayBaseUrl(bundled)
  ) {
    return bundled;
  }
  return configured;
}

/**
 * Resolve the gateway URL used for model/auth traffic.
 * Packaged installs never keep loopback or the shared test gateway when the
 * compiled production endpoint is a different host. Development builds and
 * test-channel packages may still use the test gateway.
 */
export function resolveEffectiveGatewayBaseUrl(input: {
  configuredBaseUrl?: unknown;
  bundledBaseUrl?: unknown;
  envBaseUrl?: unknown;
  isPackaged: boolean;
  productionBaseUrl: string;
}): string {
  const env = String(input.envBaseUrl ?? "").trim();
  if (env) return preferProductionGateway(env, input);
  const configured = String(input.configuredBaseUrl ?? "").trim();
  if (!input.isPackaged && configured) return configured;
  const bundled = String(input.bundledBaseUrl ?? "").trim();
  const migrationTarget = bundled && !isLoopbackGatewayBaseUrl(bundled)
    ? bundled
    : (input.isPackaged ? input.productionBaseUrl : bundled || input.productionBaseUrl);
  const migrated = migrateLegacyGatewayBaseUrl(input.configuredBaseUrl, migrationTarget);
  if (input.isPackaged && (isLoopbackGatewayBaseUrl(migrated) || isRetiredGatewayBaseUrl(migrated))) {
    return input.productionBaseUrl;
  }
  return preferProductionGateway(
    migrated || (input.isPackaged ? input.productionBaseUrl : migrationTarget),
    input
  );
}

function versionParts(value: string) {
  const normalized = value.trim().replace(/^v/i, "").split("-", 1)[0];
  const parts = normalized.split(".").map((part) => Number.parseInt(part, 10));
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

export function compareVersions(left: string, right: string) {
  const leftParts = versionParts(left);
  const rightParts = versionParts(right);
  for (let index = 0; index < 3; index += 1) {
    const difference = leftParts[index] - rightParts[index];
    if (difference !== 0) return difference;
  }
  return 0;
}

function isCurrentPreOneReleaseAccepted(clientVersion: string, minimumClientVersion: string) {
  return compareVersions(clientVersion, "0.1.9") >= 0
    && versionParts(clientVersion)[0] === 0
    && compareVersions(minimumClientVersion, "1.0.0") <= 0;
}

async function fetchEnvelope(
  fetchImpl: FetchLike,
  url: string,
  headers: Record<string, string>
): Promise<DesktopControlPlaneEnvelope> {
  const response = await fetchImpl(url, { method: "GET", headers });
  const raw = await response.text();
  let payload: unknown = null;
  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    throw new Error(`控制面返回了无效 JSON：${url}`);
  }
  if (!response.ok) {
    const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
    const message = String(record.message || record.detail || `HTTP ${response.status}`);
    throw new Error(`控制面请求失败：${message}`);
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error(`控制面返回了无效对象：${url}`);
  }
  return payload as DesktopControlPlaneEnvelope;
}

export async function syncDesktopControlPlane(input: {
  gatewayOrigin: string;
  accessToken: string;
  clientVersion: string;
  deviceId?: string;
  platform?: string;
  headers?: Record<string, string>;
  fetchImpl?: FetchLike;
  now?: () => string;
}): Promise<DesktopControlPlaneState> {
  const gatewayOrigin = new URL(input.gatewayOrigin).origin;
  const releasePlatform = (() => {
    const raw = String(input.platform ?? input.headers?.["X-Desktop-Platform"] ?? "").trim().toLowerCase();
    if (raw === "darwin" || raw === "macos" || raw === "osx" || raw === "mac") return "macos";
    if (raw === "linux") return "linux";
    if (raw === "windows" || raw === "win32" || raw === "win") return "windows";
    return "windows";
  })();
  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: `Bearer ${input.accessToken}`,
    "X-Desktop-App-Version": input.clientVersion,
    "X-Desktop-Platform": releasePlatform
  };
  if (input.deviceId?.trim()) {
    headers["X-Device-ID"] = input.deviceId.trim();
  }
  Object.assign(headers, input.headers ?? {});
  if (!headers["X-Desktop-Platform"]?.trim()) {
    headers["X-Desktop-Platform"] = releasePlatform;
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const [bootstrap, modelConfig, capabilities] = await Promise.all([
    fetchEnvelope(fetchImpl, `${gatewayOrigin}/api/desktop/v1/bootstrap`, headers),
    fetchEnvelope(fetchImpl, `${gatewayOrigin}/api/desktop/v1/model-config`, headers),
    fetchEnvelope(fetchImpl, `${gatewayOrigin}/api/desktop/v1/capabilities`, headers)
  ]);

  try {
    const appUpdate = await fetchEnvelope(fetchImpl, `${gatewayOrigin}/api/desktop/v1/app-update`, headers);
    if (appUpdate.available === true && String(appUpdate.latest_version || "").trim() && String(appUpdate.download_url || "").trim()) {
      bootstrap.app_release = {
        latest_version: appUpdate.latest_version,
        download_url: appUpdate.download_url,
        sha256: appUpdate.sha256,
        notes: appUpdate.notes,
        mandatory: appUpdate.mandatory === true,
        release_id: appUpdate.release_id,
        channel: appUpdate.channel,
        // Keep package_kind so clients can distinguish ulit.msi / ulit.zip / full MSI.
        package_kind: appUpdate.package_kind ?? appUpdate.packageKind
      };
    }
  } catch {
    // Keep bootstrap.app_release fallback when the dedicated update endpoint is unavailable.
  }

  const protocolVersion = String(bootstrap.protocol_version || "");
  const minimumClientVersion = String(bootstrap.minimum_client_version || "");
  if (versionParts(protocolVersion)[0] !== 1) {
    throw new Error(`不支持的桌面控制面协议版本：${protocolVersion || "missing"}`);
  }
  if (
    minimumClientVersion
    && compareVersions(input.clientVersion, minimumClientVersion) < 0
    && !isCurrentPreOneReleaseAccepted(input.clientVersion, minimumClientVersion)
  ) {
    throw new Error(`NewBrain ${input.clientVersion} 低于服务端最低版本 ${minimumClientVersion}`);
  }

  for (const payload of [modelConfig, capabilities]) {
    if (String(payload.protocol_version || "") !== protocolVersion) {
      throw new Error("桌面控制面端点返回了不一致的协议版本");
    }
  }

  return {
    version: 1,
    status: "ready",
    gateway_origin: gatewayOrigin,
    protocol_version: protocolVersion,
    minimum_client_version: minimumClientVersion,
    client_version: input.clientVersion,
    synced_at: (input.now ?? (() => new Date().toISOString()))(),
    bootstrap,
    model_config: modelConfig,
    capabilities
  };
}
