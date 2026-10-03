const semantics = {
  shell: { kind: "shell", runningTitle: "正在运行命令", completedTitle: "已运行命令", failedTitle: "命令执行失败", commandDetails: true, fileActivity: false },
  file: { kind: "file", runningTitle: "正在处理文件", completedTitle: "已处理文件", failedTitle: "文件处理失败", commandDetails: false, fileActivity: true },
  plan: { kind: "plan", runningTitle: "正在更新计划", completedTitle: "已更新计划", failedTitle: "计划更新失败", commandDetails: false, fileActivity: false },
  interaction: { kind: "interaction", runningTitle: "正在准备用户确认", completedTitle: "等待用户确认", failedTitle: "用户确认请求失败", commandDetails: false, fileActivity: false },
  mcp: { kind: "mcp", runningTitle: "正在调用 MCP 工具", completedTitle: "已调用 MCP 工具", failedTitle: "MCP 工具调用失败", commandDetails: false, fileActivity: false },
  browser: { kind: "browser", runningTitle: "正在操作浏览器", completedTitle: "已完成浏览器操作", failedTitle: "浏览器操作失败", commandDetails: false, fileActivity: false },
  document: { kind: "document", runningTitle: "正在处理文档", completedTitle: "已完成文档处理", failedTitle: "文档处理失败", commandDetails: false, fileActivity: false },
  tool: { kind: "tool", runningTitle: "正在调用工具", completedTitle: "已调用工具", failedTitle: "工具调用失败", commandDetails: false, fileActivity: false }
};

export function classifyToolActivity(toolName) {
  const name = toolName.trim().toLowerCase();
  if (name === "shell.exec") return semantics.shell;
  if (name === "workspace.write_file" || name === "artifact.create" || name === "artifact.inspect"
    || name === "document.create_pdf" || name === "document.create_docx" || name === "office.convert") return semantics.file;
  if (name === "goal.update_plan" || name === "goal.create" || name === "goal.complete" || name === "goal.get") return semantics.plan;
  if (name === "goal.request_user_input") return semantics.interaction;
  if (name.startsWith("mcp.") || name.startsWith("mcp__") || name.includes("mcp")) return semantics.mcp;
  if (name.startsWith("browser.") || name.includes("browser") || name === "web.search") return semantics.browser;
  if (/artifact\.(render|export)|document|pdf|spreadsheet|presentation|^office\./.test(name)) return semantics.document;
  return semantics.tool;
}

export function toolActivityDetail(toolName, args = {}) {
  if (toolName === "shell.exec") return String(args.command ?? toolName);
  if (typeof args.path === "string" && args.path.trim()) return args.path;
  if (typeof args.filePath === "string" && args.filePath.trim()) return args.filePath;
  return toolName;
}
