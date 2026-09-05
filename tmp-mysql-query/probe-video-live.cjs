const mysql = require("mysql2/promise");

async function main() {
  const c = await mysql.createConnection({
    host: "120.48.151.202",
    port: 3307,
    user: "stock_app",
    password: "change_me_stock_app_password",
    database: "token_system",
    connectTimeout: 12000
  });
  const [rows] = await c.query(
    "SELECT api_key FROM client_api_keys WHERE id=329 AND is_active=1 LIMIT 1"
  );
  const key = rows[0] && rows[0].api_key;
  if (!key) throw new Error("missing key 329");

  async function call(path, opts = {}) {
    const res = await fetch(`http://127.0.0.1:8790${path}`, {
      ...opts,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        ...(opts.headers || {})
      }
    });
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text.slice(0, 400) };
    }
    return { status: res.status, body };
  }

  const tools = await call("/v1/auto/tools");
  console.log("TOOLS", tools.status, Array.isArray(tools.body.tools) ? tools.body.tools.length : "n/a");

  const stuck = await call("/v1/auto/tools/jobs/01M178SDWQ0CPNFAAQEHVGYDP8");
  console.log(
    "STUCK",
    stuck.status,
    stuck.body.state || stuck.body.status,
    String(stuck.body.error || stuck.body.error_message || "").slice(0, 120),
    "hasUrl",
    /https?:\/\//.test(JSON.stringify(stuck.body.result_json || stuck.body.result || ""))
  );

  const invoke = await call("/v1/auto/tools/invoke", {
    method: "POST",
    body: JSON.stringify({
      tool: "video_generate",
      wait: false,
      arguments: {
        model: "minimax-video-h3",
        prompt: "Brief cinematic misty mountain sunrise, 2 seconds, no people",
        size: "1280x720"
      }
    })
  });
  const jobId = invoke.body.job_id || invoke.body.id;
  console.log(
    "INVOKE",
    invoke.status,
    "job",
    jobId,
    "state",
    invoke.body.state || invoke.body.status,
    "err",
    String(invoke.body.error || invoke.body.message || "").slice(0, 160)
  );
  if (!jobId) {
    await c.end();
    return;
  }

  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 8000));
    const polled = await call(`/v1/auto/tools/jobs/${jobId}`);
    const state = polled.body.state || polled.body.status;
    const err = String(polled.body.error || polled.body.error_message || "").slice(0, 160);
    const hasUrl = /https?:\/\//.test(JSON.stringify(polled.body.result_json || polled.body.result || ""));
    console.log("POLL", i, polled.status, state, "hasUrl", hasUrl, "err", err);
    if (/succeeded|failed|cancelled|expired/i.test(String(state || ""))) break;
  }

  // also inspect DB row for model_config_id
  const [jobs] = await c.query(
    "SELECT platform_job_id, model_config_id, state, SUBSTRING(IFNULL(error_message,''),1,160) err FROM generation_jobs WHERE platform_job_id=? LIMIT 1",
    [jobId]
  );
  console.log("DB_JOB", JSON.stringify(jobs[0] || null));
  await c.end();
}

main().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
