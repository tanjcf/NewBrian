import assert from "node:assert/strict";
import test from "node:test";
import { assertRustCoreRelease, sha256Hex } from "./rust-core-release.ts";

const HASH = "a".repeat(64);

test("accepts a release whose sha256 matches the manifest", () => {
  assert.equal(assertRustCoreRelease({
    schemaVersion: 1,
    fileName: "brain-core.exe",
    sha256: HASH.toUpperCase(),
    signer: ""
  }, HASH), HASH);
});

test("rejects a missing or altered brain-core hash", () => {
  assert.throws(() => assertRustCoreRelease({
    schemaVersion: 1,
    fileName: "brain-core.exe",
    sha256: "",
    signer: ""
  }, HASH), /BRAIN_CORE_RELEASE_UNSIGNED/u);
  assert.throws(() => assertRustCoreRelease({
    schemaVersion: 1,
    fileName: "brain-core.exe",
    sha256: "b".repeat(64),
    signer: "CN=NewBrain"
  }, HASH), /BRAIN_CORE_RELEASE_MISMATCH/u);
});

test("hashes the staged bytes", () => {
  const digest = sha256Hex(Buffer.from("brain-core"));
  assert.equal(digest, sha256Hex(Buffer.from("brain-core")));
  assert.match(digest, /^[a-f0-9]{64}$/u);
  assert.notEqual(digest, sha256Hex(Buffer.from("other")));
});
