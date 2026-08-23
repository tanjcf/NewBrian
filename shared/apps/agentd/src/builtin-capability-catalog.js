import { createBundledCapabilityCatalog } from "./capability-catalog.js";

export function createBuiltinCapabilityCatalog(toolDescriptors) {
  const capabilities = toolDescriptors.map((tool) => typeof tool === "string" ? tool : tool.name);
  return createBundledCapabilityCatalog([{
    id: "builtin.core",
    version: "1.0.0",
    capabilities,
    permissions: ["workspace.read", "workspace.write"],
    installation: { type: "bundled", providerId: "builtin.core" },
    platforms: ["windows", "macos-x64", "macos-arm64", "ubuntu-x64", "ubuntu-arm64"]
  }]);
}
