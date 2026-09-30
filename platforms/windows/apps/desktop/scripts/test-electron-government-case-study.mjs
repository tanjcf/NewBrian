/**
 * Full government case-study closed loop:
 * natural-language request → writing specification → confirm → PDF delivery → gold oracle score.
 *
 * Set NEWBRAIN_E2E_GOVERNMENT_FIRST_ROUND_ONLY=1 to stop after the specification stage.
 * Set NEWBRAIN_E2E_USE_REMOTE_MODEL=1 to use the configured live model instead of the local harness double.
 */
process.env.NEWBRAIN_E2E_GOVERNMENT_CASE_STUDY = "1";
process.env.NEWBRAIN_E2E_FORCE_FRESH = "1";
process.env.NEWBRAIN_E2E_REMOTE_DEBUG_PORT = String(9450 + Math.floor(Math.random() * 200));
delete process.env.NEWBRAIN_E2E_GOVERNMENT_FIRST_ROUND_ONLY;
await import("./test-electron-government-flow.mjs");
