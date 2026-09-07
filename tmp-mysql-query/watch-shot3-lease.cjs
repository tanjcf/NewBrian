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
  await c.query(
    `UPDATE generation_jobs SET poll_attempts=0, next_poll_at='1970-01-01T00:00:00Z',
     error_message=NULL, lease_owner=NULL, lease_until=NULL, updated_at=UTC_TIMESTAMP(6)
     WHERE platform_job_id=? AND state='RUNNING'`,
    [jobId]
  );
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const [rows] = await c.query(
      `SELECT state, poll_attempts, next_poll_at, lease_owner, lease_until,
              SUBSTRING(IFNULL(error_message,''),1,80) AS err, updated_at
       FROM generation_jobs WHERE platform_job_id=?`,
      [jobId]
    );
    const row = rows[0];
    console.log(
      i,
      "state=" + row.state,
      "lease=" + (row.lease_owner || "-"),
      "until=" + (row.lease_until || "-"),
      "next=" + row.next_poll_at,
      "err=" + JSON.stringify(row.err),
      "upd=" + row.updated_at
    );
  }
  await c.end();
}

main().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
