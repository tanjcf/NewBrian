import assert from "node:assert/strict";
import test from "node:test";

const bindingsModule = await import(
  new URL("./model-chat-composition-bindings.ts", import.meta.url).href
);

test("binds task projections, remote events, and timing logs outside the composition root", async () => {
  const task: Record<string, unknown> = {};
  const observed: unknown[] = [];
  const logs: string[] = [];
  const bindings = bindingsModule.createModelChatCompositionBindings({
    getTask: (requestId: string) => requestId === "request_1" ? task : undefined,
    getAgentEventObserver: (requestId: string) =>
      requestId === "request_1"
        ? (event: { type: string; payload?: unknown }) => observed.push(event)
        : undefined,
    appendDebugLog: async (line: string) => {
      logs.push(line);
    }
  });
  const artifacts = [{ path: "result.pdf", size: 10 }];
  const callback = () => undefined;

  bindings.attachArtifacts("request_1", artifacts);
  bindings.attachSkillDisclosure("request_1", "skill");
  bindings.setModelCallback("request_1", callback);
  bindings.observeAgentEvents("request_1", [{ type: "started" }, { type: "completed" }]);
  bindings.observeTiming({
    requestId: "request_1",
    stage: "prepared",
    stageMs: 12,
    elapsedMs: 12
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(task, {
    writtenArtifacts: artifacts,
    skillDisclosure: "skill",
    modelCallback: callback
  });
  assert.deepEqual(observed, [{ type: "started" }, { type: "completed" }]);
  assert.deepEqual(logs, [
    "model timing request=request_1 stage=prepared stage_ms=12 elapsed_ms=12"
  ]);
});
