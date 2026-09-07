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

  const [creds] = await c.query(
    "SELECT id, provider_type, credential_name, status, credential_type, key_version, updated_at, CHAR_LENGTH(encrypted_payload) AS payload_len FROM provider_credentials ORDER BY id"
  );
  console.log("=== CREDENTIALS ===");
  for (const row of creds) console.log(JSON.stringify(row));

  const [job] = await c.query(
    "SELECT platform_job_id, state, model_config_id, lease_owner, SUBSTRING(IFNULL(error_message,''),1,400) AS err, SUBSTRING(IFNULL(provider_response_json,''),1,400) AS prov, updated_at FROM generation_jobs WHERE platform_job_id IN ('01M178SDWQ0CPNFAAQEHVGYDP8','01M1785423W8RKEN5MH0WCT40N')"
  );
  console.log("=== TARGET JOBS ===");
  for (const row of job) console.log(JSON.stringify(row));

  await c.end();
}

main().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
