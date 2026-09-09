import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const {
  KnowledgeSyncConflictError,
  resolveKnowledgeApiOrigin
} = await import(new URL("./user-knowledge-gateway.ts", import.meta.url).href);

const {
  clampKnowledgeContent,
  mergeBulletKnowledge,
  mergeDigestKnowledge,
  mergeKnowledgeDocuments
} = await import(new URL("./user-knowledge-merge.ts", import.meta.url).href);

const {
  loadLocalKnowledgeForInjection,
  mirrorProjectRulesToGlobal,
  resolveDocFilePath,
  resolveGlobalKnowledgeDir,
  syncUserKnowledgeOnce
} = await import(new URL("./user-knowledge-sync.ts", import.meta.url).href);

test("resolveKnowledgeApiOrigin strips trailing /v1", () => {
  assert.equal(resolveKnowledgeApiOrigin("https://api.example.com/v1"), "https://api.example.com");
  assert.equal(resolveKnowledgeApiOrigin("https://api.example.com"), "https://api.example.com");
});

test("mergeBulletKnowledge unions and dedupes preference lines", () => {
  const merged = mergeBulletKnowledge(
    "# User Output Rules\n\n- Prefer Chinese.\n- Be concise.\n",
    "# User Output Rules\n\n- Prefer Chinese.\n- Use bullet lists.\n",
    "# User Output Rules"
  );
  assert.equal(merged.conflictMarkers, false);
  assert.match(merged.content, /Prefer Chinese/);
  assert.match(merged.content, /Be concise/);
  assert.match(merged.content, /Use bullet lists/);
  assert.equal((merged.content.match(/Prefer Chinese/g) || []).length, 1);
});

test("mergeDigestKnowledge appends unique digest lines", () => {
  const merged = mergeDigestKnowledge(
    "# Session Digest\n\n- 用户: A\n",
    "# Session Digest\n\n- 用户: B\n"
  );
  assert.match(merged.content, /用户: A/);
  assert.match(merged.content, /用户: B/);
});

test("clampKnowledgeContent enforces per-doc caps", () => {
  const huge = "x".repeat(20_000);
  const clamped = clampKnowledgeContent("user-output-rules", huge);
  assert.ok(Buffer.byteLength(clamped, "utf8") <= 16_384);
});

