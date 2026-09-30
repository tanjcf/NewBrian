export type ExecutionKind = "instructions" | "script-assisted" | "builtin-tools" | "mcp" | "hybrid";

export interface ExecutionEvidence {
  executionKind?: ExecutionKind;
  skillRoots?: string[];
  mcpServerIds?: string[];
  builtinToolNames?: string[];
  hasScripts?: boolean;
}

export function classifyExecutionKind(input: ExecutionEvidence): ExecutionKind {
  if (input.executionKind) return input.executionKind;
  const hasMcp = Boolean(input.mcpServerIds?.length);
  const hasBuiltinTools = Boolean(input.builtinToolNames?.length);
  const hasScripts = Boolean(input.hasScripts);
  const executionSources = Number(hasMcp) + Number(hasBuiltinTools) + Number(hasScripts);
  if (executionSources > 1) return "hybrid";
  if (hasMcp) return "mcp";
  if (hasBuiltinTools) return "builtin-tools";
  if (hasScripts) return "script-assisted";
  return "instructions";
}

export function executionKindLabel(kind: ExecutionKind | undefined) {
  switch (kind) {
    case "mcp": return "MCP 工具";
    case "builtin-tools": return "内置执行器";
    case "script-assisted": return "脚本辅助（需审批）";
    case "hybrid": return "混合能力";
    default: return "仅提示词";
  }
}

export function executionKindDescription(kind: ExecutionKind | undefined) {
  switch (kind) {
    case "mcp": return "提供可由对话直接调用的 MCP 工具。";
    case "builtin-tools": return "使用 NewBrain 内置工具执行真实读写或操作。";
    case "script-assisted": return "包含辅助脚本，但脚本不会自动运行，执行前需要审批。";
    case "hybrid": return "同时包含两种或更多真实执行来源。";
    default: return "仅提供流程说明和提示词，不包含独立执行器。";
  }
}
