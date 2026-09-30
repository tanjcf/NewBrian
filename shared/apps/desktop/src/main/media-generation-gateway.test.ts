import assert from "node:assert/strict";
import test from "node:test";

const {
  extractMediaUrlsFromResult,
  formatMediaGenerationReply,
  isMediaGenerationAuthenticationError,
  mediaKindFromOrchestratorChannel,
  parseGenerationJobSnapshot,
  runAutoMediaTool,
  runMediaGenerationJob,
  toolNameForMediaKind
} = await import(new URL("./media-generation-gateway.ts", import.meta.url).href);

const {
  executeMediaGenerationTurn,
  resolveMediaGenerationKind,
  shouldRunMediaGenerationTurn
} = await import(new URL("./media-generation-turn.ts", import.meta.url).href);

test("parses platform generation job snapshots", () => {
  const job = parseGenerationJobSnapshot({
    id: "01JOB",
    kind: "video",
    state: "SUCCEEDED",
    resultJson: "{\"url\":\"https://cdn.example/a.mp4\"}"
  });
  assert.equal(job.id, "01JOB");
  assert.equal(job.state, "SUCCEEDED");
  assert.deepEqual(extractMediaUrlsFromResult(job.resultJson), ["https://cdn.example/a.mp4"]);
});

test("extracts minimax music audio url from TokenHub-shaped payloads", () => {
  const urls = extractMediaUrlsFromResult(JSON.stringify({
    base_resp: { status_code: 0, status_msg: "success" },
    data: {
      audio: "https://aigc-output-audio-file.example.cos.ap-guangzhou.myqcloud.com/demo.mp3",
      status: 2
    },
    extra_info: { music_size: 753988 },
    tokenhub_usage: { total_tokens: 100000 }
  }));
  assert.equal(urls.length, 1);
  assert.match(urls[0]!, /demo\.mp3$/);
});

test("extracts nested video urls from TokenHub-shaped payloads", () => {
  const urls = extractMediaUrlsFromResult(JSON.stringify({
    ErrCode: 0,
    Resp: { status: 1, url: "https://cdn.example/pixverse.mp4" }
  }));
  assert.deepEqual(urls, ["https://cdn.example/pixverse.mp4"]);
});

test("maps orchestrator channels to media kinds", () => {
  assert.equal(mediaKindFromOrchestratorChannel("image_gen"), "image");
  assert.equal(mediaKindFromOrchestratorChannel("video_gen"), "video");
  assert.equal(mediaKindFromOrchestratorChannel("music_gen"), "music");
  assert.equal(mediaKindFromOrchestratorChannel("three_d_gen"), "3d");
  assert.equal(mediaKindFromOrchestratorChannel("text_chat"), null);
  assert.equal(toolNameForMediaKind("music"), "music_generate");
});

test("resolves image turn from auto decision", () => {
  const decision = {
    orchestrator: { primary_channel: "image_gen" },
    model: { reason_codes: ["requires_image", "image_capable"] }
  };
  assert.equal(shouldRunMediaGenerationTurn({ autoDecision: decision as never }), true);
  assert.equal(resolveMediaGenerationKind({ autoDecision: decision as never }), "image");
});

test("resolves media turn from auto decision", () => {
  const decision = {
    orchestrator: { primary_channel: "video_gen" },
    model: { reason_codes: ["requires_video"] }
  };
  assert.equal(shouldRunMediaGenerationTurn({ autoDecision: decision as never }), true);
  assert.equal(resolveMediaGenerationKind({ autoDecision: decision as never }), "video");
});

