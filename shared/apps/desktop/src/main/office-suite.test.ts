import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { convertOfficeFile, detectOfficeEditors, openOfficeFile, type OfficeSuiteDependencies } from "./office-suite.ts";

function fakeSuite(overrides: Partial<OfficeSuiteDependencies> = {}): OfficeSuiteDependencies {
  return {
    platform: "win32",
    env: { ProgramFiles: "C:\\Program Files", LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local" },
    accessPath: async (path) => {
      if (String(path).includes("soffice.exe")) return;
      throw new Error("missing");
    },
    lookup: () => ({ status: 1, stdout: "" }),
    spawnCommand: async () => ({ status: 0, stdout: "", stderr: "" }),
    openDetached: () => undefined,
    realpath: async (path) => path,
    statFile: async () => ({ isFile: () => true, size: 12 }),
    ensureDir: async () => undefined,
    ...overrides
  };
}

test("prefers LibreOffice when soffice is installed", async () => {
  const status = await detectOfficeEditors(fakeSuite());
  assert.equal(status.preferred, "libreoffice");
  assert.equal(status.editors.find((editor) => editor.id === "wps")?.available, false);
});

test("opens a project docx with LibreOffice and rejects paths outside the project", async () => {
  const root = await mkdtemp(join(tmpdir(), "office-suite-"));
  const outside = await mkdtemp(join(tmpdir(), "office-outside-"));
  await mkdir(join(root, "outputs"));
  await writeFile(join(root, "outputs", "汇报.docx"), "docx");
  await writeFile(join(outside, "secret.docx"), "secret");
  const opened: string[][] = [];
  const suite = fakeSuite({
    openDetached: (command, args) => { opened.push([command, ...args]); }
  });
  const result = await openOfficeFile(root, "outputs/汇报.docx", suite);
  assert.equal(result.ok, true);
  assert.match(opened[0]?.[0] ?? "", /soffice\.exe$/);
  assert.match(opened[0]?.[1] ?? "", /汇报\.docx$/);
  await assert.rejects(() => openOfficeFile(root, join(outside, "secret.docx"), suite), /OFFICE_PATH_OUTSIDE_PROJECT/);
});

test("convert writes the LibreOffice result under outputs", async () => {
  const root = await mkdtemp(join(tmpdir(), "office-convert-"));
  await mkdir(join(root, "outputs"));
  await writeFile(join(root, "outputs", "表.xlsx"), "xlsx");
  const suite = fakeSuite({
    spawnCommand: async (_command, args) => {
      assert.equal(args[0], "--headless");
      assert.equal(args[4], "pdf");
      await writeFile(join(root, "outputs", "表.pdf"), "pdf-bytes");
      return { status: 0, stdout: "", stderr: "" };
    }
  });
  const result = await convertOfficeFile(root, "outputs/表.xlsx", "pdf", suite);
  assert.equal(result.ok, true);
  assert.equal(result.artifact?.path.replaceAll("\\", "/"), "outputs/表.pdf");
  assert.ok((result.artifact?.size ?? 0) > 0);
});

test("convert reports a missing LibreOffice install instead of launching another editor", async () => {
  const root = await mkdtemp(join(tmpdir(), "office-missing-"));
  await mkdir(join(root, "outputs"));
  await writeFile(join(root, "outputs", "稿.docx"), "docx");
  let spawned = false;
  const result = await convertOfficeFile(root, "outputs/稿.docx", "pdf", fakeSuite({
    accessPath: async () => { throw new Error("missing"); },
    spawnCommand: async () => { spawned = true; return { status: 0, stdout: "", stderr: "" }; }
  }));
  assert.equal(result.ok, false);
  assert.equal(result.code, "OFFICE_LIBREOFFICE_REQUIRED");
  assert.equal(spawned, false);
});