test("local knowledge paths and injection load global + project", async () => {
  const root = mkdtempSync(join(tmpdir(), "newbrain-knowledge-"));
  const project = join(root, "proj");
  try {
    const globalDir = resolveGlobalKnowledgeDir(join(root, ".newbrain"));
    mkdirSync(globalDir, { recursive: true });
    writeFileSync(join(globalDir, "user-output-rules.md"), "# User Output Rules\n\n- Global prefer Chinese.\n", "utf8");
    const projectRefs = join(project, ".newbrain", "skills", "proj-project-manager", "references");
    mkdirSync(projectRefs, { recursive: true });
    writeFileSync(join(projectRefs, "project-knowledge.md"), "# Project Knowledge\n\n- Uses electron.\n", "utf8");
    const injected = await loadLocalKnowledgeForInjection({
      userNewbrainRoot: join(root, ".newbrain"),
      projectWorkspacePath: project,
      projectKey: "proj"
    });
    assert.match(injected, /Global prefer Chinese/);
    assert.match(injected, /Uses electron/);
    assert.equal(
      resolveDocFilePath({
        userNewbrainRoot: join(root, ".newbrain"),
        scope: "GLOBAL",
        docType: "user-output-rules"
      }),
      join(globalDir, "user-output-rules.md")
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("syncUserKnowledgeOnce pull-merges then push with baseGeneration", async () => {
  const root = mkdtempSync(join(tmpdir(), "newbrain-knowledge-sync-"));
  const userRoot = join(root, ".newbrain");
  const project = join(root, "demo");
  mkdirSync(resolveGlobalKnowledgeDir(userRoot), { recursive: true });
  writeFileSync(
    join(resolveGlobalKnowledgeDir(userRoot), "user-output-rules.md"),
    "# User Output Rules\n\n- Local only rule.\n",
    "utf8"
  );
  const calls: string[] = [];
  const fetchImpl: typeof fetch = (async (url, init) => {
    const href = String(url);
    const method = String(init?.method ?? "GET").toUpperCase();
    calls.push(`${method} ${href}`);
    if (href.includes("/knowledge/pull")) {
      return new Response(JSON.stringify({
        ok: true,
        space: { generation: 2, content_hash: "abc", document_count: 1, updated_at: "t" },
        documents: [{
          scope: "GLOBAL",
          project_key: "",
          doc_type: "user-output-rules",
          content: "# User Output Rules\n\n- Remote shared rule.\n",
          content_hash: "r1",
          generation: 2
        }]
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (href.includes("/knowledge/push")) {
      const body = JSON.parse(String(init?.body ?? "{}"));
      assert.equal(body.baseGeneration, 2);
      assert.ok(Array.isArray(body.documents));
      assert.ok(body.documents.some((doc: { content: string }) => /Local only rule/.test(doc.content)));
      assert.ok(body.documents.some((doc: { content: string }) => /Remote shared rule/.test(doc.content)));
      return new Response(JSON.stringify({
        ok: true,
        space: { generation: 3, content_hash: "def", document_count: 1, updated_at: "t2" },
        written: body.documents
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;

  try {
    const result = await syncUserKnowledgeOnce({
      auth: {
        gatewayBaseUrl: "https://api.example.com/v1",
        bearerToken: "token",
        fetchImpl
      },
      paths: {
        userNewbrainRoot: userRoot,
        projectWorkspacePath: project,
        projectKey: "demo"
      },
      forceFullPull: true
    });
    assert.equal(result.ok, true);
    assert.equal(result.generation, 3);
    assert.ok(calls.some((line) => line.includes("/knowledge/pull")));
    assert.ok(calls.some((line) => line.includes("/knowledge/push")));
    const merged = readFileSync(join(resolveGlobalKnowledgeDir(userRoot), "user-output-rules.md"), "utf8");
    assert.match(merged, /Local only rule/);
    assert.match(merged, /Remote shared rule/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("sync retries automatically on 409 conflict", async () => {
  const root = mkdtempSync(join(tmpdir(), "newbrain-knowledge-conflict-"));
  const userRoot = join(root, ".newbrain");
  mkdirSync(resolveGlobalKnowledgeDir(userRoot), { recursive: true });
  writeFileSync(
    join(resolveGlobalKnowledgeDir(userRoot), "user-output-rules.md"),
    "# User Output Rules\n\n- Device A rule.\n",
    "utf8"
  );
  let pushCount = 0;
  const fetchImpl: typeof fetch = (async (url, init) => {
    const href = String(url);
    if (href.includes("/knowledge/pull")) {
      return new Response(JSON.stringify({
        ok: true,
        space: { generation: 1, content_hash: "a", document_count: 0, updated_at: "t" },
        documents: []
      }), { status: 200 });
    }
    if (href.includes("/knowledge/push")) {
      pushCount += 1;
      if (pushCount === 1) {
        return new Response(JSON.stringify({
          ok: false,
          error: "USER_KNOWLEDGE_CONFLICT",
          current_generation: 2,
          base_generation: 1,
          space: { generation: 2, content_hash: "b", document_count: 1, updated_at: "t2" },
          documents: [{
            scope: "GLOBAL",
            project_key: "",
            doc_type: "user-output-rules",
            content: "# User Output Rules\n\n- Device B rule.\n",
            content_hash: "b1",
            generation: 2
          }]
        }), { status: 409 });
      }
      const body = JSON.parse(String(init?.body ?? "{}"));
      assert.equal(body.baseGeneration, 2);
      return new Response(JSON.stringify({
        ok: true,
        space: { generation: 3, content_hash: "c", document_count: 1, updated_at: "t3" }
      }), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;

  try {
    const result = await syncUserKnowledgeOnce({
      auth: {
        gatewayBaseUrl: "https://api.example.com",
        bearerToken: "token",
        fetchImpl
      },
      paths: { userNewbrainRoot: userRoot }
    });
    assert.equal(result.ok, true);
    assert.equal(result.conflictRetried, 1);
    assert.equal(result.generation, 3);
    const merged = readFileSync(join(resolveGlobalKnowledgeDir(userRoot), "user-output-rules.md"), "utf8");
    assert.match(merged, /Device A rule/);
    assert.match(merged, /Device B rule/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("mirrorProjectRulesToGlobal unions into global cache", async () => {
  const root = mkdtempSync(join(tmpdir(), "newbrain-knowledge-mirror-"));
  const userRoot = join(root, ".newbrain");
  const project = join(root, "app");
  try {
    mkdirSync(join(project, ".newbrain", "skills", "app-project-manager", "references"), { recursive: true });
    writeFileSync(
      join(project, ".newbrain", "skills", "app-project-manager", "references", "user-output-rules.md"),
      "# User Output Rules\n\n- Project distilled rule.\n",
      "utf8"
    );
    const changed = await mirrorProjectRulesToGlobal({
      userNewbrainRoot: userRoot,
      projectWorkspacePath: project,
      projectKey: "app"
    });
    assert.equal(changed, true);
    const global = readFileSync(join(resolveGlobalKnowledgeDir(userRoot), "user-output-rules.md"), "utf8");
    assert.match(global, /Project distilled rule/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("KnowledgeSyncConflictError preserves payload", () => {
  const error = new KnowledgeSyncConflictError({
    ok: false,
    error: "USER_KNOWLEDGE_CONFLICT",
    current_generation: 9
  });
  assert.equal(error.status, 409);
  assert.equal(error.payload.current_generation, 9);
});

test("unsafe freeform merge keeps both with markers", () => {
  const merged = mergeKnowledgeDocuments({
    docType: "unknown-doc",
    localContent: "alpha",
    remoteContent: "beta"
  });
  assert.equal(merged.conflictMarkers, true);
  assert.match(merged.content, /<<<<<<< local/);
  assert.match(merged.content, />>>>>>> remote/);
});

test("project-os resolves to workspace-root NEWBRAIN.md and merges cleanly", async () => {
  const root = mkdtempSync(join(tmpdir(), "newbrain-project-os-sync-"));
  const userRoot = join(root, ".newbrain");
  const project = join(root, "app");
  try {
    mkdirSync(project, { recursive: true });
    assert.equal(
      resolveDocFilePath({
        userNewbrainRoot: userRoot,
        scope: "PROJECT",
        docType: "project-os",
        projectWorkspacePath: project,
        projectKey: "app"
      }),
      join(project, "NEWBRAIN.md")
    );
    writeFileSync(join(project, "NEWBRAIN.md"), "# Local OS\n\nBuild with pnpm.\n", "utf8");
    const merged = mergeKnowledgeDocuments({
      docType: "project-os",
      localContent: "",
      remoteContent: "# Remote OS\n\nTest with vitest.\n"
    });
    assert.equal(merged.conflictMarkers, false);
    assert.match(merged.content, /Remote OS/);

    const calls: string[] = [];
    let pushDocs: Array<{ doc_type: string; content: string }> = [];
    const result = await syncUserKnowledgeOnce({
      auth: {
        gatewayBaseUrl: "https://api.example.com/v1",
        bearerToken: "token",
        fetchImpl: (async (_url, init) => {
          const method = String(init?.method || "GET").toUpperCase();
          calls.push(method);
          if (method === "GET") {
            return new Response(JSON.stringify({
              ok: true,
              space: { generation: 1, content_hash: "h", document_count: 0, updated_at: "" },
              documents: []
            }), { status: 200 });
          }
          const body = JSON.parse(String(init?.body || "{}")) as {
            documents?: Array<{ doc_type: string; content: string }>;
          };
          pushDocs = body.documents ?? [];
          return new Response(JSON.stringify({
            ok: true,
            space: { generation: 2, content_hash: "h2", document_count: pushDocs.length, updated_at: "" }
          }), { status: 200 });
        }) as typeof fetch
      },
      paths: {
        userNewbrainRoot: userRoot,
        projectWorkspacePath: project,
        projectKey: "app"
      }
    });
    assert.equal(result.ok, true);
    assert.ok(pushDocs.some((doc) => doc.doc_type === "project-os" && /Build with pnpm/.test(doc.content)));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
