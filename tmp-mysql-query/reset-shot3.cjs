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
  const [before] = await c.query(
    `SELECT platform_job_id, state, poll_attempts, next_poll_at, provider_job_id,
            SUBSTRING(IFNULL(error_message,''),1,160) AS err, updated_at
     FROM generation_jobs WHERE platform_job_id=?`,
    [jobId]
  );
  console.log("BEFORE", JSON.stringify(before[0] || null));
  await c.query(
    `UPDATE generation_jobs
     SET poll_attempts=0,
         next_poll_at='1970-01-01T00:00:00Z',
         error_message=NULL,
         error_code=NULL,
         lease_owner=NULL,
         lease_until=NULL,
         updated_at=UTC_TIMESTAMP(6)
     WHERE platform_job_id=? AND state='RUNNING'`,
    [jobId]
  );
  const [after] = await c.query(
    `SELECT platform_job_id, state, poll_attempts, next_poll_at, provider_job_id,
            SUBSTRING(IFNULL(error_message,''),1,160) AS err, updated_at
     FROM generation_jobs WHERE platform_job_id=?`,
    [jobId]
  );
  console.log("AFTER", JSON.stringify(after[0] || null));
  await c.end();
}

main().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
