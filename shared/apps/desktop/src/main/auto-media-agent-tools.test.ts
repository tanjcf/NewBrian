import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  downloadGeneratedMediaToWorkspace,
  persistGeneratedMediaToProject,
  registerAutoMediaAgentTools,
  resolveAutoMediaReferenceImage
} from "./auto-media-agent-tools.ts";

function registerCapture(workspaceRoot: string, extras?: Partial<{
  resolveGateway: () => Promise<{ baseUrl: string; bearerToken: string }>;
  fetchImpl: typeof fetch;
  openLocalMedia: (input: { kind: "image" | "video"; relativePath: string }) => Promise<void> | void;
}>) {
  const tools = new Map<string, {
    definition: Record<string, unknown>;
    execute: (input: Record<string, unknown>) => Promise<{ ok: boolean; output: string }>;
  }>();
  registerAutoMediaAgentTools({
    unregisterExternalTools() {},
    registerExternalTool(definition, execute) {
      tools.set(String(definition.name), { definition, execute });
    }
  }, {
    workspaceId: "ws-1",
    threadId: "th-1",
    workspaceRoot,
    resolveGateway: extras?.resolveGateway
      ?? (async () => ({ baseUrl: "https://gateway.example/v1", bearerToken: "tok" })),
    fetchImpl: extras?.fetchImpl,
    openLocalMedia: extras?.openLocalMedia
  });
  return tools;
}

