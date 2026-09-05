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

  const [cols] = await c.query("SHOW COLUMNS FROM provider_credentials");
  console.log("=== COLUMNS ===");
  for (const row of cols) console.log(row.Field + ":" + row.Type);

  const [creds] = await c.query(
    "SELECT id, provider_type, credential_name, status, credential_type, key_version, updated_at, LENGTH(secret_ciphertext) AS cipher_len FROM provider_credentials ORDER BY id"
  );
  console.log("=== CREDENTIALS ===");
  for (const row of creds) console.log(JSON.stringify(row));

  const [job] = await c.query(
    "SELECT platform_job_id, state, model_config_id, SUBSTRING(IFNULL(error_message,''),1,400) AS err, SUBSTRING(IFNULL(provider_response_json,''),1,500) AS prov, updated_at FROM generation_jobs WHERE platform_job_id='01M178SDWQ0CPNFAAQEHVGYDP8'"
  );
  console.log("=== STUCK JOB ===");
  for (const row of job) console.log(JSON.stringify(row));

  const [succ] = await c.query(
    "SELECT platform_job_id, state, model_config_id, SUBSTRING(IFNULL(result_json,''),1,300) AS result, updated_at FROM generation_jobs WHERE platform_job_id='01M1785423W8RKEN5MH0WCT40N'"
  );
  console.log("=== SUCCESS JOB ===");
  for (const row of succ) console.log(JSON.stringify(row));

  await c.end();
}

main().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
