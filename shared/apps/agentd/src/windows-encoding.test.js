import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeChildOutputBuffer,
  parseWindowsCodePage,
  resetWindowsEncodingCache
} from "./windows-encoding.js";

test("parseWindowsCodePage extracts chcp digits", () => {
  assert.equal(parseWindowsCodePage("Active code page: 936"), 936);
  assert.equal(parseWindowsCodePage("活动代码页: 65001"), 65001);
  assert.equal(parseWindowsCodePage(""), null);
});

test("decodeChildOutputBuffer prefers valid UTF-8", () => {
  resetWindowsEncodingCache();
  const text = decodeChildOutputBuffer(Buffer.from("你好 UTF-8", "utf8"), { platform: "win32" });
  assert.equal(text, "你好 UTF-8");
});

test("decodeChildOutputBuffer falls back to GBK when UTF-8 is invalid", () => {
  resetWindowsEncodingCache();
  // GBK bytes for 你好
  const gbk = Buffer.from([0xc4, 0xe3, 0xba, 0xc3]);
  const text = decodeChildOutputBuffer(gbk, { platform: "win32", windowsEncoding: "gbk" });
  assert.equal(text, "你好");
});

test("decodeChildOutputBuffer on non-Windows uses utf8", () => {
  const gbk = Buffer.from([0xc4, 0xe3, 0xba, 0xc3]);
  const text = decodeChildOutputBuffer(gbk, { platform: "linux" });
  assert.notEqual(text, "你好");
});
