import assert from "node:assert/strict";
import test from "node:test";
import { boundSoftwareOutput, mapSoftwareResponse } from "./software-task-policy.ts";
test("bounds software output and preserves the tail", () => { assert.equal(boundSoftwareOutput("12345", "67890", 5), "67890"); });
test("bounds multibyte software output by UTF-8 bytes without corrupting text", () => { const output = boundSoftwareOutput("前缀", "中".repeat(100), 64); assert.ok(Buffer.byteLength(output, "utf8") <= 64); assert.equal(output.includes("�"), false); assert.match(output, /中+$/u); });
test("maps Rust Core lifecycle responses without manufacturing timeout states", () => { assert.equal(mapSoftwareResponse("completed", true), "SUCCEEDED"); assert.equal(mapSoftwareResponse("cancelled", false), "CANCELLED"); assert.equal(mapSoftwareResponse("failed", false, "BRAIN_CORE_PROCESS_FAILED"), "FAILED"); });
