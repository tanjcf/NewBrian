const fs = require("fs");
const auth = JSON.parse(
  fs.readFileSync(
    "C:/Users/Administrator/AppData/Roaming/@codex-forge/desktop/.codecn/desktop-auth.json",
    "utf8"
  )
);

async function probe(label, headers) {
  const res = await fetch("http://127.0.0.1:8790/v1/auto/tools", { headers });
  console.log(label, res.status);
}

(async () => {
  const access = String(auth.access_token || "").trim();
  const gatewayKey = String(auth.gateway_api_key || "").trim();
  const cookie = String(auth.session_cookie || "").trim();
  await probe("bearer_access", { Authorization: `Bearer ${access}` });
  await probe("bearer_gateway", { Authorization: `Bearer ${gatewayKey}` });
  await probe("x_api_key_gateway", { "X-API-Key": gatewayKey });
  await probe("x_api_key_access", { "X-API-Key": access });
  if (cookie) await probe("cookie", { Cookie: cookie.includes("=") ? cookie : `SESSION=${cookie}` });
  // also try OpenAI style
  await probe("openai_key_header", { Authorization: `Bearer ${gatewayKey}`, "OpenAI-Organization": "test" });
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
