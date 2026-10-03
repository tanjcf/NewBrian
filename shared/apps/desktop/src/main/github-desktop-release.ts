/** Catalog published with each desktop GitHub Release. */
export const GITHUB_DESKTOP_RELEASE_CATALOG_URL =
  "https://github.com/tanjcf/NewBrian/releases/latest/download/latest.json";

const RELEASE_DOWNLOAD_PREFIX = "https://github.com/tanjcf/NewBrian/releases/download/";

export function githubDesktopReleasePlatformKey(platform: string, arch: string): string | null {
  if (platform === "win32") return "windows-nsis";
  if (platform === "darwin") return arch === "arm64" ? "macos-arm64" : "macos-x64";
  if (platform === "linux") return arch === "arm64" ? "ubuntu-arm64" : "ubuntu-amd64";
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Pick this operating system's installer. The download URL must be a NewBrian GitHub Release asset. */
export function selectGithubDesktopRelease(catalog: unknown, platform: string, arch: string): unknown {
  if (!isRecord(catalog)) return { available: false };
  const key = githubDesktopReleasePlatformKey(platform, arch);
  const platforms = isRecord(catalog.platforms) ? catalog.platforms : null;
  const entry = key && platforms && isRecord(platforms[key]) ? platforms[key] : null;
  const downloadUrl = String((entry?.download_url ?? (platform === "win32" ? catalog.download_url : "")) || "").trim();
  if (!downloadUrl.startsWith(RELEASE_DOWNLOAD_PREFIX)) return { available: false };
  if (!entry && platform !== "win32") return { available: false };
  return {
    ...catalog,
    available: catalog.available !== false,
    download_url: downloadUrl,
    sha256: String(entry?.sha256 ?? catalog.sha256 ?? "").trim(),
    package_kind: String(entry?.package_kind ?? catalog.package_kind ?? "").trim()
  };
}

export async function fetchGithubDesktopRelease(options?: {
  fetchImpl?: typeof fetch;
  platform?: string;
  arch?: string;
}): Promise<unknown> {
  const fetchImpl = options?.fetchImpl ?? fetch;
  const response = await fetchImpl(GITHUB_DESKTOP_RELEASE_CATALOG_URL, {
    method: "GET",
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) {
    throw new Error(`GitHub desktop release failed: HTTP ${response.status}`);
  }
  return selectGithubDesktopRelease(
    await response.json(),
    options?.platform ?? process.platform,
    options?.arch ?? process.arch
  );
}
