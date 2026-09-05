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

  const jobId = "01M18FTBFNQ7FBNH054TH3FJ7Y";
  const res = await fetch(`http://127.0.0.1:8790/v1/auto/tools/jobs/${jobId}`, {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" }
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 500) }; }
  console.log("HTTP", res.status);
  console.log(JSON.stringify({
    state: body.state || body.status,
    error: String(body.error || body.error_message || "").slice(0, 200),
    provider_job_id: body.provider_job_id || body.providerJobId,
    hasUrl: /https?:\/\//.test(JSON.stringify(body.result_json || body.result || "")),
    poll_attempts: body.poll_attempts,
    next_poll_at: body.next_poll_at
  }, null, 2));

  const [db] = await c.query(
    `SELECT platform_job_id, state, poll_attempts, next_poll_at, lease_owner,
            provider_job_id, model_config_id,
            SUBSTRING(IFNULL(error_message,''),1,240) AS err, updated_at
     FROM generation_jobs WHERE platform_job_id=?`,
    [jobId]
  );
  console.log("DB", JSON.stringify(db[0] || null));
  await c.end();
}

main().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
