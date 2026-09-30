function compact(value, limit = 500) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function normalizeModelUsage(value) {
  if (!value || typeof value !== "object") return null;
  const requestedModel = String(value.requestedModel || "").trim();
  const selectedModels = [...new Set(
    (Array.isArray(value.selectedModels) ? value.selectedModels : [])
      .map((item) => String(item || "").trim())
      .filter(Boolean)
  )];
  const selectedModel = String(value.selectedModel || selectedModels[selectedModels.length - 1] || "").trim();
  const routingReasons = [...new Set(
    (Array.isArray(value.routingReasons) ? value.routingReasons : [])
      .map((item) => String(item || "").trim())
      .filter(Boolean)
  )];
  if (!requestedModel && !selectedModel && selectedModels.length === 0) return null;
  return {
    requestedModel,
    selectedModel: selectedModel || requestedModel,
    selectedModels: selectedModels.length
      ? selectedModels
      : (selectedModel || requestedModel ? [selectedModel || requestedModel] : []),
    routingReasons
  };
}

export function createStructuredAgentResult(input) {
  const content = String(input?.content || "").trim();
  const events = Array.isArray(input?.events) ? input.events : [];
  const successfulTools = events.filter((event) =>
    event?.type === "tool_result" && event?.payload?.result?.ok === true
  );
  const evidenceRefs = [...new Set([
    ...(Array.isArray(input?.evidenceRefs) ? input.evidenceRefs : []),
    ...events.flatMap((event) => Array.isArray(event?.evidenceRefs) ? event.evidenceRefs : []),
    ...successfulTools.map((event) => event.id)
  ].map((value) => String(value || "").trim()).filter(Boolean))];
  const role = String(input?.role || "researcher");
  const worktree = input?.worktree ?? null;
  const modelUsage = normalizeModelUsage(input?.modelUsage);
  const qualityGates = [
    {
      id: "output_present",
      status: content ? "passed" : "failed",
      detail: content ? "Child agent returned a deliverable." : "Child agent returned no deliverable."
    },
    {
      id: "tool_evidence",
      status: successfulTools.length > 0 ? "passed" : "not_required",
      detail: successfulTools.length > 0
        ? `${successfulTools.length} successful tool result(s) are attached.`
        : "No successful tool call was required or recorded."
    },
    {
      id: "isolated_write_scope",
      status: role === "editor" ? (worktree?.worktreePath ? "passed" : "failed") : "not_required",
      detail: role === "editor"
        ? (worktree?.worktreePath ? `Changes are isolated on ${worktree.branch}.` : "Editor did not run in a managed worktree.")
        : "This role does not require a write worktree."
    }
  ];
  const failedGate = qualityGates.some((gate) => gate.status === "failed");
  return {
    schemaVersion: 1,
    status: failedGate ? "partial" : "completed",
    role,
    summary: compact(content),
    content,
    findings: content ? [{ summary: compact(content, 1_000), confidence: evidenceRefs.length ? 0.9 : 0.65 }] : [],
    evidenceRefs,
    artifacts: Array.isArray(input?.artifacts) ? structuredClone(input.artifacts) : [],
    changedFiles: Array.isArray(input?.changedFiles) ? structuredClone(input.changedFiles) : [],
    tests: Array.isArray(input?.tests) ? structuredClone(input.tests) : [],
    unresolvedQuestions: Array.isArray(input?.unresolvedQuestions)
      ? input.unresolvedQuestions.map((value) => String(value)).filter(Boolean)
      : [],
    qualityGates,
    worktree: worktree ? structuredClone(worktree) : null,
    contextCapsule: input?.contextCapsule ? structuredClone(input.contextCapsule) : null,
    modelUsage
  };
}

export function synthesizeAgentResults(results) {
  const normalized = (Array.isArray(results) ? results : []).filter(Boolean);
  const summaries = [...new Set(normalized.map((result) => compact(result.summary || result.content, 1_000)).filter(Boolean))];
  const failedGates = normalized.flatMap((result) =>
    (Array.isArray(result.qualityGates) ? result.qualityGates : [])
      .filter((gate) => gate.status === "failed")
      .map((gate) => ({ role: result.role, gate: gate.id, detail: gate.detail }))
  );
  const modelsUsed = [...new Set(normalized.flatMap((result) => {
    const usage = normalizeModelUsage(result.modelUsage);
    return usage?.selectedModels ?? [];
  }))];
  return {
    schemaVersion: 1,
    status: failedGates.length > 0 ? "needs_review" : "ready",
    summaries,
    evidenceRefs: [...new Set(normalized.flatMap((result) => result.evidenceRefs ?? []))],
    artifacts: normalized.flatMap((result) => result.artifacts ?? []),
    changedFiles: normalized.flatMap((result) => result.changedFiles ?? []),
    tests: normalized.flatMap((result) => result.tests ?? []),
    unresolvedQuestions: [...new Set(normalized.flatMap((result) => result.unresolvedQuestions ?? []))],
    failedGates,
    modelsUsed
  };
}
