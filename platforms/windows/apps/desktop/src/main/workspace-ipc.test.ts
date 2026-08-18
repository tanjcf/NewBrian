import assert from "node:assert/strict";
import test from "node:test";

const { parseWorkspaceFileAction } = await import(new URL("./workspace-file-action-contract.ts", import.meta.url).href);

test("workspace file actions allow a detected system tool target", () => {
  assert.deepEqual(
    parseWorkspaceFileAction({ workspaceId: "workspace", filePath: "src/app.ts", action: "open-tool", toolId: "idea" }),
    { workspaceId: "workspace", filePath: "src/app.ts", action: "open-tool", toolId: "idea" }
  );
  assert.throws(
    () => parseWorkspaceFileAction({ workspaceId: "workspace", filePath: "src/app.ts", action: "open-tool" }),
    /input is invalid/
  );
});

test("accepts the protocol save-as workspace file action", () => {
  assert.deepEqual(
    parseWorkspaceFileAction({ workspaceId: "workspace-1", filePath: "reports/result.docx", action: "save-as" }),
    { workspaceId: "workspace-1", filePath: "reports/result.docx", action: "save-as" }
  );
});

test("rejects unknown workspace file actions", () => {
  assert.throws(
    () => parseWorkspaceFileAction({ workspaceId: "workspace-1", filePath: "reports/result.docx", action: "delete" }),
    /input is invalid/
  );
});
