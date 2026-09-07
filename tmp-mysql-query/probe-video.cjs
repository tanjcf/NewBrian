const fs = require("fs");
const auth = JSON.parse(
  fs.readFileSync(
    "C:/Users/Administrator/AppData/Roaming/@codex-forge/desktop/.codecn/desktop-auth.json",
    "utf8"
  )
);
const token = String(auth.gateway_api_key || auth.access_token || "").trim();
if (!token) {
  console.error("NO_TOKEN");
  process.exit(2);
}

async function call(path, opts = {}) {
  const res = await fetch(`http://127.0.0.1:8790${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(opts.headers || {})
    }
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 500) };
  }
  return { status: res.status, body };
}

function summarizeJob(body) {
  const job = body.job || body;
  return {
    id: job.id || job.job_id || job.platform_job_id,
    state: job.state || job.status,
    model: job.model || (job.request_json && JSON.parse(job.request_json || "{}").model),
    model_config_id: job.model_config_id || job.modelConfigId,
    error: job.error || job.error_message || job.errorMessage || "",
    has_url: /https?:\/\//.test(JSON.stringify(job.result_json || job.resultJson || job.result || ""))
  };
}

(async () => {
  const stuckId = "01M178SDWQ0CPNFAAQEHVGYDP8";
  const stuck = await call(`/v1/auto/tools/jobs/${stuckId}`);
  console.log("STUCK", stuck.status, JSON.stringify(summarizeJob(stuck.body)));

  const invoke = await call("/v1/auto/tools/invoke", {
    method: "POST",
    body: JSON.stringify({
      tool: "video_generate",
      wait: false,
      arguments: {
        model: "minimax-video-h3",
        prompt: "A short test clip of morning mist over mountains, cinematic, 2 seconds",
        size: "1280x720"
      }
    })
  });
  console.log("INVOKE", invoke.status, JSON.stringify(summarizeJob(invoke.body)));
  const jobId = invoke.body.job_id || invoke.body.id || (invoke.body.job && invoke.body.job.id);
  if (!jobId) {
    console.log("INVOKE_BODY_KEYS", Object.keys(invoke.body || {}));
    console.log("INVOKE_MSG", String(invoke.body.message || invoke.body.error || invoke.body.detail || "").slice(0, 300));
    process.exit(0);
  }
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const polled = await call(`/v1/auto/tools/jobs/${jobId}`);
    const summary = summarizeJob(polled.body);
    console.log("POLL", i, polled.status, JSON.stringify(summary));
    if (/succeeded|failed|cancelled|expired/i.test(String(summary.state || ""))) break;
  }
})().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
