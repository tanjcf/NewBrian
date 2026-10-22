import assert from "node:assert/strict";
import test from "node:test";
import { EngineDiscoveryService, lookupCommandSync } from "./engine-discovery-service.ts";

function discoveryFor(platform: NodeJS.Platform) {
  return new EngineDiscoveryService({
    platform,
    environment: {},
    managedEnginesRoot: "/tmp/brain-engines",
    lookupCommand: () => ({ status: 1, stdout: "" }),
    accessPath: async () => {
      throw new Error("missing");
    }
  });
}

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

test("managed godot executable name is platform-specific", () => {
  assert.match(discoveryFor("win32").managedExecutable("godot"), /Godot_v4\.4-stable_win64\.exe$/);
  assert.match(discoveryFor("darwin").managedExecutable("godot"), /Godot_v4\.4-stable_macos\.universal$/);
  assert.match(discoveryFor("linux").managedExecutable("godot"), /Godot_v4\.4-stable_linux\.x86_64$/);
  assert.doesNotMatch(discoveryFor("darwin").managedExecutable("godot"), /linux/i);
});

test("darwin godot system candidates include Applications bundle paths", () => {
  const candidates = discoveryFor("darwin").systemCandidates("godot");
  assert.ok(candidates.includes("/Applications/Godot.app/Contents/MacOS/Godot"));
  assert.ok(candidates.includes("/Applications/Godot_mono.app/Contents/MacOS/Godot"));
  assert.ok(candidates.includes("godot"));
});
