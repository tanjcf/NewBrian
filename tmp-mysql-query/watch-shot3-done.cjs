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
  for (let i = 0; i < 40; i++) {
    const [rows] = await c.query(
      `SELECT state, lease_owner,
              SUBSTRING(IFNULL(error_message,''),1,60) AS err,
              SUBSTRING(IFNULL(result_json,''),1,120) AS result,
              next_poll_at, updated_at
       FROM generation_jobs WHERE platform_job_id=?`,
      [jobId]
    );
    const row = rows[0];
    const hasUrl = /https?:\/\//.test(String(row.result || ""));
    console.log(
      i,
      row.state,
      "lease=" + (row.lease_owner || "-").slice(0, 24),
      "hasUrl=" + hasUrl,
      "err=" + JSON.stringify(row.err),
      "upd=" + row.updated_at
    );
    if (/SUCCEEDED|FAILED|CANCELLED|EXPIRED/i.test(row.state)) break;
    await new Promise((r) => setTimeout(r, 3000));
  }
  await c.end();
}

main().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
