import { createHash } from "node:crypto";

const DEFAULT_CONFIG = {
  enabled: true,
  historySize: 30,
  warningThreshold: 8,
  criticalThreshold: 15,
  globalCircuitBreakerThreshold: 25,
  failedFamilyWarningThreshold: 4,
  failedFamilyCriticalThreshold: 6,
  detectors: {
    genericRepeat: true,
    pingPong: true,
    pairProgress: true,
    argumentChurn: true,
    failedFamily: true
  },
  pairProgress: [
    {
      idleTool: "web.search_official",
      progressTool: "web.read_official",
      warningThreshold: 3,
      criticalThreshold: 5
    }
  ]
};

export function resolveLoopDetectionConfig(config = {}) {
  const detectors = {
    ...DEFAULT_CONFIG.detectors,
    ...(config.detectors && typeof config.detectors === "object" ? config.detectors : {})
  };
  return {
    enabled: config.enabled !== false,
    historySize: clampInt(config.historySize, DEFAULT_CONFIG.historySize, 5, 100),
    warningThreshold: clampInt(config.warningThreshold, DEFAULT_CONFIG.warningThreshold, 2, 100),
    criticalThreshold: clampInt(config.criticalThreshold, DEFAULT_CONFIG.criticalThreshold, 3, 200),
    globalCircuitBreakerThreshold: clampInt(
      config.globalCircuitBreakerThreshold,
      DEFAULT_CONFIG.globalCircuitBreakerThreshold,
      5,
      300
    ),
    failedFamilyWarningThreshold: clampInt(
      config.failedFamilyWarningThreshold,
      DEFAULT_CONFIG.failedFamilyWarningThreshold,
      2,
      50
    ),
    failedFamilyCriticalThreshold: clampInt(
      config.failedFamilyCriticalThreshold,
      DEFAULT_CONFIG.failedFamilyCriticalThreshold,
      3,
      100
    ),
    detectors,
    pairProgress: Array.isArray(config.pairProgress)
      ? config.pairProgress
      : DEFAULT_CONFIG.pairProgress
  };
}

export function createToolLoopState() {
  return {
    history: [],
    warningBuckets: new Map()
  };
}

export function stableStringify(value) {
  return JSON.stringify(normalizeForHash(value));
}

export function hashToolCall(toolName, params) {
  return `${toolName}:${digest(stableStringify(params ?? {}))}`;
}

export function hashToolResult(result) {
  if (!result || typeof result !== "object") {
    return digest(stableStringify(result ?? null));
  }
  const output = typeof result.output === "string" ? result.output.slice(0, 4000) : result.output;
  return digest(stableStringify({
    ok: result.ok === true,
    exitCode: typeof result.exitCode === "number" ? result.exitCode : null,
    deniedReason: typeof result.deniedReason === "string" ? result.deniedReason : null,
    output
  }));
}

/**
 * Detect repetitive no-progress tool patterns before executing a call.
 */
