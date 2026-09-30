import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("government writing specification UI exposes four sections and both editing modes", async () => {
  const source = await readFile(new URL("./GovernmentWritingSpecification.tsx", import.meta.url), "utf8");
  for (const label of ["写作任务", "核心要求", "案例与官方证据", "结构模板"]) assert.match(source, new RegExp(label));
  assert.match(source, /structured[\s\S]*markdown/u);
  assert.match(source, /让大模型修改/u);
  assert.match(source, /让大模型指导修改/u);
  assert.match(source, /确认并开始写作/u);
  assert.match(source, /全部应用/u);
  assert.match(source, /添加要求/u);
  assert.match(source, /删除要求/u);
  assert.match(source, /待用户确认/u);
  assert.match(source, /确认此项/u);
  assert.match(source, /currentVersionId/u);
});