test("registerAutoMediaAgentTools exposes image_generate, video_generate, and music_generate", async () => {
  const root = await mkdtemp(join(tmpdir(), "auto-media-"));
  try {
    const tools = registerCapture(root);
    assert.ok(tools.has("image_generate"));
    assert.ok(tools.has("video_generate"));
    assert.ok(tools.has("music_generate"));
    assert.match(String(tools.get("image_generate")!.definition.description), /能力询问/);
    assert.match(String(tools.get("music_generate")!.definition.description), /Suno\/Udio/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("downloadGeneratedMediaToWorkspace writes music under .newbrain/generated-media", async () => {
  const root = await mkdtemp(join(tmpdir(), "auto-media-dl-"));
  try {
    const mp3 = Buffer.from([0x49, 0x44, 0x33, 0x03, 0x00, 0x00]);
    const saved = await downloadGeneratedMediaToWorkspace({
      workspaceRoot: root,
      kind: "music",
      url: "https://cos.ap-guangzhou.myqcloud.com/demo/a.mp3",
      fetchImpl: async () => new Response(mp3, {
        status: 200,
        headers: { "Content-Type": "audio/mpeg" }
      })
    });
    assert.match(saved.relativePath, /^\.newbrain\/generated-media\/music\/.+\.mp3$/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("downloadGeneratedMediaToWorkspace writes under .newbrain/generated-media", async () => {
  const root = await mkdtemp(join(tmpdir(), "auto-media-dl-"));
  try {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
    const saved = await downloadGeneratedMediaToWorkspace({
      workspaceRoot: root,
      kind: "image",
      url: "https://cos.ap-guangzhou.myqcloud.com/demo/a.png",
      fetchImpl: async () => new Response(png, {
        status: 200,
        headers: { "Content-Type": "image/png" }
      })
    });
    assert.match(saved.relativePath, /^\.newbrain\/generated-media\/image\/.+\.png$/);
    const bytes = await readFile(saved.absolutePath);
    assert.deepEqual(bytes, png);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("image_generate downloads COS result and opens local preview", async () => {
  const root = await mkdtemp(join(tmpdir(), "auto-media-gen-"));
  const opened: string[] = [];
  try {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x02]);
    const tools = registerCapture(root, {
      openLocalMedia: async ({ relativePath }) => {
        opened.push(relativePath);
      },
      fetchImpl: async (url, init) => {
        const href = String(url);
        if (href.endsWith("/auto/tools/invoke")) {
          return new Response(JSON.stringify({
            job_id: "job-1",
            tool: "image_generate",
            state: "SUCCEEDED",
            reply: "图片已生成完成（任务 job-1）。",
            result_json: JSON.stringify({ urls: ["https://cos.ap-guangzhou.myqcloud.com/demo/a.png"] })
          }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        if (href.includes("myqcloud.com")) {
          return new Response(png, { status: 200, headers: { "Content-Type": "image/png" } });
        }
        return new Response(String(init?.body || "{}"), { status: 404 });
      }
    });
    const result = await tools.get("image_generate")!.execute({ prompt: "青石谷入口" });
    assert.equal(result.ok, true);
    assert.match(result.output, /\.newbrain\/generated-media\/image\//);
    assert.match(result.output, /禁止再写「正在生成中」/);
    assert.equal(opened.length, 1);
    assert.match(opened[0]!, /\.newbrain\/generated-media\/image\//);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("image_generate rejects capability-style empty prompt", async () => {
  const root = await mkdtemp(join(tmpdir(), "auto-media-empty-"));
  try {
    const tools = registerCapture(root);
    const result = await tools.get("image_generate")!.execute({});
    assert.equal(result.ok, false);
    assert.match(result.output, /prompt/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("resolveAutoMediaReferenceImage converts workspace-local paths to data URLs", async () => {
  const root = await mkdtemp(join(tmpdir(), "auto-media-ref-"));
  try {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x03]);
    const relativePath = ".newbrain/generated-media/image/ref.png";
    await mkdir(join(root, ".newbrain", "generated-media", "image"), { recursive: true });
    await writeFile(join(root, relativePath), png);
    const resolved = await resolveAutoMediaReferenceImage({
      workspaceRoot: root,
      imageUrl: relativePath
    });
    assert.match(resolved, /^data:image\/png;base64,/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("resolveAutoMediaReferenceImage accepts managed chat attachment paths outside the workspace", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "auto-media-ws-"));
  const attachmentRoot = await mkdtemp(join(tmpdir(), "auto-media-att-"));
  try {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x07]);
    const attachmentPath = join(attachmentRoot, "1788354236922-e099a846-fee7-4718-a830-0d93f06a75a8.jpg");
    await writeFile(attachmentPath, png);
    const resolved = await resolveAutoMediaReferenceImage({
      workspaceRoot,
      attachmentRoots: [attachmentRoot],
      imageUrl: attachmentPath
    });
    assert.match(resolved, /^data:image\/jpeg;base64,/);
    const staged = await readFile(join(workspaceRoot, ".newbrain", "attachments", "1788354236922-e099a846-fee7-4718-a830-0d93f06a75a8.jpg"));
    assert.equal(staged.length, png.length);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
    await rm(attachmentRoot, { recursive: true, force: true });
  }
});

test("resolveAutoMediaReferenceImage rejects arbitrary paths outside workspace and attachment roots", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "auto-media-deny-ws-"));
  const outsider = await mkdtemp(join(tmpdir(), "auto-media-deny-out-"));
  try {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x08]);
    const outsiderPath = join(outsider, "secret.png");
    await writeFile(outsiderPath, png);
    await assert.rejects(
      () => resolveAutoMediaReferenceImage({
        workspaceRoot,
        attachmentRoots: [],
        imageUrl: outsiderPath
      }),
      /工作区或聊天附件目录/
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
    await rm(outsider, { recursive: true, force: true });
  }
});

test("persistGeneratedMediaToProject registers file artifact and task", async () => {
  const root = await mkdtemp(join(tmpdir(), "auto-media-persist-"));
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x04]);
  const relativePath = ".newbrain/generated-media/image/persisted.png";
  await mkdir(join(root, ".newbrain", "generated-media", "image"), { recursive: true });
  await writeFile(join(root, relativePath), png);
  const files: Array<{ id: string; storageKey: string; contentHash: string; versionNo?: number }> = [];
  const artifacts: Array<{ id: string; storageKey: string; contentHash: string }> = [];
  const tasks: Array<{ id: string; status: string }> = [];
  const storage = {
    listFiles: () => files,
    registerFile: (input: { storageKey: string; contentHash: string; versionNo?: number }) => {
      const file = { id: "file-1", ...input };
      files.push(file);
      return file;
    },
    listArtifacts: () => artifacts,
    registerArtifact: (input: { storageKey: string; contentHash: string }) => {
      const artifact = { id: "artifact-1", ...input };
      artifacts.push(artifact);
      return artifact;
    },
    createTask: () => ({ id: "task-1" }),
    updateTask: (_input: { status: string }) => {
      tasks.push({ id: "task-1", status: _input.status });
      return tasks[tasks.length - 1];
    }
  };
  try {
    const persisted = await persistGeneratedMediaToProject({
      ownerId: async () => "owner-a",
      projectId: "project-1",
      workspaceKey: "explore",
      storage: storage as never
    }, {
      toolName: "image_generate",
      relativePath,
      workspaceRoot: root,
      jobId: "job-persist-1"
    });
    assert.ok(persisted);
    assert.equal(files.length, 1);
    assert.equal(artifacts.length, 1);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0]?.status, "SUCCEEDED");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
