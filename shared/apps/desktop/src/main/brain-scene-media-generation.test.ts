import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { bindClipToPipelineShot, persistSceneVideoClip } from "./brain-scene-media-generation.ts";

test("persistSceneVideoClip writes under media/clips and registers storage key", async () => {
  const root = await mkdtemp(join(tmpdir(), "brain-scene-media-"));
  const registered: Array<{ storageKey: string; mimeType: string }> = [];
  try {
    const source = join(root, "remote.mp4");
    await writeFile(source, Buffer.from("fake-mp4-bytes-for-test"));
    const fileUrl = `file://${source.replaceAll("\\", "/")}`;
    // Use http mock via custom fetch that returns the local bytes
    const persisted = await persistSceneVideoClip(
      {
        ownerId: async () => "owner",
        projectId: "proj-1",
        projectRoot: root,
        storage: {
          registerFile: (input: { storageKey: string; mimeType: string }) => {
            registered.push({ storageKey: input.storageKey, mimeType: input.mimeType });
            return { id: "file-1", ...input };
          }
        } as any,
        videoRuntime: {} as any,
        fetchImpl: (async () => new Response(await readFile(source), { status: 200 })) as typeof fetch
      },
      "https://cdn.example/shot.mp4",
      0
    );
    assert.match(persisted.relativePath, /^media\/clips\/shot-001-\d+\.mp4$/);
    assert.equal(persisted.fileId, "file-1");
    assert.equal(registered[0]?.storageKey, persisted.relativePath);
    const bytes = await readFile(join(root, persisted.relativePath));
    assert.equal(bytes.toString("utf8"), "fake-mp4-bytes-for-test");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("bindClipToPipelineShot marks shot ready with clip path", async () => {
  const saves: unknown[] = [];
  const state = await bindClipToPipelineShot(
    {
      projectId: "proj-1",
      projectRoot: "/tmp/proj",
      videoRuntime: {
        pipelineGet: async () => ({
          state: {
            script: "脚本",
            shots: [
              { title: "A", line: "", prompt: "p", clip: "", ready: false, transition: "cut" },
              { title: "B", line: "", prompt: "p2", clip: "", ready: false, transition: "fade" }
            ],
            exportFormat: "mp4"
          }
        }),
        pipelineSave: async (_binding: unknown, next: unknown) => {
          saves.push(next);
          return next;
        }
      } as any
    },
    1,
    "media/clips/shot-002.mp4"
  );
  assert.equal(state.shots[1]?.ready, true);
  assert.equal(state.shots[1]?.clip, "media/clips/shot-002.mp4");
  assert.equal(state.shots[0]?.ready, false);
  assert.equal(saves.length, 1);
});
