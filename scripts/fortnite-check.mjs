import assert from "node:assert/strict";
import { qualityModule } from "./quality-module.mjs";

const { testFortniteRoutes } = await import(
  await qualityModule(
    new URL("../src/lib/games/latency-engine.ts", import.meta.url),
  )
);
const { fortniteEuropeEndpoints, fortniteSource } = await import(
  await qualityModule(new URL("../src/lib/games/fortnite.ts", import.meta.url))
);
const expectedHosts = [
  "ping-fr.ds.on.epicgames.com",
  "ping-de.ds.on.epicgames.com",
  "ping-gb.ds.on.epicgames.com",
];
assert.equal(
  fortniteSource,
  "https://www.epicgames.com/help/c-34254770/c-37371353/a22355516",
);
assert.deepEqual(
  fortniteEuropeEndpoints.map((endpoint) => endpoint.host),
  expectedHosts,
  "Only Epic's verified European endpoints",
);
assert.equal(new Set(expectedHosts).size, 3);
const saved = {
  fetch: globalThis.fetch,
  WebSocket: globalThis.WebSocket,
  setTimeout: globalThis.setTimeout,
  setInterval: globalThis.setInterval,
};
const forbidden = () => {
  throw new Error(
    "Unsupported transport must not make a request or start a timer",
  );
};
try {
  globalThis.fetch =
    globalThis.WebSocket =
    globalThis.setTimeout =
    globalThis.setInterval =
      forbidden;
  const report = testFortniteRoutes();
  assert.equal(report.status, "unsupported");
  assert.equal(report.reason, "no-verified-browser-transport");
  assert.equal(
    report.bestRoute,
    null,
    "No best-route claim without measurements",
  );
  assert.equal(report.results.length, 3, "Report each endpoint independently");
  for (const [index, result] of report.results.entries()) {
    assert.equal(result.host, expectedHosts[index]);
    assert.equal(result.game, "fortnite");
    assert.equal(result.region, "Europe");
    assert.equal(result.status, "unsupported");
    assert.equal(result.measurementType, "none");
    assert.equal(
      result.latencyMs,
      null,
      "Missing latency never becomes zero or a timeout duration",
    );
    assert.equal(result.jitterMs, null);
    assert.deepEqual(
      result.samples,
      [],
      "No invented or transport-incompatible samples",
    );
  }
  const again = testFortniteRoutes();
  assert.deepEqual(again, report, "Unsupported result is deterministic");
  assert.notEqual(
    again.results[0].samples,
    report.results[0].samples,
    "Each invocation owns its result data",
  );
  assert.ok(
    !(report instanceof Promise),
    "No pending asynchronous operation to cancel or leak on unmount",
  );
} finally {
  Object.assign(globalThis, saved);
}
console.log(
  "Fortnite passed: verified catalog, explicit unsupported states, null values, no samples/best route, and zero network/timer use. No statistics are enabled without a valid transport.",
);
