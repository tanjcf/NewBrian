import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { BrainWorkspaceStorage } from "./brain-workspace-storage.ts";
import { persistDocumentOutput, prepareDocumentToolInput, registerDocumentAgentTools, syncDocumentOutputs } from "./document-agent-tools.ts";

test("prepareDocumentToolInput injects format and runs validate", () => {
  const validated = prepareDocumentToolInput("document.create_pdf", { title: "汇报", content: "正文" }, (input) => ({
    ...input,
    format: "pdf",
    targetPath: "outputs/汇报.pdf"
  }));
  assert.equal(validated.format, "pdf");
  assert.equal(validated.targetPath, "outputs/汇报.pdf");

  const docx = prepareDocumentToolInput("document.create_docx", { title: "稿", content: "段" });
  assert.equal(docx.format, "docx");
});

test("persistDocumentOutput registers file and artifact for outputs docx", async () => {
  const root = await mkdtemp(join(tmpdir(), "brain-doc-tools-"));
  const storage = new BrainWorkspaceStorage(join(root, "brain.sqlite"));
  const project = storage.createProject({
    ownerId: "owner-a",
    name: "文档项目",
    primaryWorkspaceKey: "document",
    localWorkspaceId: "ws-doc-1"
  });
  await mkdir(join(root, "outputs"), { recursive: true });
  const relativePath = "outputs/汇报.docx";
  await writeFile(join(root, relativePath), Buffer.from("PK\u0003\u0004fake-docx"));

  const persisted = await persistDocumentOutput({
    ownerId: async () => "owner-a",
    projectId: project.id,
    projectRoot: root,
    storage
  }, relativePath);

  assert.ok(persisted);
  assert.equal(persisted.relativePath, relativePath);
  assert.equal(storage.listFiles("owner-a", project.id).length, 1);
  assert.equal(storage.listArtifacts("owner-a", project.id).length, 1);
  assert.equal(storage.listFiles("owner-a", project.id)[0].logicalName, "汇报.docx");
});

test("syncDocumentOutputs registers existing outputs and wrappers notify after create", async () => {
  const root = await mkdtemp(join(tmpdir(), "brain-doc-sync-"));
  const storage = new BrainWorkspaceStorage(join(root, "brain-sync.sqlite"));
  const project = storage.createProject({
    ownerId: "owner-a",
    name: "文档同步",
    primaryWorkspaceKey: "document",
    localWorkspaceId: "ws-doc-2"
  });
  await mkdir(join(root, "outputs"), { recursive: true });
  await writeFile(join(root, "outputs", "报告.pdf"), Buffer.from("%PDF-1.4 fake"));

  const notifications: Array<{ projectId: string; reason: string }> = [];
  const seenFormats: string[] = [];
  const tools = new Map<string, { definition: Record<string, unknown>; execute: Function }>();
  const runtime = {
    toolRegistry: {
      get(name: string) {
        if (name === "document.create_pdf") {
          return {
            name,
            title: "Create PDF",
            description: "Create PDF",
            kind: "write",
            risk: "medium",
            requiresApproval: false,
            inputSchema: { type: "object" },
            validate(input: Record<string, unknown>) {
              return { ...input, format: "pdf", title: String(input.title || "报告") };
            },
            async execute(input: Record<string, unknown>) {
              seenFormats.push(String(input.format || ""));
              const targetPath = String(input.targetPath || "outputs/报告.pdf");
              await writeFile(join(root, targetPath), Buffer.from("%PDF-1.4 created"));
              return { ok: true, output: "created", artifact: { path: targetPath, size: 14, changeType: "created" } };
            }
          };
        }
        if (name === "document.create_docx") {
          return {
            name,
            title: "Create DOCX",
            description: "Create DOCX",
            kind: "write",
            risk: "medium",
            requiresApproval: false,
            inputSchema: { type: "object" },
            async execute(input: Record<string, unknown>) {
              seenFormats.push(String(input.format || ""));
              const targetPath = String(input.targetPath || "outputs/报告.docx");
              await writeFile(join(root, targetPath), Buffer.from("PK\u0003\u0004created"));
              return { ok: true, output: "created", artifact: { path: targetPath, size: 12, changeType: "created" } };
            }
          };
        }
        return tools.get(name)?.definition as never;
      }
    },
    unregisterExternalTools(namespace?: string) {
      for (const [name, value] of tools) {
        if (value.definition.namespace === namespace) tools.delete(name);
      }
    },
    registerExternalTool(definition: Record<string, unknown>, execute: Function) {
      tools.set(String(definition.name), { definition, execute });
    }
  };

  registerDocumentAgentTools(runtime, {
    ownerId: async () => "owner-a",
    projectId: project.id,
    projectRoot: root,
    storage,
    notifyUi: (payload) => notifications.push(payload)
  });

  const synced = await syncDocumentOutputs({
    ownerId: async () => "owner-a",
    projectId: project.id,
    projectRoot: root,
    storage
  });
  assert.ok(synced.synced.includes("outputs/报告.pdf"));

  const wrapped = tools.get("document.create_pdf");
  assert.ok(wrapped);
  const result = await wrapped.execute({ targetPath: "outputs/新稿.pdf", title: "新稿", content: "正文" }, { workspacePath: root });
  assert.equal(result.ok, true);
  assert.ok(seenFormats.includes("pdf"));
  assert.ok(storage.listFiles("owner-a", project.id).some((file) => file.storageKey === "outputs/新稿.pdf"));
  assert.ok(storage.listArtifacts("owner-a", project.id).some((item) => item.storageKey === "outputs/新稿.pdf"));
  assert.ok(notifications.some((item) => item.projectId === project.id));

  const wrappedDocx = tools.get("document.create_docx");
  assert.ok(wrappedDocx);
  const docxResult = await wrappedDocx.execute({ targetPath: "outputs/新稿.docx", title: "新稿", content: "正文" }, { workspacePath: root });
  assert.equal(docxResult.ok, true);
  assert.ok(seenFormats.includes("docx"));
});