export function detectToolCallLoop(state, toolName, params, config) {
  const resolved = resolveLoopDetectionConfig(config);
  if (!resolved.enabled) return { stuck: false };

  const history = state.history ?? [];
  const argsHash = hashToolCall(toolName, params);
  const noProgress = getNoProgressStreak(history, toolName, argsHash);
  const pingPong = getPingPongStreak(history, argsHash);
  const pair = getPairProgressStreak(history, toolName, resolved.pairProgress);
  const failedFamily = getFailedFamilyStreak(history, toolName);
  const argumentChurn = getArgumentChurnNoProgressStreak(history, toolName, argsHash);

  if (
    resolved.detectors.failedFamily &&
    isWriteOrShellFamily(toolName) &&
    failedFamily.count >= resolved.failedFamilyCriticalThreshold
  ) {
    return {
      stuck: true,
      level: "critical",
      detector: "failed_family",
      count: failedFamily.count,
      message: [
        `CRITICAL: ${toolName} (and related write/shell tools) failed ${failedFamily.count} times in a row with no success.`,
        "Stop retrying the same approach. Prefer workspace.write_file for new files,",
        "fix apply_patch format, or use PowerShell `;` instead of bash `&&`, then continue."
      ].join(" "),
      warningKey: `failed-family:${toolFamily(toolName)}`
    };
  }

  if (
    resolved.detectors.failedFamily &&
    isWriteOrShellFamily(toolName) &&
    failedFamily.count >= resolved.failedFamilyWarningThreshold
  ) {
    return {
      stuck: true,
      level: "warning",
      detector: "failed_family",
      count: failedFamily.count,
      message: [
        `WARNING: ${toolName} has failed ${failedFamily.count} consecutive times.`,
        "Change strategy: use workspace.write_file for creates, fix patch envelopes,",
        "and never use bash `&&` on Windows PowerShell."
      ].join(" "),
      warningKey: `failed-family:${toolFamily(toolName)}`
    };
  }

  if (
    resolved.detectors.argumentChurn &&
    argumentChurn.count > 0
  ) {
    return {
      stuck: true,
      level: "warning",
      detector: "argument_churn",
      count: argumentChurn.count,
      message: [
        `WARNING: ${toolName} has cycled through ${argumentChurn.variantCount} repeated argument patterns`,
        `with the same failing outcome ${argumentChurn.count} times.`,
        "Stop churning arguments; switch tools or finish with current evidence."
      ].join(" "),
      warningKey: `argument-churn:${toolName}`
    };
  }

  if (
    resolved.detectors.pairProgress &&
    pair &&
    pair.count >= pair.criticalThreshold
  ) {
    return {
      stuck: true,
      level: "critical",
      detector: "pair_progress",
      count: pair.count,
      message: [
        `CRITICAL: ${toolName} was called ${pair.count} times without ${pair.progressTool}.`,
        `Stop calling ${toolName}. Call ${pair.progressTool} on the best existing results,`,
        "or produce the writing specification/draft from evidence already collected."
      ].join(" "),
      warningKey: `pair:${toolName}:${pair.progressTool}`
    };
  }

  if (
    resolved.detectors.pairProgress &&
    pair &&
    pair.count >= pair.warningThreshold
  ) {
    return {
      stuck: true,
      level: "warning",
      detector: "pair_progress",
      count: pair.count,
      message: [
        `WARNING: ${toolName} has run ${pair.count} times without ${pair.progressTool}.`,
        `Stop searching and call ${pair.progressTool}, then draft from the pages you read.`
      ].join(" "),
      warningKey: `pair:${toolName}:${pair.progressTool}`
    };
  }

  if (noProgress.count >= resolved.globalCircuitBreakerThreshold) {
    return {
      stuck: true,
      level: "critical",
      detector: "global_circuit_breaker",
      count: noProgress.count,
      message: `CRITICAL: ${toolName} repeated identical no-progress outcomes ${noProgress.count} times. Execution blocked by circuit breaker.`,
      warningKey: `global:${toolName}:${argsHash}:${noProgress.latestResultHash ?? "none"}`
    };
  }

  if (
    resolved.detectors.pingPong &&
    pingPong.count >= resolved.criticalThreshold &&
    pingPong.noProgressEvidence
  ) {
    return {
      stuck: true,
      level: "critical",
      detector: "ping_pong",
      count: pingPong.count,
      message: `CRITICAL: Alternating tool-call patterns repeated ${pingPong.count} times with no progress. Execution blocked.`,
      pairedToolName: pingPong.pairedToolName,
      warningKey: `pingpong:${canonicalPairKey(argsHash, pingPong.pairedSignature)}`
    };
  }

  if (resolved.detectors.pingPong && pingPong.count >= resolved.warningThreshold) {
    return {
      stuck: true,
      level: "warning",
      detector: "ping_pong",
      count: pingPong.count,
      message: `WARNING: Alternating tool-call patterns repeated ${pingPong.count} times. Stop retrying and change approach or finish with current evidence.`,
      pairedToolName: pingPong.pairedToolName,
      warningKey: `pingpong:${canonicalPairKey(argsHash, pingPong.pairedSignature)}`
    };
  }

  const recentCount = history.filter(
    (entry) => entry.toolName === toolName && entry.argsHash === argsHash
  ).length;

  if (resolved.detectors.genericRepeat && noProgress.count >= resolved.criticalThreshold) {
    return {
      stuck: true,
      level: "critical",
      detector: "generic_repeat",
      count: noProgress.count,
      message: `CRITICAL: Called ${toolName} with identical arguments and identical outcomes ${noProgress.count} times. Execution blocked.`,
      warningKey: `generic:${toolName}:${argsHash}:${noProgress.latestResultHash ?? "none"}`
    };
  }

  if (resolved.detectors.genericRepeat && recentCount >= resolved.warningThreshold) {
    return {
      stuck: true,
      level: "warning",
      detector: "generic_repeat",
      count: recentCount,
      message: `WARNING: You have called ${toolName} ${recentCount} times with identical arguments. If this is not making progress, stop retrying and finish with current evidence.`,
      warningKey: `generic:${toolName}:${argsHash}`
    };
  }

  return { stuck: false };
}

