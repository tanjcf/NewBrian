import assert from "node:assert/strict";
import test from "node:test";

const controlPlane = import(new URL("./desktop-control-plane.ts", import.meta.url).href) as Promise<
  typeof import("./desktop-control-plane.js")
>;

test("compares desktop semantic versions", () => {
  return controlPlane.then(({ compareVersions }) => {
  assert.equal(compareVersions("0.1.0", "0.1.0"), 0);
  assert.ok(compareVersions("0.2.0", "0.1.9") > 0);
  assert.ok(compareVersions("0.1.0", "1.0.0") < 0);
  });
});

test("replaces loopback gateway with the bundled production endpoint", async () => {
  const { migrateLegacyGatewayBaseUrl, resolveEffectiveGatewayBaseUrl } = await controlPlane;
  assert.equal(
    migrateLegacyGatewayBaseUrl(`http://127.0.0.1${":8790"}/v1`, "http://203.0.113.10:8790/v1"),
    "http://203.0.113.10:8790/v1"
  );
  assert.equal(
    migrateLegacyGatewayBaseUrl("http://localhost:8790/v1", "http://203.0.113.10:8790/v1"),
    "http://203.0.113.10:8790/v1"
  );
  assert.equal(
    migrateLegacyGatewayBaseUrl("", "http://203.0.113.10:8790/v1"),
    "http://203.0.113.10:8790/v1"
  );
  assert.equal(
    migrateLegacyGatewayBaseUrl("http://203.0.113.10:8790/v1", "http://203.0.113.10:8790/v1"),
    "http://203.0.113.10:8790/v1"
  );
  // Keep an explicit non-local custom gateway.
  assert.equal(
    migrateLegacyGatewayBaseUrl("https://gateway.example/v1", "http://203.0.113.10:8790/v1"),
    "https://gateway.example/v1"
  );
  assert.equal(
    migrateLegacyGatewayBaseUrl("https://test.wangjietech.com/v1", "http://203.0.113.10:8790/v1"),
    "http://203.0.113.10:8790/v1"
  );
  assert.equal(
    resolveEffectiveGatewayBaseUrl({
      configuredBaseUrl: "https://api.wangjietech.com/v1",
      bundledBaseUrl: "https://api.wangjietech.com/v1",
      isPackaged: true,
      productionBaseUrl: "http://203.0.113.10:8790/v1"
    }),
    "http://203.0.113.10:8790/v1"
  );
  // Packaged installs never keep loopback even when the bundled resource is also loopback.
  assert.equal(
    resolveEffectiveGatewayBaseUrl({
      configuredBaseUrl: "http://127.0.0.1:8790/v1",
      bundledBaseUrl: "http://127.0.0.1:8790/v1",
      isPackaged: true,
      productionBaseUrl: "http://203.0.113.10:8790/v1"
    }),
    "http://203.0.113.10:8790/v1"
  );
  // Packaged installs must ignore a stale developer loopback override.
  assert.equal(
    resolveEffectiveGatewayBaseUrl({
      configuredBaseUrl: "http://203.0.113.10:8790/v1",
      bundledBaseUrl: "http://203.0.113.10:8790/v1",
      envBaseUrl: "http://127.0.0.1:8790/v1",
      isPackaged: true,
      productionBaseUrl: "http://203.0.113.10:8790/v1"
    }),
    "http://203.0.113.10:8790/v1"
  );
  // A packaged deployment may still explicitly select another non-local gateway.
  assert.equal(
    resolveEffectiveGatewayBaseUrl({
      configuredBaseUrl: "http://203.0.113.10:8790/v1",
      bundledBaseUrl: "http://203.0.113.10:8790/v1",
      envBaseUrl: "https://gateway.example/v1",
      isPackaged: true,
      productionBaseUrl: "http://203.0.113.10:8790/v1"
    }),
    "https://gateway.example/v1"
  );
});

test("packaged production builds file traffic on the production gateway instead of the test gateway", async () => {
  const { resolveEffectiveGatewayBaseUrl } = await controlPlane;
  const productionBaseUrl = "https://api.sinnauze.cn/v1";
  const testBaseUrl = "http://203.0.113.10:8790/v1";
  assert.equal(
    resolveEffectiveGatewayBaseUrl({
      configuredBaseUrl: testBaseUrl,
      bundledBaseUrl: testBaseUrl,
      isPackaged: true,
      productionBaseUrl
    }),
    productionBaseUrl
  );
  assert.equal(
    resolveEffectiveGatewayBaseUrl({
      configuredBaseUrl: productionBaseUrl,
      bundledBaseUrl: testBaseUrl,
      envBaseUrl: testBaseUrl,
      isPackaged: true,
      productionBaseUrl
    }),
    productionBaseUrl
  );
  assert.equal(
    resolveEffectiveGatewayBaseUrl({
      configuredBaseUrl: testBaseUrl,
      bundledBaseUrl: testBaseUrl,
      isPackaged: true,
      productionBaseUrl: testBaseUrl
    }),
    testBaseUrl
  );
  assert.equal(
    resolveEffectiveGatewayBaseUrl({
      configuredBaseUrl: testBaseUrl,
      bundledBaseUrl: productionBaseUrl,
      isPackaged: false,
      productionBaseUrl
    }),
    testBaseUrl
  );
});

