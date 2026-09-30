import type { PluginAction, PluginCatalogItem, PluginCatalogQuery, PluginCatalogSnapshot, PluginInstallState, PluginScope } from "@codex-forge/protocol";

type FetchLike = typeof fetch;
type JsonRecord = Record<string, unknown>;

export interface PluginManifest {
  plugin_key: string; version: string; content_hash: string; signature: string;
  signing_public_key: string; archive_size: number; minimum_client_version?: string;
  maximum_client_version?: string; download_url?: string; skills?: string[];
}

export interface PluginInstallationReport {
  status: "installed" | "disabled" | "failed" | "removed";
  version: string; content_hash: string; client_version: string; reported_at: string;
  error_code?: string; error_message?: string;
}

function record(value: unknown, message: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
  return value as JsonRecord;
}

function text(value: unknown, field: string) {
  if (typeof value !== "string") throw new Error("invalid plugin catalog field: " + field);
  return value;
}

function stringList(value: unknown, field: string) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error("invalid plugin catalog field: " + field);
  }
  return value as string[];
}

function catalogItem(value: unknown): PluginCatalogItem {
  const item = record(value, "invalid plugin catalog item");
  const scope = text(item.scope, "scope");
  const state = text(item.install_state, "install_state");
  if (!["public", "private"].includes(scope) || ![
    "not_installed", "installed", "disabled", "failed", "removed",
    "update_available", "installed_pending_report"
  ].includes(state)) throw new Error("invalid plugin catalog state");
  return {
    plugin_key: text(item.plugin_key, "plugin_key"),
    display_name: text(item.display_name, "display_name"),
    description: text(item.description, "description"),
    category: text(item.category, "category"),
    publisher: text(item.publisher, "publisher"),
    scope: scope as PluginScope,
    icon_url: typeof item.icon_url === "string" ? item.icon_url : "",
    install_state: state as PluginInstallState,
    installed_version: typeof item.installed_version === "string" ? item.installed_version : "",
    latest_version: typeof item.latest_version === "string" ? item.latest_version : "",
    actions: stringList(item.actions ?? [], "actions") as PluginAction[],
    skills: stringList(item.skills ?? [], "skills")
  };
}

export class PluginRepositoryClient {
  private readonly origin: string;
  private readonly headers: Record<string, string>;
  private readonly fetchImpl: FetchLike;

  constructor(input: { gatewayOrigin: string; headers: Record<string, string>; fetchImpl?: FetchLike }) {
    this.origin = new URL(input.gatewayOrigin).origin;
    this.headers = { Accept: "application/json", ...input.headers };
    this.fetchImpl = input.fetchImpl ?? fetch;
  }

  async list(query: PluginCatalogQuery, deviceId: string): Promise<PluginCatalogSnapshot> {
    const parameters = new URLSearchParams();
    if (query.scope) parameters.set("scope", query.scope);
    if (query.category?.trim()) parameters.set("category", query.category.trim());
    if (query.keyword?.trim()) parameters.set("keyword", query.keyword.trim());
    parameters.set("device_id", deviceId);
    parameters.set("page", String(query.page ?? 1));
    parameters.set("size", String(query.pageSize ?? 20));
    const payload = record(await this.json("/api/desktop/v1/plugins?" + parameters), "invalid plugin catalog");
    if (!Array.isArray(payload.items)) throw new Error("invalid plugin catalog items");
    const items = payload.items.map(catalogItem);
    return {
      items,
      categories: [...new Set(items.map((item) => item.category).filter(Boolean))],
      page: Number(payload.page ?? 1),
      page_size: Number(payload.size ?? payload.page_size ?? query.pageSize ?? 20),
      total: Number(payload.total ?? items.length)
    };
  }

  detail(pluginKey: string, deviceId: string) {
    return this.json("/api/desktop/v1/plugins/" + encodeURIComponent(pluginKey) + "?device_id=" + encodeURIComponent(deviceId));
  }

  async manifest(pluginKey: string, version = ""): Promise<PluginManifest> {
    const suffix = version ? "?version=" + encodeURIComponent(version) : "";
    const value = record(await this.json("/api/desktop/v1/plugins/" + encodeURIComponent(pluginKey) + "/manifest" + suffix), "invalid plugin manifest");
    for (const field of ["plugin_key", "version", "content_hash", "signature", "signing_public_key"]) text(value[field], field);
    if (!Number.isFinite(Number(value.archive_size))) throw new Error("invalid plugin manifest archive_size");
    return value as unknown as PluginManifest;
  }

  download(pluginKey: string, version: string) {
    return this.downloadUrl(this.origin + "/api/desktop/v1/plugins/" + encodeURIComponent(pluginKey) + "/download?version=" + encodeURIComponent(version));
  }

  async downloadUrl(url: string) {
    const resolved = new URL(url, this.origin);
    if (resolved.origin !== this.origin) throw new Error("plugin download must use the same origin");
    const response = await this.fetchImpl(resolved, { method: "GET", headers: this.headers });
    if (!response.ok) throw await this.httpError(response);
    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      contentHash: response.headers.get("X-Content-SHA256") ?? "",
      signature: response.headers.get("X-Content-Signature")?.replace(/^ed25519:/i, "") ?? ""
    };
  }

  reconcile(deviceId: string) {
    return this.json("/api/desktop/v1/devices/" + encodeURIComponent(deviceId) + "/plugins");
  }

  report(deviceId: string, pluginKey: string, report: PluginInstallationReport) {
    return this.json("/api/desktop/v1/devices/" + encodeURIComponent(deviceId) + "/plugins/" + encodeURIComponent(pluginKey), {
      method: "PUT", body: JSON.stringify(report), headers: { "Content-Type": "application/json" }
    });
  }

  private async json(path: string, init: RequestInit = {}) {
    const response = await this.fetchImpl(new URL(path, this.origin), {
      ...init, headers: { ...this.headers, ...(init.headers as Record<string, string> | undefined) }
    });
    const raw = await response.text();
    let payload: unknown;
    try { payload = raw ? JSON.parse(raw) : {}; } catch { throw new Error("plugin repository returned invalid JSON"); }
    if (!response.ok) throw await this.httpError(response, payload);
    return payload;
  }

  private async httpError(response: Response, knownPayload?: unknown) {
    let payload = knownPayload;
    if (payload === undefined) {
      try { payload = JSON.parse(await response.text()); } catch { payload = {}; }
    }
    const value = payload && typeof payload === "object" ? payload as JsonRecord : {};
    const code = typeof value.code === "string" ? value.code : "HTTP_" + response.status;
    const message = typeof value.message === "string" ? value.message : "HTTP " + response.status;
    return new Error(code + ": " + message);
  }
}
