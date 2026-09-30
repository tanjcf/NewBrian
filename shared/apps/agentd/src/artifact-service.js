import { promises as fs } from "node:fs";
import path from "node:path";
import { inflateRawSync } from "node:zlib";

const KIND_EXTENSIONS = {
  code: new Set([".js", ".jsx", ".ts", ".tsx", ".java", ".py", ".go", ".rs", ".c", ".cpp", ".h", ".cs", ".json", ".yaml", ".yml", ".md"]),
  document: new Set([".docx", ".pdf", ".md", ".txt"]),
  spreadsheet: new Set([".xlsx", ".xls", ".csv", ".tsv"]),
  presentation: new Set([".pptx"]),
  web: new Set([".html", ".htm", ".css", ".svg"])
};

export function inferArtifactKind(targetPath) {
  const extension = path.extname(String(targetPath)).toLowerCase();
  for (const [kind, extensions] of Object.entries(KIND_EXTENSIONS)) {
    if (extensions.has(extension)) return kind;
  }
  return "binary";
}

function ensureRelativeTarget(workspacePath, targetPath) {
  const requested = String(targetPath ?? "").trim();
  if (!requested) throw new Error("Artifact targetPath is required.");
  const workspace = path.resolve(workspacePath);
  const target = path.isAbsolute(requested)
    ? path.resolve(requested)
    : path.resolve(workspace, requested);
  if (target !== workspace && !target.startsWith(`${workspace}${path.sep}`)) {
    throw new Error("Artifact must stay inside the workspace.");
  }
  return target;
}

function visibleXmlText(xml) {
  return String(xml)
    .replace(/<a:br\s*\/>|<w:br\s*\/>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function readZipEntries(bytes) {
  const eocdStart = Math.max(0, bytes.length - 65_557);
  let eocd = -1;
  for (let offset = bytes.length - 22; offset >= eocdStart; offset -= 1) {
    if (bytes.readUInt32LE(offset) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new Error("ZIP end-of-directory record was not found.");
  const totalEntries = bytes.readUInt16LE(eocd + 10);
  if (totalEntries > 10_000) throw new Error("Office package contains too many entries.");
  let offset = bytes.readUInt32LE(eocd + 16);
  const entries = new Map();
  let totalInflated = 0;
  for (let index = 0; index < totalEntries; index += 1) {
    if (offset + 46 > bytes.length || bytes.readUInt32LE(offset) !== 0x02014b50) throw new Error("Invalid ZIP central directory.");
    const method = bytes.readUInt16LE(offset + 10);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const inflatedSize = bytes.readUInt32LE(offset + 24);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const localOffset = bytes.readUInt32LE(offset + 42);
    const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    if (inflatedSize > 4 * 1024 * 1024 || totalInflated + inflatedSize > 32 * 1024 * 1024) throw new Error("Office package exceeds its decompression budget.");
    if (localOffset + 30 > bytes.length || bytes.readUInt32LE(localOffset) !== 0x04034b50) throw new Error("Invalid ZIP local header.");
    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.subarray(dataStart, dataStart + compressedSize);
    if (compressed.length !== compressedSize) throw new Error("Truncated ZIP entry.");
    let content;
    if (method === 0) content = compressed;
    else if (method === 8) content = inflateRawSync(compressed, { maxOutputLength: 4 * 1024 * 1024 });
    else content = null;
    if (content) {
      totalInflated += content.length;
      entries.set(name, content);
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function inspectOfficePackage(bytes, extension) {
  const zip = readZipEntries(bytes);
  const contract = {
    ".docx": { root: "word/document.xml", content: /^word\/(?:document|header\d+|footer\d+)\.xml$/, unit: "sections" },
    ".xlsx": { root: "xl/workbook.xml", content: /^xl\/(?:sharedStrings|worksheets\/sheet\d+)\.xml$/, unit: "sheets" },
    ".pptx": { root: "ppt/presentation.xml", content: /^ppt\/slides\/slide\d+\.xml$/, unit: "slides" }
  }[extension];
  if (!contract) return null;
  const entries = [...zip.keys()].filter((name) => contract.content.test(name)).sort();
  const previewChunks = [];
  for (const name of entries.slice(0, 20)) {
    const xml = zip.get(name)?.toString("utf8");
    const text = visibleXmlText(xml);
    if (text) previewChunks.push(text);
  }
  return {
    validRoot: zip.has(contract.root),
    entryCount: entries.length,
    unit: contract.unit,
    preview: previewChunks.join("\n").slice(0, 12_000)
  };
}

export class ArtifactService {
  constructor(input) {
    this.workspacePath = path.resolve(input.workspacePath);
    this.invokeTool = input.invokeTool;
  }

  async create(input) {
    const kind = input.kind ?? inferArtifactKind(input.targetPath);
    const write = await this.invokeTool("workspace.write_file", {
      targetPath: input.targetPath,
      content: input.content,
      encoding: input.encoding ?? "utf8"
    }, { permissionMode: input.permissionMode ?? "full" });
    if (!write.ok) return { ...write, kind, stage: "write" };
    return this.validate({ targetPath: input.targetPath, kind });
  }

  edit(input) {
    return this.create(input);
  }

  async validate(input) {
    const target = ensureRelativeTarget(this.workspacePath, input.targetPath);
    const kind = input.kind ?? inferArtifactKind(input.targetPath);
    const inspection = await this.invokeTool("artifact.inspect", { targetPath: input.targetPath }, { permissionMode: "full" });
    if (!inspection.ok) return { ok: false, kind, stage: "inspect", detail: inspection.output };
    const bytes = await fs.readFile(target);
    const extension = path.extname(input.targetPath).toLowerCase();
    const gates = [{ id: "exists", status: "passed", detail: `${bytes.length} bytes` }];
    if ([".docx", ".xlsx", ".pptx"].includes(extension)) {
      let office;
      try {
        office = await inspectOfficePackage(bytes, extension);
      } catch {
        office = null;
      }
      gates.push({ id: "office-package", status: office?.validRoot ? "passed" : "failed", detail: office?.validRoot ? `Valid OOXML package; ${office.entryCount} ${office.unit}` : "Missing or invalid OOXML package root" });
      inspection.artifact.office = office ?? undefined;
    }
    if (kind === "web" && [".html", ".htm"].includes(extension)) {
      const text = bytes.toString("utf8");
      gates.push({ id: "html-document", status: /<(?:!doctype\s+html|html)[\s>]/i.test(text) ? "passed" : "failed", detail: "HTML document root" });
    }
    if (kind === "code") {
      gates.push({ id: "non-empty-source", status: bytes.toString("utf8").trim() ? "passed" : "failed", detail: "Source contains visible text" });
    }
    return {
      ok: gates.every((gate) => gate.status === "passed"),
      kind,
      targetPath: input.targetPath,
      inspection: inspection.artifact,
      gates
    };
  }

  async render(input) {
    const validation = await this.validate(input);
    const extension = path.extname(input.targetPath).toLowerCase();
    const target = ensureRelativeTarget(this.workspacePath, input.targetPath);
    let preview = validation.inspection?.office?.preview ?? "";
    if (!preview && (validation.kind === "code" || validation.kind === "web" || [".md", ".txt", ".csv", ".tsv"].includes(extension))) {
      preview = (await fs.readFile(target, "utf8")).slice(0, 12_000);
    }
    return {
      ...validation,
      renderMode: input.renderer ?? (validation.kind === "web" ? "browser" : validation.kind === "code" ? "text" : "native"),
      renderReady: validation.ok,
      preview
    };
  }
}
