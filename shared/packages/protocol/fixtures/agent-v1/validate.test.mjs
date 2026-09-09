import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AGENT_COMMANDS_V1,
  AGENT_ERROR_CODES_V1,
  AGENT_PROTOCOL_ID,
  AGENT_RUNTIME_PROTOCOL_VERSION,
  AGENT_STREAM_EVENTS_V1,
  createDefaultAgentProtocolCapabilityV1,
  isAgentErrorCodeV1,
  isAgentStreamEventNameV1,
  MARKET_DIRECT_CLAWHUB_ALLOWED_FLAG
} from "../../dist/agent-v1.js";

const fixturesDir = path.dirname(fileURLToPath(import.meta.url));

function readJson(name) {
  return JSON.parse(fs.readFileSync(path.join(fixturesDir, name), "utf8"));
}

test("protocol meta declares newbrain.agent.v1 hybrid freeze", () => {
  const meta = readJson("protocol-meta.json");
  assert.equal(meta.protocol, AGENT_PROTOCOL_ID);
  assert.equal(meta.runtime_protocol_version, AGENT_RUNTIME_PROTOCOL_VERSION);
  assert.equal(meta.market.direct_clawhub_allowed, false);
  assert.equal(meta.authority_mode, "hybrid_local_checkpoint_spring_policy");
});

test("stream event fixture matches exported enum", () => {
  const fixture = readJson("events.json");
  assert.deepEqual(fixture.events, [...AGENT_STREAM_EVENTS_V1]);
  assert.deepEqual(fixture.commands, [...AGENT_COMMANDS_V1]);
  for (const event of fixture.events) {
    assert.equal(isAgentStreamEventNameV1(event), true);
  }
});

test("error code fixture matches exported enum", () => {
  const fixture = readJson("error-codes.json");
  assert.deepEqual(fixture.errorCodes, [...AGENT_ERROR_CODES_V1]);
  for (const code of fixture.errorCodes) {
    assert.equal(isAgentErrorCodeV1(code), true);
  }
});

test("skill metadata fixture has required Phase 0 fields", () => {
  const skill = readJson("skill-metadata.example.json");
  assert.equal(typeof skill.skillKey, "string");
  assert.equal(typeof skill.displayName, "string");
  assert.equal(typeof skill.version, "string");
  assert.equal(typeof skill.source, "string");
  assert.equal(typeof skill.verificationStatus, "string");
  assert.equal(typeof skill.enabled, "boolean");
  assert.equal(typeof skill.signatureStatus, "string");
  assert.equal(typeof skill.scanStatus, "string");
});

test("mock turn lifecycle frames use typed events only", () => {
  const lifecycle = readJson("turn-lifecycle.mock.json");
  assert.equal(lifecycle.mock, true);
  assert.ok(Array.isArray(lifecycle.frames));
  assert.ok(lifecycle.frames.length >= 3);
  for (const frame of lifecycle.frames) {
    assert.equal(isAgentStreamEventNameV1(frame.event), true, `unexpected event ${frame.event}`);
    assert.equal(typeof frame.data, "object");
  }
});

test("default capability closes direct ClawHub market path", () => {
  const capability = createDefaultAgentProtocolCapabilityV1();
  assert.equal(capability.protocol, AGENT_PROTOCOL_ID);
  assert.equal(capability.runtime_protocol_version, 1);
  assert.equal(capability[MARKET_DIRECT_CLAWHUB_ALLOWED_FLAG], false);
  assert.equal(capability.agent_turn_v1, true);
});