export function recordToolCall(state, toolName, params, result, config) {
  const resolved = resolveLoopDetectionConfig(config);
  if (!resolved.enabled) return null;
  if (!state.history) state.history = [];
  const record = {
    toolName,
    argsHash: hashToolCall(toolName, params),
    resultHash: hashToolResult(result),
    ok: result?.ok === true,
    deniedReason: typeof result?.deniedReason === "string" ? result.deniedReason : null,
    at: Date.now()
  };
  state.history.push(record);
  while (state.history.length > resolved.historySize) {
    state.history.shift();
  }
  return record;
}

export function shouldEmitLoopWarning(state, warningKey, count) {
  if (!state.warningBuckets) state.warningBuckets = new Map();
  const bucket = Math.floor(count / 5);
  const last = state.warningBuckets.get(warningKey) ?? -1;
  if (bucket <= last) return false;
  state.warningBuckets.set(warningKey, bucket);
  if (state.warningBuckets.size > 40) {
    const oldest = state.warningBuckets.keys().next().value;
    if (oldest) state.warningBuckets.delete(oldest);
  }
  return true;
}

export function buildLoopBlockedResult(message) {
  return {
    ok: false,
    exitCode: 1,
    deniedReason: "tool-loop",
    output: message
  };
}

function getNoProgressStreak(history, toolName, argsHash) {
  let count = 0;
  let latestResultHash;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index];
    if (entry.toolName !== toolName || entry.argsHash !== argsHash) break;
    if (entry.deniedReason === "tool-loop") continue;
    if (!entry.resultHash) break;
    if (latestResultHash == null) latestResultHash = entry.resultHash;
    if (entry.resultHash !== latestResultHash) break;
    count += 1;
  }
  return { count, latestResultHash };
}

function toolFamily(toolName) {
  const name = String(toolName || "").toLowerCase();
  if (name === "shell.exec" || name === "exec" || name === "shell.process" || name === "process") {
    return "mutate";
  }
  if (
    name.includes("apply_patch")
    || name.includes("write_file")
    || name === "write"
    || name === "apply_patch"
    || name === "workspace.edit"
    || name === "edit"
  ) {
    return "mutate";
  }
  return name;
}

function isWriteOrShellFamily(toolName) {
  return toolFamily(toolName) === "mutate";
}

function getFailedFamilyStreak(history, toolName) {
  const family = toolFamily(toolName);
  if (family !== "mutate") return { count: 0 };
  let count = 0;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index];
    if (toolFamily(entry.toolName) !== family) break;
    if (entry.deniedReason === "tool-loop") continue;
    if (entry.ok !== false) break;
    count += 1;
  }
  return { count: count + 1 };
}

const MIN_STABLE_CALLS_PER_VARIANT = 3;

