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
  console.log("COLUMNS", cols.map((r) => r.Field).join(","));
  const [creds] = await c.query("SELECT * FROM provider_credentials WHERE id=2");
  const row = creds[0] || null;
  if (!row) {
    console.log("NO_CRED");
  } else {
    const safe = { ...row };
    for (const k of Object.keys(safe)) {
      const v = safe[k];
      if (typeof v === "string" && v.length > 80) safe[k] = v.slice(0, 40) + "...len=" + v.length;
    }
    console.log("CRED", JSON.stringify(safe));
  }
  await c.end();
}

main().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
