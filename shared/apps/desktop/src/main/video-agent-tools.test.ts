import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { registerVideoAgentTools } from "./video-agent-tools.ts";

type RegisteredTool = {
  definition: Record<string, unknown>;
  execute: (input: Record<string, unknown>) => Promise<{ ok: boolean; output: string }>;
};

function fixture() {
  const tools = new Map<string, RegisteredTool>();
  const saved: unknown[] = [];
  const runtime = {
    unregisterExternalTools(namespace?: string) {
      assert.equal(namespace, "video");
    },
    registerExternalTool(
      definition: Record<string, unknown>,
      execute: RegisteredTool["execute"]
    ) {
      tools.set(String(definition.name), { definition, execute });
    }
  };
  registerVideoAgentTools(runtime, {
    ownerId: async () => "owner-a",
    projectId: "project-a",
    projectRoot: "C:\\video-project",
    storage: {
      listFiles: () => [],
      registerFile: () => { throw new Error("not used"); }
    } as never,
    videoRuntime: {
      pipelineGet: async () => ({ state: { script: "script", shots: [{ title: "shot", line: "line", prompt: "prompt", clip: "", ready: false, transition: "cut" }] } }),
      pipelineSave: async (_binding: unknown, state: unknown) => {
        saved.push(state);
        return { state };
      }
    } as never,
    timeline: {} as never,
    render: {} as never,
    generateVideo: async () => { throw new Error("not used"); }
  });
  return { tools, saved };
}

test("registers the complete project-scoped video Agent tool surface", () => {
  const { tools } = fixture();
  assert.deepEqual([...tools.keys()], [
    "video.project.inspect",
    "video.pipeline.save",
    "video.timeline.configure",
    "video.subtitle.import",
    "video.timeline.add_clip",
    "video.audio.speech",
    "video.audio.ambient",
    "video.shot.generate",
    "video.render.start",
    "video.render.status"
  ]);
  assert.equal(tools.get("video.project.inspect")?.definition.requiresApproval, false);
  assert.equal(tools.get("video.pipeline.save")?.definition.requiresApproval, true);
  assert.equal(tools.get("video.shot.generate")?.definition.namespace, "video");
});

test("timeline add clip accepts only an existing project file with a matching media type", async () => {
  const tools = new Map<string, RegisteredTool>();
  const added: unknown[] = [];
  registerVideoAgentTools({
    unregisterExternalTools() {},
    registerExternalTool(definition, execute) { tools.set(String(definition.name), { definition, execute }); }
  }, {
    ownerId: async () => "owner-a", projectId: "project-a", projectRoot: "C:\\video-project",
    storage: {
      getFile: (_ownerId: string, _projectId: string, fileId: string) => ({ id: fileId, mimeType: "video/mp4", storageKey: "media/shot.mp4" }),
      listFiles: () => []
    } as never,
    videoRuntime: {} as never,
    timeline: {
      ensureTimeline: () => ({}),
      addClip: (_ownerId: string, _projectId: string, clip: unknown) => { added.push(clip); return { clips: [clip] }; }
    } as never,
    render: {} as never,
    generateVideo: async () => { throw new Error("not used"); }
  });
  const result = await tools.get("video.timeline.add_clip")!.execute({ fileId: "file-a", trackType: "video", startMs: 0, durationMs: 4_000 });
  assert.equal(result.ok, true);
  assert.deepEqual(added, [{ trackType: "video", sourceFileId: "file-a", startMs: 0, durationMs: 4_000, sourceInMs: 0, volume: 1 }]);
  await assert.rejects(
    tools.get("video.timeline.add_clip")!.execute({ fileId: "file-a", trackType: "audio", startMs: 0, durationMs: 4_000 }),
    /BRAIN_VIDEO_CLIP_MEDIA_TYPE_MISMATCH/
  );
});

test("pipeline tool persists normalized script and shots through VideoRuntimeService", async () => {
  const { tools, saved } = fixture();
  const result = await tools.get("video.pipeline.save")!.execute({
    script: "  青石谷清晨  ",
    shots: [{ title: " 入口 ", line: " 晨光 ", prompt: " 航拍 ", transition: " dissolve " }]
  });
  assert.equal(result.ok, true);
  assert.deepEqual(saved, [{
    script: "青石谷清晨",
    shots: [{ title: "入口", line: "晨光", prompt: "航拍", clip: "", ready: false, transition: "dissolve" }],
    exportFormat: "mp4"
  }]);
});

test("pipeline tool rejects an empty storyboard instead of fabricating data", async () => {
  const { tools } = fixture();
  await assert.rejects(
    tools.get("video.pipeline.save")!.execute({ script: "script", shots: [] }),
    /script and at least one valid shot are required/
  );
});

test("shot generation downgrades only a trusted Tencent COS URL after TLS failure", async () => {
  const root = await mkdtemp(join(tmpdir(), "brain-video-agent-"));
  try {
    const tools = new Map<string, RegisteredTool>();
    const requested: string[] = [];
    let registeredStorageKey = "";
    registerVideoAgentTools({
      unregisterExternalTools() {},
      registerExternalTool(definition, execute) {
        tools.set(String(definition.name), { definition, execute });
      }
    }, {
      ownerId: async () => "owner-a",
      projectId: "project-a",
      projectRoot: root,
      storage: {
        registerFile: (input: { storageKey: string }) => {
          registeredStorageKey = input.storageKey;
          return { id: "file-a", storageKey: input.storageKey };
        },
        listFiles: () => []
      } as never,
      videoRuntime: {
        pipelineGet: async () => ({ state: { script: "script", shots: [{ title: "shot", line: "line", prompt: "prompt", clip: "", ready: false, transition: "cut" }] } }),
        pipelineSave: async (_binding: unknown, state: unknown) => ({ state })
      } as never,
      timeline: {
        ensureTimeline: () => ({}),
        addClip: () => ({ clips: [{ sourceFileId: "file-a" }] })
      } as never,
      render: {} as never,
      generateVideo: async () => ({
        url: "https://vcg-prod-1.cos.ap-guangzhou.tencentcos.cn/result.mp4?signature=redacted",
        providerResult: { id: "job-a" }
      }),
      fetchImpl: async (input) => {
        const url = String(input);
        requested.push(url);
        if (url.startsWith("https:")) throw new TypeError("fetch failed");
        return new Response(Buffer.from("real-mp4-bytes"), {
          status: 206,
          headers: { "content-type": "video/mp4", "content-length": "14" }
        });
      }
    });
    const result = await tools.get("video.shot.generate")!.execute({
      shotIndex: 0,
      prompt: "prompt",
      startMs: 0,
      durationMs: 4_000
    });
    assert.equal(result.ok, true);
    assert.equal(requested.length, 2);
    assert.match(requested[0]!, /^https:/);
    assert.match(requested[1]!, /^http:/);
    assert.match(registeredStorageKey, /^media\/clips\/shot-001-/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
