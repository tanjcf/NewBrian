import assert from "node:assert/strict";
import test from "node:test";
import { EngineDiscoveryService, lookupCommandSync } from "./engine-discovery-service.ts";

test("engine discovery resolves ffmpeg from PATH when available", async () => {
  const discovery = new EngineDiscoveryService({
    platform: process.platform,
    environment: process.env,
    managedEnginesRoot: "/tmp/brain-engines",
    lookupCommand: lookupCommandSync,
    accessPath: async () => undefined
  });
  const resolved = await discovery.resolve("ffmpeg");
  if (resolved) {
    assert.match(resolved.executable, /ffmpeg/i);
    assert.equal(resolved.engineId, "ffmpeg");
  }
});
