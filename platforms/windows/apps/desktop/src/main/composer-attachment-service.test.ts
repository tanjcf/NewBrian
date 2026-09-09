import assert from "node:assert/strict";
import test from "node:test";
import { assertAttachmentSize } from "./attachment-security.ts";

const { ComposerAttachmentService } = await import(new URL("./composer-attachment-service.ts", import.meta.url).href);

function fixture(options: {
  selectFiles?: () => Promise<string[]>;
  sizes?: Record<string, number>;
  assertSize?: (extension: string, size: number) => void;
} = {}) {
  const writes: string[] = [];
  const copies: Array<{ source: string; target: string }> = [];
  const sizes = options.sizes ?? {};
  const service = new ComposerAttachmentService({
    attachmentRoot: "G:/state/attachments",
    selectFiles: options.selectFiles ?? (async () => ["G:/source/one.txt", "G:/source/two.png"]),
    statFile: async (path: string) => ({
      isFile: () => true,
      size: sizes[path] ?? 4
    }),
    ensureDirectory: async () => undefined,
    copyFile: async (source: string, target: string) => { copies.push({ source, target }); },
    writeFile: async (path: string) => { writes.push(path); },
    readFile: async () => new Uint8Array([1, 2, 3]),
    openPath: async () => "",
    assertSize: options.assertSize ?? (() => undefined),
    getImageMimeType: (extension: string) => extension === ".png" ? "image/png" : "",
    nowMs: () => 100,
    makeId: () => "id"
  } as never);
  return { service, copies, writes };
}

test("copies selected files into the managed attachment root", async () => {
  const { service, copies } = fixture();
  const result = await service.select();
  assert.equal(result.attachments.length, 2);
  assert.equal(result.skipped.length, 0);
  assert.equal(result.detail, "");
  assert.equal(copies.length, 2);
  assert.match(result.attachments[1].url, /^data:image\/png;base64,/);
});

test("skips oversized selections instead of failing the whole batch", async () => {
  const { service, copies } = fixture({
    selectFiles: async () => ["G:/source/ok.txt", "G:/source/huge.pdf", "G:/source/photo.png"],
    sizes: {
      "G:/source/ok.txt": 4,
      "G:/source/huge.pdf": 21 * 1024 * 1024,
      "G:/source/photo.png": 11 * 1024 * 1024
    },
    assertSize: assertAttachmentSize
  });
  const result = await service.select();
  assert.equal(result.attachments.length, 1);
  assert.equal(result.attachments[0].name, "ok.txt");
  assert.equal(result.skipped.length, 2);
  assert.match(result.detail, /已添加 1 个附件/);
  assert.match(result.detail, /huge\.pdf/);
  assert.match(result.detail, /photo\.png/);
  assert.equal(copies.length, 1);
});

test("reports Chinese detail when every selected file exceeds the limit", async () => {
  const { service, copies } = fixture({
    selectFiles: async () => ["G:/source/huge.pdf"],
    sizes: { "G:/source/huge.pdf": 21 * 1024 * 1024 },
    assertSize: assertAttachmentSize
  });
  const result = await service.select();
  assert.equal(result.attachments.length, 0);
  assert.equal(result.skipped.length, 1);
  assert.match(result.detail, /超过 20 MB 限制/);
  assert.match(result.detail, /已跳过/);
  assert.equal(copies.length, 0);
});

test("rejects opening a file outside the managed attachment root", async () => {
  const { service } = fixture();
  const result = await service.open({ path: "G:/outside/secret.txt" });
  assert.equal(result.ok, false);
  assert.match(result.detail, /outside/);
});

test("persists clipboard bytes under a sanitized generated name", async () => {
  const { service, writes } = fixture();
  const attachment = await service.saveClipboard({
    name: "pasted?.png",
    mimeType: "image/png",
    data: new Uint8Array([1, 2]).buffer
  });
  assert.equal(writes.length, 1);
  assert.match(attachment.path.replaceAll("\\", "/"), /attachments\/100-id\.png$/);
});

test("resolves stable and Chromium-rewritten attachment protocol URLs", async () => {
  const { resolveManagedAttachmentPath, buildManagedAttachmentUrl } = await import(
    new URL("./composer-attachment-service.ts", import.meta.url).href
  );
  const root = "G:/state/attachments";
  const managed = "1784-abc.png";
  assert.equal(
    resolveManagedAttachmentPath(buildManagedAttachmentUrl(`${root}/${managed}`), root)?.replaceAll("\\", "/"),
    `${root}/${managed}`
  );
  assert.equal(
    resolveManagedAttachmentPath(`newbrain-attachment:///${managed}`, root)?.replaceAll("\\", "/"),
    `${root}/${managed}`
  );
  assert.equal(
    resolveManagedAttachmentPath(`newbrain-attachment://${managed}/`, root)?.replaceAll("\\", "/"),
    `${root}/${managed}`
  );
  assert.equal(
    resolveManagedAttachmentPath(`newbrain-attachment://${managed}`, root)?.replaceAll("\\", "/"),
    `${root}/${managed}`
  );
  assert.equal(resolveManagedAttachmentPath("newbrain-attachment://media/", root), null);
  assert.equal(resolveManagedAttachmentPath("newbrain-attachment://media/sub/dir.png", root), null);
  assert.equal(resolveManagedAttachmentPath("newbrain-attachment://evil.host/file.png", root), null);
});
