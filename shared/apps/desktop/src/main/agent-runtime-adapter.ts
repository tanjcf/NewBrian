/**
 * The single Electron-main boundary to the local agent runtime.
 * Keep agentd implementation paths out of the rest of the desktop process.
 */
export { createLocalRuntime } from "../../../agentd/src/runtime.js";
export { AgentLoop } from "../../../agentd/src/agent-loop.js";
export { WorktreeManager } from "../../../agentd/src/worktree-manager.js";
export { createStructuredAgentResult, synthesizeAgentResults } from "../../../agentd/src/agent-result.js";
export { TaskGraph } from "../../../agentd/src/task-graph.js";
export type { AgentLoopSnapshot } from "../../../agentd/src/runtime.js";
