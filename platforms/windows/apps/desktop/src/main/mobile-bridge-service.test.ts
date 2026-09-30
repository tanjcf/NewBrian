import assert from "node:assert/strict";
import test from "node:test";

const { MobileBridgeService } = await import(
  new URL("./mobile-bridge-service.ts", import.meta.url).href
);

test("serves a bounded authenticated mobile projection and forwards actions", async () => {
  const actions: unknown[] = [];
  const service = new MobileBridgeService({
    getLocalAddress: () => "127.0.0.1",
    getProjection: async () => ({
      projects: [{ id: "workspace-1", name: "Workspace" }],
      chats: [{ id: "thread-1", workspaceId: "workspace-1", title: "Thread", status: "" }]
    }),
    onAction: (action: unknown) => actions.push(action)
  });
  try {
    const pairing = await service.start();
    const pairingUrl = new URL(pairing.url);
    // The pairing URL/QR must NOT contain the six-digit code (second factor).
    assert.equal(pairingUrl.searchParams.get("code"), null);
    // The page loads with only the token so the user can enter the code.
    assert.equal((await fetch(pairingUrl)).status, 200);

    // Data endpoints require the code; token alone is rejected.
    const unauthorizedStateUrl = new URL("/api/state", pairingUrl);
    unauthorizedStateUrl.search = pairingUrl.search;
    assert.equal((await fetch(unauthorizedStateUrl)).status, 403);

    // A wrong code is rejected.
    const wrongCodeUrl = new URL("/api/state", pairingUrl);
    wrongCodeUrl.search = pairingUrl.search;
    wrongCodeUrl.searchParams.set("code", "000000");
    assert.equal((await fetch(wrongCodeUrl)).status, 403);

    const authorizedSearch = `${pairingUrl.search}&code=${encodeURIComponent(pairing.code)}`;
    const stateUrl = new URL("/api/state", pairingUrl);
    stateUrl.search = authorizedSearch;
    const stateResponse = await fetch(stateUrl);
    assert.equal(stateResponse.status, 200);
    assert.deepEqual(await stateResponse.json(), {
      projects: [{ id: "workspace-1", name: "Workspace" }],
      chats: [{ id: "thread-1", workspaceId: "workspace-1", title: "Thread", status: "" }]
    });

    const actionUrl = new URL("/api/action", pairingUrl);
    actionUrl.search = authorizedSearch;
    const actionResponse = await fetch(actionUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "new-chat" })
    });
    assert.equal(actionResponse.status, 200);
    assert.deepEqual(actions, [{ action: "new-chat" }]);
    assert.equal(service.getStatus().status, "connected");
  } finally {
    const stopped = await service.stop();
    assert.equal(stopped.status, "stopped");
  }
});

test("rejects oversized mobile action payloads", async () => {
  const service = new MobileBridgeService({
    getLocalAddress: () => "127.0.0.1",
    getProjection: async () => ({ projects: [], chats: [] }),
    onAction: () => undefined
  });
  try {
    const pairing = await service.start();
    const actionUrl = new URL("/api/action", pairing.url);
    actionUrl.search = `${new URL(pairing.url).search}&code=${encodeURIComponent(pairing.code)}`;
    const response = await fetch(actionUrl, {
      method: "POST",
      body: JSON.stringify({ value: "x".repeat(70 * 1024) })
    });
    assert.equal(response.status, 400);
    assert.match(await response.text(), /too large/);
  } finally {
    await service.stop();
  }
});
