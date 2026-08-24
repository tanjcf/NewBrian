import assert from "node:assert/strict";
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
    "video.shot.generate",
    "video.render.start",
    "video.render.status"
  ]);
  assert.equal(tools.get("video.project.inspect")?.definition.requiresApproval, false);
  assert.equal(tools.get("video.pipeline.save")?.definition.requiresApproval, true);
  assert.equal(tools.get("video.shot.generate")?.definition.namespace, "video");
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
