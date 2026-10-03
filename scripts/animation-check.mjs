import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

// Exercise only the interpolation math, never mock a network result.
const source = await readFile(
  new URL("../src/utils/interpolation.ts", import.meta.url),
  "utf8",
);
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext },
}).outputText;
const { interpolateMeasurement: interpolate } = await import(
  `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`
);
for (const hz of [60, 120, 144, 240]) {
  for (const [from, target] of [
    [31.4, 45.8],
    [51.3, 18.7],
    [4.2, 102.4],
  ]) {
    let previous = from;
    for (let frame = 0; (frame / hz) * 1000 <= 360; frame++) {
      const next = interpolate(from, target, (frame / hz) * 1000);
      assert.ok(
        next >= Math.min(from, target) && next <= Math.max(from, target),
      );
      assert.ok(target > from ? next >= previous : next <= previous);
      previous = next;
    }
    assert.equal(interpolate(from, target, 360), target);
    assert.equal(
      interpolate(from, target, 2000),
      target,
      "Suspended tabs settle without overshoot",
    );
  }
}
assert.equal(interpolate(31.4, 45.8, -1), 31.4);
assert.equal(interpolate(31.4, 45.8, 1, 0), 45.8);
const mid = interpolate(31.4, 45.8, 120);
assert.equal(
  interpolate(mid, 51.3, 0),
  mid,
  "Retargeting continues from the current display",
);
console.log(
  "Interpolation passed: 60/120/144/240 Hz, bounded monotonic motion, retargeting, and exact settlement.",
);
