import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./SidebarIcon.tsx", import.meta.url), "utf8");
const copy = source.slice(source.indexOf('name === "copy"'), source.indexOf('name === "remove"'));

test("message copy icon is the standard two-sheet outline", () => {
  assert.match(copy, /<rect /);
  assert.match(copy, /<path d="M6 15V6/);
  assert.doesNotMatch(copy, /17\.25v3\.375/);
});
