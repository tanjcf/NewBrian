import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { registerMusicAgentTools } from "./music-agent-tools.ts";

type RegisteredTool = {
  definition: Record<string, unknown>;
  execute: (input: Record<string, unknown>) => Promise<{ ok: boolean; output: string }>;
};

function fixture() {
  const tools = new Map<string, RegisteredTool>();
  const saved: unknown[] = [];
  const notifies: Array<{ projectId: string; reason: string }> = [];
  const runtime = {
    unregisterExternalTools(namespace?: string) {
      assert.equal(namespace, "music");
    },
    registerExternalTool(definition: Record<string, unknown>, execute: RegisteredTool["execute"]) {
      tools.set(String(definition.name), { definition, execute });
    }
  };
  registerMusicAgentTools(runtime, {
    ownerId: async () => "owner-a",
    projectId: "project-a",
    projectRoot: "C:\\music-project",
    storage: {
      listFiles: () => [],
      registerFile: () => {
        throw new Error("not used");
      }
    } as never,
    musicRuntime: {
      dawGet: async () => ({
        state: {
          title: "草稿",
          lyrics: "一句歌词",
          style: { genre: "pop" },
          tracks: [],
          markers: [],
          segments: [],
          exportFormat: "wav"
        }
      }),
      dawSave: async (_binding: unknown, state: unknown) => {
        saved.push(state);
        return { state };
      },
      cook: async () => ({ cooked: true })
    } as never,
    timeline: {
      getTimeline: () => {
        throw new Error("BRAIN_MUSIC_TIMELINE_NOT_FOUND");
      },
      ensureTimeline: () => ({}),
      addClip: () => ({ clips: [] })
    } as never,
    render: {} as never,
    generateMusic: async () => {
      throw new Error("not used");
    },
    notifyUi: (payload) => notifies.push(payload)
  });
  return { tools, saved, notifies };
}

test("registers the complete project-scoped music Agent tool surface", () => {
  const { tools } = fixture();
  assert.deepEqual([...tools.keys()], [
    "music.project.inspect",
    "music.daw.save",
    "music.song.generate",
    "music.daw.cook",
    "music.render.start",
    "music.render.status"
  ]);
  assert.equal(tools.get("music.project.inspect")?.definition.requiresApproval, false);
  assert.equal(tools.get("music.daw.save")?.definition.requiresApproval, true);
  assert.equal(tools.get("music.song.generate")?.definition.namespace, "music");
});

test("daw.save persists title and lyrics into MusicRuntimeService and notifies UI", async () => {
  const { tools, saved, notifies } = fixture();
  const result = await tools.get("music.daw.save")!.execute({
    title: "  青丘谣  ",
    lyrics: "山风起\n狐火明",
    style: { genre: "folk", bpm: 88 }
  });
  assert.equal(result.ok, true);
  assert.equal((saved[0] as { title: string }).title, "青丘谣");
  assert.equal((saved[0] as { lyrics: string }).lyrics, "山风起\n狐火明");
  assert.deepEqual(notifies, [{ projectId: "project-a", reason: "music:daw.save" }]);
});

test("song.generate downloads audio, updates DAW track, and notifies the Tools panel", async () => {
  const root = await mkdtemp(join(tmpdir(), "brain-music-agent-"));
  try {
    const tools = new Map<string, RegisteredTool>();
    const saved: unknown[] = [];
    const clips: unknown[] = [];
    const notifies: Array<{ projectId: string; reason: string }> = [];
    let registeredStorageKey = "";
    registerMusicAgentTools(
      {
        unregisterExternalTools() {},
        registerExternalTool(definition, execute) {
          tools.set(String(definition.name), { definition, execute });
        }
      },
      {
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
        musicRuntime: {
          dawGet: async () => ({
            state: {
              title: "旧标题",
              lyrics: "",
              style: {},
              tracks: [],
              markers: [],
              segments: [],
              exportFormat: "wav"
            }
          }),
          dawSave: async (_binding: unknown, state: unknown) => {
            saved.push(state);
            return { state };
          },
          cook: async () => ({})
        } as never,
        timeline: {
          ensureTimeline: () => ({}),
          addClip: (_owner: string, _project: string, clip: unknown) => {
            clips.push(clip);
            return { clips: [clip] };
          },
          getTimeline: () => ({ clips: [] })
        } as never,
        render: {} as never,
        generateMusic: async () => ({
          url: "https://example-cos.cos.ap-guangzhou.myqcloud.com/song.mp3",
          providerResult: { job: "ok" }
        }),
        notifyUi: (payload) => notifies.push(payload),
        fetchImpl: (async () =>
          new Response(Buffer.from("ID3fake-audio-bytes-here"), {
            status: 200,
            headers: { "content-type": "audio/mpeg" }
          })) as typeof fetch
      }
    );
    const result = await tools.get("music.song.generate")!.execute({
      title: "青丘谣",
      lyrics: "山风起",
      style: "folk"
    });
    assert.equal(result.ok, true);
    assert.match(registeredStorageKey, /^media\/stems\/song-\d+\.mp3$/);
    assert.equal((saved[0] as { title: string }).title, "青丘谣");
    assert.ok(Array.isArray((saved[0] as { tracks: unknown[] }).tracks));
    assert.equal(((saved[0] as { tracks: Array<{ clip: string }> }).tracks[0]).clip, registeredStorageKey);
    assert.equal((clips[0] as { sourceFileId: string }).sourceFileId, "file-a");
    assert.deepEqual(notifies, [{ projectId: "project-a", reason: "music:song.generate" }]);
    assert.match(result.output, /右侧 Tools/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
