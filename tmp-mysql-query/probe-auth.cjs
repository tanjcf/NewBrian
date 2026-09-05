const fs = require("fs");
const auth = JSON.parse(
  fs.readFileSync(
    "C:/Users/Administrator/AppData/Roaming/@codex-forge/desktop/.codecn/desktop-auth.json",
    "utf8"
  )
);

async function probe(label, base, tokenName, token) {
  if (!token) {
    console.log(label, tokenName, "MISSING");
    return;
  }
  const res = await fetch(`${base}/v1/auto/tools`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const text = await res.text();
  console.log(label, tokenName, "status", res.status, "body", text.slice(0, 120).replace(/\s+/g, " "));
}

(async () => {
  const access = String(auth.access_token || "").trim();
  const gatewayKey = String(auth.gateway_api_key || "").trim();
  await probe("LOCAL", "http://127.0.0.1:8790", "access_token", access);
  await probe("LOCAL", "http://127.0.0.1:8790", "gateway_api_key", gatewayKey);
  await probe("REMOTE", "http://120.48.151.202:8790", "access_token", access);
  await probe("REMOTE", "http://120.48.151.202:8790", "gateway_api_key", gatewayKey);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
