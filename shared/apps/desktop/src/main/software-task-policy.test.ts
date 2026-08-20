import assert from "node:assert/strict";
import test from "node:test";
import { boundSoftwareOutput, mapSoftwareResponse } from "./software-task-policy.ts";
test("bounds software output and preserves the tail", () => { assert.equal(boundSoftwareOutput("12345", "67890", 5), "67890"); });
test("maps Rust Core lifecycle responses", () => { assert.equal(mapSoftwareResponse("completed", true), "SUCCEEDED"); assert.equal(mapSoftwareResponse("cancelled", false), "CANCELLED"); assert.equal(mapSoftwareResponse("failed", false, "BRAIN_CORE_PROCESS_TIMEOUT"), "TIMED_OUT"); });