function getArgumentChurnNoProgressStreak(history, toolName, currentArgsHash) {
  const outcomes = new Map();
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index];
    if (!entry || entry.toolName !== toolName) break;
    if (!entry.resultHash) continue;
    if (entry.ok !== false) break;
    const previous = outcomes.get(entry.argsHash);
    if (previous && previous.resultHash !== entry.resultHash) break;
    outcomes.set(entry.argsHash, {
      resultHash: entry.resultHash,
      count: (previous?.count ?? 0) + 1
    });
  }
  const allOutcomes = [...outcomes.values()];
  const count = allOutcomes.reduce((sum, outcome) => sum + outcome.count, 0);
  const stableOutcomes = allOutcomes.filter((outcome) => outcome.count >= MIN_STABLE_CALLS_PER_VARIANT);
  const hasSharedStableOutcome = new Set(stableOutcomes.map((outcome) => outcome.resultHash)).size === 1;
  const currentOutcome = outcomes.get(currentArgsHash);
  const hasOnlyStableVariants =
    stableOutcomes.reduce((sum, outcome) => sum + outcome.count, 0) === count;
  const hasStableChurn =
    stableOutcomes.length > 1
    && hasOnlyStableVariants
    && hasSharedStableOutcome
    && (currentOutcome?.count ?? 0) >= MIN_STABLE_CALLS_PER_VARIANT;
  return hasStableChurn
    ? { count, variantCount: stableOutcomes.length }
    : { count: 0, variantCount: 0 };
}

function getPingPongStreak(history, currentArgsHash) {
  if (history.length < 2) {
    return { count: 0, pairedToolName: undefined, pairedSignature: undefined, noProgressEvidence: false };
  }
  const last = history[history.length - 1];
  if (!last || last.argsHash === currentArgsHash) {
    return { count: 0, pairedToolName: undefined, pairedSignature: undefined, noProgressEvidence: false };
  }

  let otherSignature;
  let otherToolName;
  for (let index = history.length - 2; index >= 0; index -= 1) {
    const entry = history[index];
    if (entry.argsHash !== last.argsHash) {
      otherSignature = entry.argsHash;
      otherToolName = entry.toolName;
      break;
    }
  }
  if (!otherSignature || !otherToolName) {
    return { count: 0, pairedToolName: undefined, pairedSignature: undefined, noProgressEvidence: false };
  }

  let alternatingTailCount = 0;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index];
    const expected = alternatingTailCount % 2 === 0 ? last.argsHash : otherSignature;
    if (entry.argsHash !== expected) break;
    alternatingTailCount += 1;
  }
  if (alternatingTailCount < 2 || currentArgsHash !== otherSignature) {
    return { count: 0, pairedToolName: undefined, pairedSignature: undefined, noProgressEvidence: false };
  }

  const tailStart = Math.max(0, history.length - alternatingTailCount);
  let firstHashA;
  let firstHashB;
  let noProgressEvidence = true;
  for (let index = tailStart; index < history.length; index += 1) {
    const entry = history[index];
    if (!entry.resultHash) {
      noProgressEvidence = false;
      break;
    }
    if (entry.argsHash === last.argsHash) {
      if (!firstHashA) firstHashA = entry.resultHash;
      else if (firstHashA !== entry.resultHash) {
        noProgressEvidence = false;
        break;
      }
      continue;
    }
    if (entry.argsHash === otherSignature) {
      if (!firstHashB) firstHashB = entry.resultHash;
      else if (firstHashB !== entry.resultHash) {
        noProgressEvidence = false;
        break;
      }
      continue;
    }
    noProgressEvidence = false;
    break;
  }
  if (!firstHashA || !firstHashB) noProgressEvidence = false;

  return {
    count: alternatingTailCount + 1,
    pairedToolName: otherToolName,
    pairedSignature: otherSignature,
    noProgressEvidence
  };
}

function getPairProgressStreak(history, toolName, pairRules) {
  const rule = (pairRules ?? []).find((entry) => entry.idleTool === toolName);
  if (!rule) return null;
  let count = 0;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index];
    if (entry.toolName === rule.progressTool) break;
    if (entry.toolName === rule.idleTool) count += 1;
  }
  // Prospective call also counts.
  count += 1;
  return {
    count,
    progressTool: rule.progressTool,
    warningThreshold: clampInt(rule.warningThreshold, 3, 2, 50),
    criticalThreshold: clampInt(rule.criticalThreshold, 5, 3, 100)
  };
}

function canonicalPairKey(a, b) {
  return [a, b].sort().join("|");
}

function normalizeForHash(value) {
  if (value == null) return null;
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((entry) => normalizeForHash(entry));
  const out = {};
  for (const key of Object.keys(value).sort()) {
    out[key] = normalizeForHash(value[key]);
  }
  return out;
}

function digest(text) {
  return createHash("sha256").update(text).digest("hex").slice(0, 24);
}

function clampInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}
