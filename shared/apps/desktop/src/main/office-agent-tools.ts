import { convertOfficeFile, createDefaultOfficeDependencies, detectOfficeEditors, openOfficeFile, type OfficeSuiteDependencies } from "./office-suite.ts";

type ToolRuntime = {
  unregisterExternalTools(namespace?: string): unknown;
  registerExternalTool(
    definition: Record<string, unknown>,
    execute: (input: Record<string, unknown>, context?: Record<string, unknown>) => Promise<{ ok: boolean; output?: string; [key: string]: unknown }>
  ): unknown;
};

export type OfficeAgentToolDependencies = {
  projectRoot: string;
  projectId?: string;
  suite?: OfficeSuiteDependencies;
  notifyUi?: (payload: { projectId: string; reason: string }) => void;
  persistOutput?: (relativePath: string) => Promise<unknown>;
};

const text = (value: unknown) => String(value ?? "").trim();

/** Register the local Office suite tools for the document workspace. */
export function registerOfficeAgentTools(runtime: ToolRuntime, deps: OfficeAgentToolDependencies) {
  if (!deps.projectRoot.trim()) return;
  const suite = deps.suite ?? createDefaultOfficeDependencies();
  runtime.unregisterExternalTools("office");

  runtime.registerExternalTool({
    name: "office.status",
    title: "检查本机 Office 套件",
    description: "检查本机是否安装 LibreOffice、WPS 或 Microsoft Office。优先使用免费的 LibreOffice 打开和转换 Word、Excel、PPT。",
    namespace: "office",
    kind: "read",
    risk: "low",
    requiresApproval: false,
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  }, async () => {
    const status = await detectOfficeEditors(suite);
    return { ok: true, output: JSON.stringify(status) };
  });

  runtime.registerExternalTool({
    name: "office.open",
    title: "用 Office 打开文件",
    description: "用本机 Office 套件打开当前项目里的 docx、xlsx 或 pptx。优先 LibreOffice，其次 WPS，再次 Microsoft Office。",
    namespace: "office",
    kind: "read",
    risk: "low",
    requiresApproval: false,
    inputSchema: {
      type: "object",
      required: ["path"],
      properties: { path: { type: "string", description: "项目内相对路径，例如 outputs/汇报.docx" } },
      additionalProperties: false
    }
  }, async (input) => {
    const path = text(input.path);
    if (!path) return { ok: false, output: "path is required" };
    try {
      const opened = await openOfficeFile(deps.projectRoot, path, suite);
      if (opened.ok) deps.notifyUi?.({ projectId: deps.projectId || "", reason: "office.open" });
      return opened;
    } catch (error) {
      return { ok: false, output: error instanceof Error ? error.message : "OFFICE_OPEN_FAILED" };
    }
  });

  runtime.registerExternalTool({
    name: "office.convert",
    title: "用 LibreOffice 转换 Office 文件",
    description: "用本机 LibreOffice 把项目内的 Word、Excel 或 PPT 转换成 pdf、docx、xlsx、pptx、odt、ods、odp 或 csv，结果写入 outputs/。",
    namespace: "office",
    kind: "write",
    risk: "medium",
    requiresApproval: false,
    inputSchema: {
      type: "object",
      required: ["path", "format"],
      properties: {
        path: { type: "string" },
        format: { type: "string", description: "pdf、docx、xlsx、pptx、odt、ods、odp 或 csv" }
      },
      additionalProperties: false
    }
  }, async (input) => {
    const path = text(input.path);
    const format = text(input.format);
    if (!path || !format) return { ok: false, output: "path and format are required" };
    try {
      const converted = await convertOfficeFile(deps.projectRoot, path, format, suite);
      if (converted.ok && converted.artifact) {
        await deps.persistOutput?.(converted.artifact.path);
        deps.notifyUi?.({ projectId: deps.projectId || "", reason: "office.convert" });
      }
      return converted;
    } catch (error) {
      return { ok: false, output: error instanceof Error ? error.message : "OFFICE_CONVERT_FAILED" };
    }
  });
}
