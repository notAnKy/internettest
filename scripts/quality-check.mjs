import assert from "node:assert/strict";
import { qualityModule } from "./quality-module.mjs";

const { analyzeConnection } = await import(await qualityModule());
const strong = Object.freeze({
  downloadMbps: 50,
  uploadMbps: 20,
  latencyMs: 20,
  jitterMs: 2,
  downloadLoadedLatencyMs: 23,
  uploadLoadedLatencyMs: 22,
  timestamp: "2026-10-03T12:00:00.000Z",
  durationMs: 30_000,
});
// Deterministic fixtures belong only in this test script, never in app code.
const cases = [
  [
    "strong balanced",
    strong,
    {
      overall: "excellent",
      gaming: "excellent",
      streaming: "excellent",
      browsing: "excellent",
      videoCalls: "excellent",
      bufferbloat: "excellent",
    },
  ],
  [
    "high bandwidth, severe loaded latency",
    {
      ...strong,
      downloadMbps: 1000,
      uploadMbps: 100,
      downloadLoadedLatencyMs: 300,
      uploadLoadedLatencyMs: 180,
    },
    {
      overall: "fair",
      gaming: "poor",
      streaming: "excellent",
      videoCalls: "poor",
      bufferbloat: "poor",
    },
  ],
  [
    "slow connection",
    {
      ...strong,
      downloadMbps: 0.8,
      uploadMbps: 0.15,
      latencyMs: 30,
      jitterMs: 5,
      downloadLoadedLatencyMs: 80,
      uploadLoadedLatencyMs: 80,
    },
    {
      overall: "poor",
      gaming: "poor",
      streaming: "poor",
      browsing: "poor",
      videoCalls: "poor",
    },
  ],
  [
    "high idle latency",
    {
      ...strong,
      latencyMs: 160,
      downloadLoadedLatencyMs: 165,
      uploadLoadedLatencyMs: 163,
    },
    {
      overall: "fair",
      gaming: "poor",
      browsing: "fair",
      videoCalls: "fair",
      bufferbloat: "good",
    },
  ],
  [
    "high jitter",
    { ...strong, jitterMs: 40 },
    { overall: "fair", gaming: "poor", videoCalls: "poor" },
  ],
  [
    "missing loaded latency",
    { ...strong, downloadLoadedLatencyMs: null, uploadLoadedLatencyMs: null },
    { overall: "good", gaming: "excellent", bufferbloat: "unavailable" },
  ],
];
for (const [name, raw, expected] of cases) {
  const before = structuredClone(raw);
  const report = analyzeConnection(Object.freeze(raw));
  for (const [key, grade] of Object.entries(expected))
    assert.equal(report[key].grade, grade, `${name}: ${key}`);
  assert.deepEqual(raw, before, "Analyzer does not mutate raw measurements");
  assert.deepEqual(analyzeConnection(raw), report, "Deterministic derivation");
  for (const [key, value] of Object.entries(report)) {
    if (key === "methodologyVersion") continue;
    assert.ok(value.metrics.length <= 3, "Expanded rows stay concise");
    assert.ok(
      value.metrics.every((metric) => Number.isFinite(metric.value)),
      "Only valid measured/derived metrics",
    );
  }
}
const missing = analyzeConnection(cases[5][1]);
assert.equal(missing.overall.coverage, "limited");
assert.equal(missing.bufferbloat.downloadIncreaseMs, null);
assert.equal(missing.bufferbloat.worstIncreaseMs, null);
for (const increase of [4.999, 5, 29.999, 30, 59.999, 60, 200, 400]) {
  const report = analyzeConnection({
    ...strong,
    downloadLoadedLatencyMs: 20 + increase,
  });
  const expected =
    increase < 5
      ? "excellent"
      : increase < 30
        ? "good"
        : increase < 60
          ? "fair"
          : "poor";
  assert.equal(
    report.bufferbloat.grade,
    expected,
    `Added-latency boundary ${increase}`,
  );
}
const example = analyzeConnection({
  ...strong,
  latencyMs: 33.6,
  downloadLoadedLatencyMs: 88.7,
  uploadLoadedLatencyMs: 43.8,
});
assert.ok(Math.abs(example.bufferbloat.downloadIncreaseMs - 55.1) < 1e-9);
assert.ok(Math.abs(example.bufferbloat.uploadIncreaseMs - 10.2) < 1e-9);
assert.equal(example.bufferbloat.grade, "fair");
const partial = analyzeConnection({
  ...strong,
  downloadLoadedLatencyMs: 180,
  uploadLoadedLatencyMs: null,
});
assert.equal(
  partial.bufferbloat.grade,
  "unavailable",
  "One direction cannot certify bufferbloat",
);
assert.equal(partial.bufferbloat.coverage, "limited");
assert.equal(
  partial.gaming.grade,
  "poor",
  "Known bad direction still warns other use cases",
);
const negative = analyzeConnection({
  ...strong,
  downloadLoadedLatencyMs: 18,
  uploadLoadedLatencyMs: 16,
});
assert.equal(
  negative.bufferbloat.downloadIncreaseMs,
  -2,
  "Preserve signed measured differences",
);
assert.equal(
  negative.bufferbloat.grade,
  "excellent",
  "Negative variation is no added latency",
);
const empty = analyzeConnection(
  Object.fromEntries(
    Object.entries(strong).map(([key, value]) => [
      key,
      typeof value === "number" ? null : value,
    ]),
  ),
);
for (const key of [
  "overall",
  "gaming",
  "streaming",
  "browsing",
  "videoCalls",
  "bufferbloat",
])
  assert.equal(empty[key].grade, "unavailable");
const invalid = analyzeConnection({
  ...strong,
  downloadMbps: NaN,
  uploadMbps: Infinity,
  latencyMs: -1,
});
assert.equal(invalid.overall.grade, "unavailable");
assert.equal(invalid.streaming.grade, "unavailable");
const zero = analyzeConnection({
  ...strong,
  downloadMbps: 0,
  uploadMbps: 0,
  latencyMs: 0,
  jitterMs: 0,
  downloadLoadedLatencyMs: 0,
  uploadLoadedLatencyMs: 0,
});
assert.equal(
  zero.streaming.grade,
  "poor",
  "Measured zero bandwidth differs from missing",
);
assert.equal(
  zero.bufferbloat.grade,
  "excellent",
  "Measured zero latency is valid",
);
for (const [latency, expected] of [
  [40, "excellent"],
  [40.001, "good"],
  [80, "good"],
  [80.001, "fair"],
  [150, "fair"],
  [150.001, "poor"],
]) {
  assert.equal(
    analyzeConnection({
      ...strong,
      latencyMs: latency,
      downloadLoadedLatencyMs: latency + 2,
      uploadLoadedLatencyMs: latency + 2,
    }).gaming.grade,
    expected,
  );
}
const modest = analyzeConnection({
  ...strong,
  downloadMbps: 10,
  uploadMbps: 5,
});
const fast = analyzeConnection({
  ...strong,
  downloadMbps: 1000,
  uploadMbps: 500,
});
for (const key of ["gaming", "browsing", "videoCalls"])
  assert.equal(
    modest[key].grade,
    fast[key].grade,
    `${key}: sufficient bandwidth saturates`,
  );
assert.equal(
  modest.overall.grade,
  "excellent",
  "Moderate bandwidth with strong responsiveness remains capable",
);
console.log(
  "Quality checks passed: six connection fixtures, boundaries, missing/partial/invalid data, signed deltas, saturation, and raw-data immutability.",
);
