/** Dialog-facing labels for shell / tool approval cards. */

export type ApprovalUxInput = {
  toolName?: string;
  command?: string;
  risk?: string;
  reason?: string;
  ruleId?: string;
  policySource?: string;
  permissionMode?: string;
};

export type ApprovalUxTags = {
  riskLabel: string;
  scopeLabel: string;
  categoryLabels: string[];
  reasonText: string;
  memoryHint: string;
};

function normalize(value: unknown): string {
  return String(value ?? "").trim();
}

export function approvalRiskLabel(risk?: string): string {
  if (risk === "high") return "高风险";
  if (risk === "medium") return "中风险";
  if (risk === "low") return "低风险";
  return "需要确认";
}

export function approvalScopeLabel(permissionMode?: string): string {
  return permissionMode === "full" ? "完全访问" : "替我审批";
}

export function classifyApprovalCategories(input: ApprovalUxInput): string[] {
  const command = normalize(input.command);
  const ruleId = normalize(input.ruleId).toLowerCase();
  const reason = normalize(input.reason).toLowerCase();
  const labels: string[] = [];
  if (ruleId.includes("network") || /curl|wget|invoke-webrequest|irm\b|iwr\b/i.test(command)) {
    labels.push("网络访问");
  }
  if (ruleId.includes("workspace-boundary") || reason.includes("工作区")) {
    labels.push("工作区边界");
  }
  if (ruleId.includes("opaque") || /encodedcommand|\biex\b|invoke-expression|frombase64string/i.test(command)) {
    labels.push("不透明执行");
  }
  if (/remove-item|set-content|out-file|del\b|rm\b|git\s+clean/i.test(command)) {
    labels.push("写操作");
  }
  if (normalize(input.toolName) === "shell.exec" || normalize(input.toolName) === "exec" || command) {
    if (!labels.includes("Shell 命令")) labels.unshift("Shell 命令");
  }
  return labels.slice(0, 4);
}

export function buildApprovalUx(input: ApprovalUxInput): ApprovalUxTags {
  const reasonText = normalize(input.reason)
    || (normalize(input.command) ? "运行此命令需要你的确认" : "当前操作需要你的确认");
  const memoryHint = normalize(input.policySource) === "rule" && /approval-memory|user-approval-memory/i.test(normalize(input.reason))
    ? "来自你之前记住的批准规则"
    : normalize(input.ruleId).startsWith("remember-")
      ? "来自你之前记住的批准规则"
      : "";
  return {
    riskLabel: approvalRiskLabel(input.risk),
    scopeLabel: approvalScopeLabel(input.permissionMode),
    categoryLabels: classifyApprovalCategories(input),
    reasonText,
    memoryHint
  };
}