test("runAutoMediaTool posts to /v1/auto/tools/invoke", async () => {
  const calls: Array<{ url: string; body: string }> = [];
  const result = await runAutoMediaTool({
    gatewayBaseUrl: "http://127.0.0.1:8790/v1",
    bearerToken: "secret",
    toolName: "image_generate",
    prompt: "卡通壁纸",
    model: "hy-image-v3",
    idempotencyKey: "newbrain-req-1",
    fetchImpl: (async (url, init) => {
      calls.push({ url: String(url), body: String(init?.body || "") });
      return new Response(JSON.stringify({
        ok: true,
        tool: "image_generate",
        job_id: "01AUTOIMG00000000000000001",
        kind: "image",
        status: "succeeded",
        state: "SUCCEEDED",
        result_json: JSON.stringify({ url: "https://cdn.example/auto.png" }),
        reply: "图片已生成完成（任务 `01AUTOIMG00000000000000001`）。\n\nhttps://cdn.example/auto.png"
      }), { status: 200 });
    }) as typeof fetch
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0]!.url, /\/auto\/tools\/invoke$/);
  assert.match(calls[0]!.body, /image_generate/);
  assert.match(calls[0]!.body, /"wait":false/);
  assert.equal(result.job.id, "01AUTOIMG00000000000000001");
  assert.match(result.reply, /cdn\.example\/auto\.png/);
});

