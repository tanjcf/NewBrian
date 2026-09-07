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
    "SELECT platform_job_id, state, poll_attempts, next_poll_at, lease_owner, lease_until, provider_job_id, SUBSTRING(IFNULL(error_message,''),1,200) AS err, updated_at FROM generation_jobs WHERE platform_job_id='01M178SDWQ0CPNFAAQEHVGYDP8'"
  );
  console.log(JSON.stringify(rows, null, 2));
  await c.end();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
