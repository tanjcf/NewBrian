export function isTerminalDelegatedAgentStatus(status: string | undefined | null) {
  const value = String(status || "").trim().toLowerCase();
  return value === "completed" || value === "failed" || value === "cancelled" || value === "canceled";
}

export function summarizeDelegatedAgents(
  agents: ReadonlyArray<{ status?: string; checkpointStatus?: string }>
) {
  const completed = agents.filter((agent) => String(agent.status || "").toLowerCase() === "completed").length;
  const failed = agents.filter((agent) => {
    const status = String(agent.status || "").toLowerCase();
    return status === "failed" || status === "cancelled" || status === "canceled";
  }).length;
  const awaiting = agents.filter((agent) =>
    agent.checkpointStatus === "awaiting-approval" && !isTerminalDelegatedAgentStatus(agent.status)
  ).length;
  const active = Math.max(0, agents.length - completed - failed);
  const allTerminal = agents.length > 0 && active === 0;
  // Parent strip is only for live collaboration (running / awaiting approval).
  // Terminal batches (all completed or failed) must not keep occupying the composer.
  const visible = agents.length > 0 && (!allTerminal || awaiting > 0);
  const parts = [`${completed}/${agents.length} 已完成`];
  if (failed > 0) parts.push(`${failed} 失败`);
  if (awaiting > 0) parts.push(`${awaiting} 项等待审批`);
  else if (active > 0 && failed === 0) {
    // keep strip terse while healthy work is still running
  } else if (allTerminal && failed === agents.length) {
    parts[0] = `0/${agents.length} 已完成`;
  }
  return {
    completed,
    failed,
    awaiting,
    active,
    allTerminal,
    visible,
    label: parts.join(" · "),
    attention: awaiting > 0 || (failed > 0 && !allTerminal)
  };
}
