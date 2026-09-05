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
  const [r] = await c.query(
    "SELECT platform_job_id, state, poll_attempts, SUBSTRING(IFNULL(error_message,''),1,120) AS err, CHAR_LENGTH(IFNULL(result_json,'')) AS rlen, provider_job_id FROM generation_jobs WHERE platform_job_id IN ('01M17CPWFJG217XBVSYV4K6TJF','01M17CPWFJG217XBVSYV4K6TJF')"
  );
  console.log(JSON.stringify(r, null, 2));
  await c.end();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