test("runAutoMediaTool OpenClaw path polls jobs until succeeded", async () => {
  const calls: string[] = [];
  let polls = 0;
  const result = await runAutoMediaTool({
    gatewayBaseUrl: "http://127.0.0.1:8790/v1",
    bearerToken: "secret",
    toolName: "video_generate",
    prompt: "一段短视频",
    model: "seedance",
    wait: false,
    pollIntervalMs: 20,
    fetchImpl: (async (url, init) => {
      const method = String(init?.method || "GET").toUpperCase();
      calls.push(`${method} ${url}`);
      if (method === "POST") {
        return new Response(JSON.stringify({
          ok: false,
          tool: "video_generate",
          job_id: "job-async-1",
          kind: "video",
          status: "running",
          state: "RUNNING"
        }), { status: 202 });
      }
      polls += 1;
      if (polls < 2) {
        return new Response(JSON.stringify({
          ok: false,
          tool: "video_generate",
          job_id: "job-async-1",
          status: "running",
          state: "RUNNING"
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        ok: true,
        tool: "video_generate",
        job_id: "job-async-1",
        status: "succeeded",
        state: "SUCCEEDED",
        result_json: JSON.stringify({ url: "https://cdn.example/async.mp4" }),
        reply: "视频已生成 https://cdn.example/async.mp4"
      }), { status: 200 });
    }) as typeof fetch
  });
  assert.ok(calls.some((item) => item.includes("/auto/tools/invoke")));
  assert.ok(calls.some((item) => item.includes("/auto/tools/jobs/job-async-1")));
  assert.equal(result.job.state, "SUCCEEDED");
  assert.match(result.reply, /async\.mp4/);
});

test("runAutoMediaTool stops polling when aborted", async () => {
  const controller = new AbortController();
  let polls = 0;
  const pending = runAutoMediaTool({
    gatewayBaseUrl: "http://127.0.0.1:8790/v1",
    bearerToken: "secret",
    toolName: "music_generate",
    prompt: "轻音乐",
    wait: false,
    pollIntervalMs: 20,
    signal: controller.signal,
    fetchImpl: (async (url, init) => {
      const method = String(init?.method || "GET").toUpperCase();
      if (method === "POST") {
        return new Response(JSON.stringify({
          ok: false,
          tool: "music_generate",
          job_id: "job-stuck",
          status: "running",
          state: "RUNNING"
        }), { status: 202 });
      }
      polls += 1;
      if (polls >= 2) controller.abort(new Error("USER_CANCELLED"));
      return new Response(JSON.stringify({
        ok: false,
        tool: "music_generate",
        job_id: "job-stuck",
        status: "running",
        state: "RUNNING"
      }), { status: 200 });
    }) as typeof fetch
  });
  await assert.rejects(pending, /USER_CANCELLED|aborted/i);
});

test("executeMediaGenerationTurn prefers Auto tools then falls back on 404", async () => {
  const calls: string[] = [];
  const result = await executeMediaGenerationTurn({
    gatewayBaseUrl: "http://127.0.0.1:8790/v1",
    bearerToken: "secret",
    kind: "image",
    model: "hy-image-v3",
    prompt: "卡通壁纸",
    requestId: "req-fallback",
    mediaExecution: "server",
    toolName: "image_generate",
    fetchImpl: (async (url, init) => {
      const method = String(init?.method || "GET").toUpperCase();
      calls.push(`${method} ${url}`);
      if (String(url).includes("/auto/tools/invoke")) {
        return new Response("missing", { status: 404 });
      }
      if (String(url).endsWith("/auto/tools")) {
        return new Response("missing", { status: 404 });
      }
      return new Response(JSON.stringify({
        id: "01LEGACY000000000000000001",
        kind: "image",
        state: "SUCCEEDED",
        resultJson: JSON.stringify({ data: [{ url: "https://cdn.example/legacy.png" }] })
      }), { status: 202 });
    }) as typeof fetch
  });
  assert.equal(result.via, "legacy");
  assert.ok(calls.some((item) => item.includes("/auto/tools/invoke")));
  assert.ok(calls.some((item) => item.includes("/images/generations")));
  assert.match(result.content, /legacy\.png/);
});

test("preserves Auto media HTTP auth status for a single refresh-and-retry decision", async () => {
  await assert.rejects(
    () => runAutoMediaTool({
      gatewayBaseUrl: "http://127.0.0.1:8790/v1",
      bearerToken: "expired",
      toolName: "image_generate",
      prompt: "卡通壁纸",
      fetchImpl: (async () => new Response(
        JSON.stringify({ error: "invalid desktop access token or local api key" }),
        { status: 401 }
      )) as typeof fetch
    }),
    (error: unknown) => {
      assert.equal(isMediaGenerationAuthenticationError(error), true);
      assert.equal((error as { status?: number }).status, 401);
      return true;
    }
  );
});

test("domain 404 from an available Auto media route never falls back to legacy video", async () => {
  const calls: string[] = [];
  await assert.rejects(() => executeMediaGenerationTurn({
    gatewayBaseUrl: "http://127.0.0.1:8790/v1",
    bearerToken: "secret",
    kind: "video",
    model: "hy3",
    prompt: "青石谷清晨入口宣传片",
    requestId: "req-domain-404",
    toolName: "video_generate",
    fetchImpl: (async (url) => {
      calls.push(String(url));
      if (String(url).endsWith("/auto/tools")) {
        return new Response(JSON.stringify({ tools: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ detail: "video generation model is not available" }), { status: 404 });
    }) as typeof fetch
  }), /video generation model is not available/);
  assert.equal(calls.some((url) => /\/videos(?:$|\?)/.test(url)), false);
});

test("executeMediaGenerationTurn keeps client-hinted video on Spring Auto tools", async () => {
  const calls: string[] = [];
  const result = await executeMediaGenerationTurn({
    gatewayBaseUrl: "http://127.0.0.1:8790/v1",
    bearerToken: "secret",
    kind: "video",
    model: "hy3",
    prompt: "青石谷清晨入口宣传片",
    requestId: "req-client-hint",
    mediaExecution: "client",
    toolName: "video_generate",
    fetchImpl: (async (url, init) => {
      calls.push(`${String(init?.method || "GET").toUpperCase()} ${url}`);
      if (String(url).includes("/auto/tools/invoke")) {
        return new Response(JSON.stringify({
          ok: true,
          job_id: "job-client-hint",
          tool: "video_generate",
          state: "SUCCEEDED",
          result_json: JSON.stringify({ url: "https://cdn.example/qingshigu.mp4" }),
          reply: "视频已生成 https://cdn.example/qingshigu.mp4"
        }), { status: 200 });
      }
      return new Response("legacy route must not be called", { status: 500 });
    }) as typeof fetch
  });
  assert.equal(result.via, "auto_tools");
  assert.match(result.content, /qingshigu\.mp4/);
  assert.ok(calls.some((item) => item.includes("/auto/tools/invoke")));
  assert.equal(calls.some((item) => /\/videos(?:\s|$|\?)/.test(item)), false);
});

test("runMediaGenerationJob posts then polls until succeeded", async () => {
  const calls: string[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method || "GET"} ${url}`);
    if (String(init?.method || "GET").toUpperCase() === "POST") {
      return new Response(JSON.stringify({ id: "job-1", state: "RUNNING" }), { status: 202 });
    }
    return new Response(JSON.stringify({
      id: "job-1",
      state: "SUCCEEDED",
      resultJson: JSON.stringify({ url: "https://cdn.example/out.mp4" })
    }), { status: 200 });
  };
  const job = await runMediaGenerationJob({
    gatewayBaseUrl: "http://127.0.0.1:8790/v1",
    bearerToken: "secret",
    kind: "video",
    model: "pixverse-video-v6.0",
    prompt: "夜景延时",
    pollIntervalMs: 1,
    fetchImpl: fetchImpl as typeof fetch
  });
  assert.equal(job.state, "SUCCEEDED");
  assert.match(formatMediaGenerationReply({
    kind: "video",
    model: "pixverse-video-v6.0",
    job
  }), /cdn\.example\/out\.mp4/);
  assert.ok(calls.some((item) => item.startsWith("POST ")));
  assert.ok(calls.some((item) => item.startsWith("GET ")));
});

test("hy-image sync completion skips poll when POST already succeeded", async () => {
  const calls: string[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method || "GET"} ${url}`);
    assert.equal(String(init?.method || "GET").toUpperCase(), "POST");
    return new Response(JSON.stringify({
      id: "01HYIMAGE00000000000000001",
      kind: "image",
      state: "SUCCEEDED",
      resultJson: JSON.stringify({
        data: [{ url: "https://cdn.example/hy-image.png" }]
      })
    }), { status: 202 });
  };
  const job = await runMediaGenerationJob({
    gatewayBaseUrl: "http://127.0.0.1:8790/v1",
    bearerToken: "secret",
    kind: "image",
    model: "hy-image-v3",
    prompt: "卡通壁纸",
    pollIntervalMs: 1,
    fetchImpl: fetchImpl as typeof fetch
  });
  assert.equal(job.state, "SUCCEEDED");
  assert.equal(calls.length, 1);
  assert.match(calls[0]!, /POST .*\/images\/generations$/);
  assert.match(formatMediaGenerationReply({
    kind: "image",
    model: "hy-image-v3",
    job
  }), /cdn\.example\/hy-image\.png/);
});

