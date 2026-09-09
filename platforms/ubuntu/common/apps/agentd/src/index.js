import { createLocalRuntime } from "./runtime.js";
import path from "node:path";

const workspacePath =
  process.env.NEWBRAIN_WORKSPACE_PATH ?? path.resolve(process.cwd(), "..", "..");

const runtime = await createLocalRuntime({
  runtimeId: "agentd-local",
  workspacePath,
  platformLabel: "Ubuntu Linux",
  shellLabel: "bash"
});

console.log(
  JSON.stringify(
    {
      service: "agentd",
      status: "bootstrapped",
      platform: "windows-phase1",
      capabilities: {
        workspaceAttach: true,
        shellReadOnly: true,
        patchProposal: true,
        approvalGate: true,
        directWriteWithoutApproval: false
      },
      runtime: {
        runtimeId: runtime.runtimeId,
        state: runtime.sessionMachine.state,
        events: runtime.sessionMachine.events,
        snapshot: runtime.getSnapshot()
      }
    },
    null,
    2
  )
);
