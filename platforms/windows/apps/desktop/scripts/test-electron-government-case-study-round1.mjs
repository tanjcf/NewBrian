process.env.NEWBRAIN_E2E_GOVERNMENT_CASE_STUDY = "1";
process.env.NEWBRAIN_E2E_FORCE_FRESH = "1";
process.env.NEWBRAIN_E2E_GOVERNMENT_FIRST_ROUND_ONLY = "1";
process.env.NEWBRAIN_E2E_REMOTE_DEBUG_PORT = String(9600 + Math.floor(Math.random() * 200));
await import("./test-electron-government-flow.mjs");