test("hy-image skips poll when resultJson already has URL even if state is queued", async () => {
  const calls: string[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method || "GET"} ${url}`);
    assert.equal(String(init?.method || "GET").toUpperCase(), "POST");
    return new Response(JSON.stringify({
      id: "01HYIMAGE00000000000000002",
      kind: "image",
      state: "QUEUED",
      resultJson: JSON.stringify({
        data: [{ url: "https://cdn.example/queued-but-ready.png" }]
      })
    }), { status: 202 });
  };
  const job = await runMediaGenerationJob({
    gatewayBaseUrl: "http://127.0.0.1:8790/v1",
    bearerToken: "secret",
    kind: "image",
    model: "hy-image-v3",
    prompt: "卡通壁纸",
    pollIntervalMs: 1,
    fetchImpl: fetchImpl as typeof fetch
  });
  assert.equal(job.state, "SUCCEEDED");
  assert.equal(calls.length, 1);
  assert.match(formatMediaGenerationReply({
    kind: "image",
    model: "hy-image-v3",
    job
  }), /queued-but-ready\.png/);
});

test("runAutoMediaTool surfaces Spring reply text for failed jobs", async () => {
  await assert.rejects(() => runAutoMediaTool({
    gatewayBaseUrl: "http://127.0.0.1:8790/v1",
    bearerToken: "secret",
    toolName: "video_generate",
    prompt: "图生视频",
    wait: true,
    fetchImpl: (async (url) => {
      if (String(url).includes("/auto/tools/invoke")) {
        return new Response(JSON.stringify({
          ok: false,
          job_id: "job-failed-1",
          tool: "video_generate",
          state: "FAILED",
          error: "",
          reply: "视频生成失败（任务 job-failed-1）：参考图地址无效"
        }), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch
  }), /参考图地址无效/);
});
