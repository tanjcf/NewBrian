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
  const jobId = "01M18FTBFNQ7FBNH054TH3FJ7Y";
  const [jobs] = await c.query(
    `SELECT state, provider_response_json, result_json FROM generation_jobs WHERE platform_job_id=?`,
    [jobId]
  );
  const row = jobs[0];
  console.log("state", row.state);
  console.log("provider_response_json length", String(row.provider_response_json || "").length);
  console.log("result_json length", String(row.result_json || "").length);
  const provider = JSON.parse(row.provider_response_json || "{}");
  console.log("provider keys", Object.keys(provider));
  const data0 = provider.data && provider.data[0];
  console.log("data0 keys", data0 ? Object.keys(data0) : null);
  const url = data0 && data0.outputs && data0.outputs[0] && data0.outputs[0].url;
  console.log("url", url ? url.slice(0, 120) + "..." : null);

  if (!url) {
    console.log("NO_URL_ABORT");
    await c.end();
    return;
  }

  const resultJson = JSON.stringify({
    url,
    urls: [url],
    provider_job_id: data0.id,
    duration: data0.outputs[0].duration,
    source: "manual-unstick-from-provider_response_json"
  });

  await c.query(
    `UPDATE generation_jobs
     SET state='SUCCEEDED',
         result_json=?,
         error_message=NULL,
         error_code=NULL,
         next_poll_at=NULL,
         lease_owner=NULL,
         lease_until=NULL,
         updated_at=UTC_TIMESTAMP(6)
     WHERE platform_job_id=?`,
    [resultJson, jobId]
  );

  const [after] = await c.query(
    `SELECT state, SUBSTRING(result_json,1,180) AS result, next_poll_at, lease_owner
     FROM generation_jobs WHERE platform_job_id=?`,
    [jobId]
  );
  console.log("AFTER", JSON.stringify(after[0]));
  await c.end();
}

main().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
