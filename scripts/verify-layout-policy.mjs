const requiredApplicationEntries = [
  "apps/agentd/src/index.js",
  "apps/desktop/src/main/index.ts",
  "apps/desktop/src/preload/index.ts",
  "apps/desktop/src/renderer/index.tsx"
];

export function validateMaterializedApplicationEntries(target, files) {
  const available = new Set(files);
  const missing = requiredApplicationEntries.filter((entry) => !available.has(entry));
  if (missing.length) {
    throw new Error(`Incomplete ${target} application: missing ${missing.join(", ")}`);
  }
}
