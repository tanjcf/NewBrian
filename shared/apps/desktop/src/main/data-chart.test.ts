import assert from "node:assert/strict";
import test from "node:test";
import { buildNumericChart } from "./data-chart.ts";
test("bounds and normalizes numeric chart points", () => { const points = buildNumericChart(Array.from({ length: 1000 }, (_, index) => [String(index)]), 0, 32); assert.ok(points.length <= 32); assert.equal(points[0]?.x, 0); assert.equal(points.at(-1)?.x, 1); assert.equal(Math.min(...points.map((point) => point.y)), 0); assert.equal(Math.max(...points.map((point) => point.y)), 1); });
test("ignores invalid values and returns empty for nonnumeric data", () => { assert.deepEqual(buildNumericChart([["x"], ["bad"]], 0), []); });
