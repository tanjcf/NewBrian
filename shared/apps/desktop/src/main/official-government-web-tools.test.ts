import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node's strip-types runner loads this source file directly.
import { registerOfficialGovernmentWebTools } from "./official-government-web-tools.ts";

interface RegisteredTool {
  definition: Record<string, unknown>;
  execute: (input: Record<string, unknown>) => Promise<unknown>;
}

function createHarness() {
  const registered: RegisteredTool[] = [];
  const namespaces: Array<string | undefined> = [];
  const service = {
    async search(input: { query: string; limit?: number }) {
      return [{ title: "Result", url: "https://www.gov.cn/a", snippet: input.query, rank: 1 }];
    },
    async read(input: { url: string }) {
      return { url: input.url, title: "Page", text: "Official text" };
    },
  };
  registerOfficialGovernmentWebTools(
    {
      unregisterExternalTools(namespace) {
        namespaces.push(namespace);
      },
      registerExternalTool(definition, execute) {
        registered.push({ definition, execute });
      },
    },
    service,
  );
  return { registered, namespaces };
}

test("registers two low-risk read tools without approval", () => {
  const { registered, namespaces } = createHarness();

  assert.deepEqual(namespaces, ["web-official"]);
  assert.deepEqual(
    registered.map(({ definition }) => ({
      name: definition.name,
      kind: definition.kind,
      risk: definition.risk,
      requiresApproval: definition.requiresApproval,
      namespace: definition.namespace,
    })),
    [
      {
        name: "web.search_official",
        kind: "read",
        risk: "low",
        requiresApproval: false,
        namespace: "web-official",
      },
      {
        name: "web.read_official",
        kind: "read",
        risk: "low",
        requiresApproval: false,
        namespace: "web-official",
      },
    ],
  );
});

test("search returns structured official results with auto-read evidence", async () => {
  const { registered } = createHarness();
  const result = await registered[0].execute({ query: "policy", limit: 3 }) as {
    ok: boolean;
    exitCode: number;
    output: string;
  };

  assert.equal(result.ok, true);
  assert.equal(result.exitCode, 0);
  const payload = JSON.parse(result.output) as Record<string, unknown>;
  assert.equal(payload.count, 1);
  assert.ok(payload.auto_read);
  assert.deepEqual(payload.results, [{ title: "Result", url: "https://www.gov.cn/a", snippet: "policy", rank: 1 }]);
});

test("search auto-reads the top official result on the first successful search", async () => {
  const { registered } = createHarness();
  const result = await registered[0].execute({ query: "newborn statistics 2026", limit: 3 }) as {
    ok: boolean;
    output: string;
  };
  assert.equal(result.ok, true);
  const payload = JSON.parse(result.output) as Record<string, unknown>;
  assert.ok(payload.auto_read);
  assert.match(String((payload.auto_read as { text?: string })?.text ?? ""), /Official text/);
});

test("search hard-blocks after repeated searches without another read", async () => {
  const { registered } = createHarness();
  assert.equal((await registered[0].execute({ query: "policy-0", limit: 3 }) as { ok: boolean }).ok, true);
  for (let index = 1; index < 5; index += 1) {
    const result = await registered[0].execute({ query: `policy-${index}`, limit: 3 }) as {
      ok: boolean;
    };
    assert.equal(result.ok, true);
  }
  const blocked = await registered[0].execute({ query: "policy-5", limit: 3 }) as {
    ok: boolean;
    deniedReason?: string;
    output: string;
  };
  assert.equal(blocked.ok, false);
  assert.equal(blocked.deniedReason, "tool-loop");
  assert.match(blocked.output, /circuit breaker/i);
});

test("search hard-blocks identical query thrash after the auto-read budget resets", async () => {
  const { registered } = createHarness();
  assert.equal((await registered[0].execute({ query: "seed", limit: 3 }) as { ok: boolean }).ok, true);
  assert.equal((await registered[0].execute({ query: "same", limit: 3 }) as { ok: boolean }).ok, true);
  assert.equal((await registered[0].execute({ query: "same", limit: 3 }) as { ok: boolean }).ok, true);
  const blocked = await registered[0].execute({ query: "same", limit: 3 }) as {
    ok: boolean;
    deniedReason?: string;
  };
  assert.equal(blocked.ok, false);
  assert.equal(blocked.deniedReason, "tool-loop");
});

test("read resets the search circuit so searching can resume", async () => {
  const { registered } = createHarness();
  for (let index = 0; index < 4; index += 1) {
    assert.equal((await registered[0].execute({ query: `policy-${index}`, limit: 3 }) as { ok: boolean }).ok, true);
  }
  assert.equal((await registered[1].execute({ url: "https://www.gov.cn/page" }) as { ok: boolean }).ok, true);
  assert.equal((await registered[0].execute({ query: "after-read", limit: 3 }) as { ok: boolean }).ok, true);
});

test("invalid search inputs return failed tool results", async () => {
  const { registered } = createHarness();
  for (const input of [
    {},
    { query: "x".repeat(301) },
    { query: "policy", limit: 0 },
    { query: "policy", limit: 11 },
  ]) {
    const result = await registered[0].execute(input) as { ok: boolean; exitCode: number };
    assert.equal(result.ok, false);
    assert.equal(result.exitCode, 1);
  }
});

test("read validates the official URL and returns page content", async () => {
  const { registered } = createHarness();
  const invalidInputs = [{}, { url: "https://example.com/page" }];
  for (const input of invalidInputs) {
    const result = await registered[1].execute(input) as { ok: boolean; exitCode: number };
    assert.equal(result.ok, false);
    assert.equal(result.exitCode, 1);
  }

  const result = await registered[1].execute({ url: "https://www.gov.cn/page" }) as {
    ok: boolean;
    output: string;
  };
  assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse(result.output), {
    url: "https://www.gov.cn/page",
    title: "Page",
    text: "Official text",
  });
});
