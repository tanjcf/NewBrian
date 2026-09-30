export type ToolActivityKind = "shell" | "file" | "plan" | "interaction" | "mcp" | "browser" | "document" | "tool";

export interface ToolActivitySemantic {
  kind: ToolActivityKind;
  runningTitle: string;
  completedTitle: string;
  failedTitle: string;
  commandDetails: boolean;
  fileActivity: boolean;
}

export function classifyToolActivity(toolName: string): ToolActivitySemantic;
export function toolActivityDetail(toolName: string, args?: Record<string, unknown>): string;
