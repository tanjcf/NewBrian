export const builtinPluginCatalog = [
  { id: "plugin-browser", packageName: "browser", name: "Browser", summary: "使用 codeCN 浏览器预览打开并验证页面。", capabilities: ["browser", "preview", "verification"], category: "精选", color: "sky" },
  { id: "plugin-computer", packageName: "computer", name: "Computer", summary: "通过审批保护的本机工具安全操作 Windows。", capabilities: ["computer", "windows", "approval"], category: "精选", color: "sky" },
  { id: "plugin-figma", packageName: "figma", name: "Figma", summary: "生成 Figma 设计稿与 FigJam 流程图（需绑定 Figma 账号/令牌后才能写入云端）。", capabilities: ["figma", "figjam", "design", "flowchart", "design-to-code"], category: "生产力", color: "violet" },
  { id: "plugin-documents", packageName: "documents", name: "Documents", summary: "创建、编辑、检查并验证 Word 文档。", capabilities: ["docx", "documents", "artifact-verification"], category: "生产力", color: "violet" },
  { id: "plugin-pdf", packageName: "pdf", name: "PDF", summary: "读取、创建、渲染并验证 PDF 文件。", capabilities: ["pdf", "render", "artifact-verification"], category: "生产力", color: "orange" },
  { id: "plugin-spreadsheets", packageName: "spreadsheets", name: "Spreadsheets", summary: "创建、编辑、分析并验证电子表格。", capabilities: ["xlsx", "csv", "charts"], category: "生产力", color: "emerald" },
  { id: "plugin-presentations", packageName: "presentations", name: "Presentations", summary: "创建、编辑、检查并验证演示文稿。", capabilities: ["pptx", "slides", "artifact-verification"], category: "生产力", color: "violet" },
  { id: "plugin-template-creator", packageName: "template-creator", name: "Template Creator", summary: "从 Office 文件创建可复用模板。", capabilities: ["templates", "artifacts"], category: "生产力", color: "sky" },
  { id: "plugin-sites", packageName: "sites", name: "Sites", summary: "构建并验证本地网站和 Web 应用。", capabilities: ["sites", "html", "local-preview"], category: "生产力", color: "sky" },
  { id: "plugin-visualize", packageName: "visualize", name: "Visualize", summary: "创建可交互的本地可视化、图表和说明工具。", capabilities: ["visualize", "html", "charts"], category: "生产力", color: "violet" },
  { id: "plugin-default-templates", packageName: "default-templates", name: "Default Templates", summary: "使用经过验证的默认模板创建办公文件。", capabilities: ["templates", "documents", "spreadsheets", "presentations"], category: "生产力", color: "emerald" }
] as const;

export type BuiltinPluginDescriptor = (typeof builtinPluginCatalog)[number];

export function builtinPluginUri(packageName: string) {
  return `builtin:${packageName}`;
}