test("development builds preserve an explicit loopback gateway", async () => {
  const { resolveEffectiveGatewayBaseUrl } = await controlPlane;
  assert.equal(
    resolveEffectiveGatewayBaseUrl({
      configuredBaseUrl: "http://127.0.0.1:8790/v1",
      bundledBaseUrl: "http://203.0.113.10:8790/v1",
      isPackaged: false,
      productionBaseUrl: "https://api.example.com/v1"
    }),
    "http://127.0.0.1:8790/v1"
  );
  assert.equal(
    resolveEffectiveGatewayBaseUrl({
      configuredBaseUrl: "https://gateway.example/v1",
      bundledBaseUrl: "http://203.0.113.10:8790/v1",
      envBaseUrl: "http://127.0.0.1:8790/v1",
      isPackaged: false,
      productionBaseUrl: "https://api.example.com/v1"
    }),
    "http://127.0.0.1:8790/v1"
  );
});

test("synchronizes the authenticated v1 control plane without persisting credentials", async () => {
  const { syncDesktopControlPlane } = await controlPlane;
  const requested: Array<{
    url: string;
    authorization: string | null;
    platform: string | null;
    packagePreference: string | null;
  }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    requested.push({
      url,
      authorization: headers.get("Authorization"),
      platform: headers.get("X-Desktop-Platform"),
      packagePreference: headers.get("X-Desktop-Package-Preference")
    });
    const body = url.endsWith("/bootstrap")
      ? { protocol_version: "1.0", minimum_client_version: "0.1.0", skills: [] }
      : { protocol_version: "1.0", minimum_client_version: "0.1.0" };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };

  const state = await syncDesktopControlPlane({
    gatewayOrigin: "http://203.0.113.10:8790/v1",
    accessToken: "secret-token",
    clientVersion: "0.1.0",
    platform: "win32",
    packagePreference: "nsis",
    fetchImpl,
    now: () => "2026-06-30T00:00:00.000Z"
  });

  assert.equal(requested.length, 4);
  assert.ok(requested.every((request) => request.authorization === "Bearer secret-token"));
  assert.ok(requested.every((request) => request.platform === "windows"));
  assert.ok(requested.every((request) => request.packagePreference === "nsis"));
  assert.ok(requested.some((request) => request.url.endsWith("/api/desktop/v1/app-update")));
  assert.equal(state.gateway_origin, "http://203.0.113.10:8790");
  assert.equal(state.protocol_version, "1.0");
  assert.equal(JSON.stringify(state).includes("secret-token"), false);
});

test("accepts the current pre-1.0 desktop release against a 1.0.0 server floor", async () => {
  const { syncDesktopControlPlane } = await controlPlane;
  const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({
    protocol_version: "1.0",
    minimum_client_version: "1.0.0"
  }), { status: 200 });

  const state = await syncDesktopControlPlane({
    gatewayOrigin: "http://203.0.113.10:8790",
    accessToken: "token",
    clientVersion: "0.1.9",
    fetchImpl
  });

  assert.equal(state.minimum_client_version, "1.0.0");
});

test("rejects an incompatible minimum client version", async () => {
  const { syncDesktopControlPlane } = await controlPlane;
  const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({
    protocol_version: "1.0",
    minimum_client_version: "1.0.0"
  }), { status: 200 });

  await assert.rejects(
    syncDesktopControlPlane({
      gatewayOrigin: "http://203.0.113.10:8790",
      accessToken: "token",
      clientVersion: "0.1.0",
      fetchImpl
    }),
    /低于服务端最低版本/
  );
});

test("caches stable app-update offers and clears them when unavailable", async () => {
  const { syncDesktopControlPlane } = await controlPlane;
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/bootstrap")) {
      return new Response(JSON.stringify({
        protocol_version: "1.0",
        minimum_client_version: "0.1.0",
        app_release: {
          latest_version: "1.4.10",
          download_url: "http://example.test/old.msi",
          sha256: "abc"
        }
      }), { status: 200 });
    }
    if (url.endsWith("/app-update")) {
      return new Response(JSON.stringify({
        available: true,
        latest_version: "1.4.12",
        download_url: "http://example.test/NewBrain-1.4.12-setup.exe",
        sha256: "def",
        channel: "stable",
        release_id: "rel_test",
        package_kind: "nsis"
      }), { status: 200 });
    }
    return new Response(JSON.stringify({
      protocol_version: "1.0",
      minimum_client_version: "0.1.0"
    }), { status: 200 });
  };

  const withOffer = await syncDesktopControlPlane({
    gatewayOrigin: "http://203.0.113.10:8790",
    accessToken: "token",
    clientVersion: "1.4.11",
    fetchImpl
  });
  assert.equal(withOffer.bootstrap.app_release?.latest_version, "1.4.12");
  assert.equal(withOffer.bootstrap.app_release?.channel, "stable");

  const clearFetch: typeof fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/bootstrap")) {
      return new Response(JSON.stringify({
        protocol_version: "1.0",
        minimum_client_version: "0.1.0",
        app_release: {
          latest_version: "1.4.12",
          download_url: "http://example.test/NewBrain-1.4.12-setup.exe",
          sha256: "def"
        }
      }), { status: 200 });
    }
    if (url.endsWith("/app-update")) {
      return new Response(JSON.stringify({
        available: false,
        detail: "当前已是可用版本，或服务端尚未发布更新包。"
      }), { status: 200 });
    }
    return new Response(JSON.stringify({
      protocol_version: "1.0",
      minimum_client_version: "0.1.0"
    }), { status: 200 });
  };

  const cleared = await syncDesktopControlPlane({
    gatewayOrigin: "http://203.0.113.10:8790",
    accessToken: "token",
    clientVersion: "1.4.12",
    fetchImpl: clearFetch
  });
  assert.equal(cleared.bootstrap.app_release, undefined);
});
