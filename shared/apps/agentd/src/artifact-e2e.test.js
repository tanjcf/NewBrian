import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createBuiltinCapabilityRuntime } from "./tool-registry.js";

test("document and presentation artifacts complete through capability runtime", async (t) => {
  const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "brain-artifacts-"));
  t.after(() => fs.rm(workspacePath, { recursive: true, force: true }));
  const runtime = createBuiltinCapabilityRuntime();
  const sections = [{ heading: "Summary", body: "A verified document artifact.", bullets: ["One", "Two"] }];
  for (const [capability, targetPath] of [["document.create_docx", "outputs/report.docx"], ["document.create_pdf", "outputs/report.pdf"]]) {
    const result = await runtime.invoke(capability, { targetPath, title: "Report", sections }, { approved: true, workspacePath });
    assert.equal(result.status, "completed", `${capability} should complete`);
    assert.equal(result.output.artifact.verified, true);
    assert.equal(result.verification.status, "verified");
  }
  const presentation = await runtime.invoke("artifact.create", { targetPath: "outputs/briefing.pptx", format: "pptx", title: "Briefing", sections }, { approved: true, workspacePath });
  assert.equal(presentation.status, "completed");
  assert.equal(presentation.output.artifact.format, "pptx");
  for (const file of ["outputs/report.docx", "outputs/report.pdf", "outputs/briefing.pptx"]) assert.equal((await fs.stat(path.join(workspacePath, file))).isFile(), true);
});
