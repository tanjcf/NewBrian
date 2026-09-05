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

  const [tables] = await c.query("SHOW TABLES");
  const names = tables.map((r) => Object.values(r)[0]).filter((n) => /auth|session|desktop|client_api|api_key/i.test(String(n)));
  console.log("tables", names.join(","));

  for (const t of names) {
    const [cols] = await c.query(`SHOW COLUMNS FROM \`${t}\``);
    console.log("---", t, cols.map((c) => c.Field).join(","));
  }

  // check client api keys for user
  try {
    const [keys] = await c.query(
      "SELECT id, name, status, LEFT(key_prefix,12) AS prefix, owner_email, updated_at FROM client_api_keys WHERE owner_email LIKE '%931124915%' OR owner_email LIKE '%qq.com%' ORDER BY id DESC LIMIT 10"
    );
    console.log("KEYS", JSON.stringify(keys));
  } catch (e) {
    console.log("KEYS_FAIL", e.message);
  }

  await c.end();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
