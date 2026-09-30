export function mainRollupManualChunks(id: string) {
  const normalized = id.replace(/\\/g, "/");
  if (normalized.includes("shell-process-registry")) return "shell-process-registry";
  if (normalized.includes("shell-env")) return "shell-env";
  return undefined;
}

export const mainRollupOutput = {
  chunkFileNames: "[name]-[hash].js",
  compact: false,
  manualChunks: mainRollupManualChunks
} as const;
