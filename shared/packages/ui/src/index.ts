import type { PhaseOneSnapshot, SessionSummary } from "@codex-forge/protocol";

export function shellLayout(input: {
  sidebarTitle: string;
  session: SessionSummary;
}) {
  return {
    type: "desktop-shell",
    sidebarTitle: input.sidebarTitle,
    session: input.session
  };
}

export function phaseOneDashboard(snapshot: PhaseOneSnapshot) {
  return {
    type: "phase-one-dashboard",
    session: snapshot.session,
    messageCount: snapshot.messages.length,
    workspaceEntries: snapshot.workspace.length,
    hasPendingApproval: Boolean(snapshot.approval),
    runCount: snapshot.runs.length
  };
}
