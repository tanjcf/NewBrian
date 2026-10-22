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

test("synchronizes the authenticated v1 control plane without persisting credentials", async () => {
  const { syncDesktopControlPlane } = await controlPlane;
  const requested: Array<{ url: string; authorization: string | null }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    requested.push({ url, authorization: headers.get("Authorization") });
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
    fetchImpl,
    now: () => "2026-06-30T00:00:00.000Z"
  });

  assert.equal(requested.length, 3);
  assert.ok(requested.every((request) => request.authorization === "Bearer secret-token"));
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
