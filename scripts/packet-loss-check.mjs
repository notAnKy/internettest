import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { qualityModule } from "./quality-module.mjs";

const engine = await import(
  await qualityModule(
    new URL("../src/lib/packet-loss/engine.ts", import.meta.url),
  )
);
const { udpIceServers } = await import(
  await qualityModule(
    new URL("../src/lib/packet-loss/turn.ts", import.meta.url),
  )
);
const { packetLossResult, lossNote, deliveryStatistics } = await import(
  await qualityModule(
    new URL("../src/lib/packet-loss/statistics.ts", import.meta.url),
  )
);
const { packetPresets, validatePacketLossSettings } = await import(
  await qualityModule(
    new URL("../src/lib/packet-loss/settings.ts", import.meta.url),
  )
);
// Execute the actual handler with mocked fetch/env. Only the Next import guard
// is removed in this isolated test; no test paths enter production code.
const { exportPacketLoss } = await import(
  await qualityModule(
    new URL("../src/lib/packet-loss/export.ts", import.meta.url),
  )
);
const routeUrl = new URL(
  "../src/app/api/turn-credentials/route.ts",
  import.meta.url,
);
async function serverModule(url) {
  let code = ts
    .transpileModule(await readFile(url, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    })
    .outputText.replace('import "server-only";', "");
  for (const match of code.matchAll(/from ["'](\.\.?\/[^"']+)["']/g))
    code = code.replace(
      match[1],
      await serverModule(new URL(`${match[1]}.ts`, url)),
    );
  return `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
}
const route = await import(await serverModule(routeUrl));
const { meteredConfiguration } = await import(
  await serverModule(new URL("../src/lib/turn/metered.ts", import.meta.url))
);
const ice = {
  iceServers: [
    {
      urls: [
        "turn:standard.relay.metered.ca:80",
        "turn:standard.relay.metered.ca:443?transport=udp",
        "turn:standard.relay.metered.ca:80?transport=tcp",
        "turns:standard.relay.metered.ca:443?transport=tcp",
        "turn:evil.invalid:3478?transport=udp",
        "turn:global.relay.metered.ca:80",
        "turn:standard.relay.metered.ca.evil.invalid:80",
        "turn:standard.relay.metered.ca:5349",
      ],
      username: "test-only-turn-user",
      credential: "test-only-turn-password",
    },
  ],
};
assert.deepEqual(udpIceServers(ice)[0].urls, [
  "turn:standard.relay.metered.ca:80?transport=udp",
  "turn:standard.relay.metered.ca:443?transport=udp",
]);
assert.deepEqual(
  udpIceServers({
    iceServers: [{ urls: "turn:standard.relay.metered.ca:80" }],
  }),
  [],
);
assert.equal(packetLossResult(100, 97, 500).lossPercent, 3);
assert.equal(packetLossResult(100, 100, 0).lostPackets, 0);
for (const counts of [
  [0, 0],
  [100, 101],
  [100, -1],
  [NaN, 2],
  [1.5, 1],
])
  assert.throws(() => packetLossResult(...counts, 10));
assert.match(lossNote(0), /No loss observed/);
assert.match(lossNote(1), /may be affected/);

const saved = {
  performance: globalThis.performance,
  fetch: globalThis.fetch,
  RTCPeerConnection: globalThis.RTCPeerConnection,
  setTimeout: globalThis.setTimeout,
  clearTimeout: globalThis.clearTimeout,
};
const priorEnv = {
  key: process.env.METERED_APP_NAME,
  token: process.env.METERED_TURN_API_KEY,
};
let now = 0,
  nextId = 0;
const timers = new Map();
const flush = async () => {
  for (let n = 0; n < 24; n++) await Promise.resolve();
};
async function tick(ms) {
  const until = now + ms;
  while (true) {
    await flush();
    const next = [...timers]
      .filter(([, timer]) => timer.at <= until)
      .sort((a, b) => a[1].at - b[1].at)[0];
    if (!next) break;
    now = next[1].at;
    timers.delete(next[0]);
    next[1].fn();
  }
  now = until;
  await flush();
}
const request = (
  headers = {},
  signal,
  body = JSON.stringify(packetPresets.default.settings),
) =>
  new Request("http://localhost:3000/api/turn-credentials", {
    method: "POST",
    headers: {
      origin: "http://localhost:3000",
      "x-internettest-test": "packet-loss",
      "content-type": "application/json",
      ...headers,
    },
    signal,
    body,
  });
let calls = 0;
try {
  globalThis.performance = { now: () => now };
  globalThis.setTimeout = (fn, ms) => {
    const id = ++nextId;
    timers.set(id, { at: now + ms, fn });
    return id;
  };
  globalThis.clearTimeout = (id) => timers.delete(id);
  globalThis.fetch = async () => {
    calls++;
    throw new Error("must not contact upstream");
  };
  delete process.env.METERED_APP_NAME;
  delete process.env.METERED_TURN_API_KEY;
  assert.deepEqual(await route.GET().json(), { configured: false });
  assert.equal((await route.POST(request())).status, 503);
  assert.equal(calls, 0);
  // NextRequest normalizes 127.0.0.1 to localhost; compare the real Host.
  assert.equal(
    (
      await route.POST(
        request({ host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" }),
      )
    ).status,
    503,
  );
  assert.equal(
    (
      await route.POST(
        request({
          host: "internettest.example",
          origin: "http://internettest.example",
        }),
      )
    ).status,
    503,
  );
  for (const host of [
    "evil.example",
    "localhost:3000/evil",
    "evil.example@localhost:3000",
  ]) {
    assert.equal((await route.POST(request({ host }))).status, 403);
  }
  assert.equal(calls, 0);
  for (const method of ["PUT", "PATCH", "DELETE"]) {
    const response = route[method]();
    assert.equal(response.status, 405);
    assert.match(response.headers.get("cache-control"), /no-store/);
  }
  assert.equal(route.OPTIONS().status, 204);
  for (const body of [
    "{}",
    "null",
    "[]",
    "not-json",
    " ".repeat(1025),
    JSON.stringify({ ...packetPresets.default.settings, frequency: 6000 }),
    JSON.stringify({
      ...packetPresets.default.settings,
      packetSize: 1200,
      frequency: 30,
      duration: 29,
      warmup: true,
    }),
  ]) {
    assert.equal((await route.POST(request({}, undefined, body))).status, 400);
  }
  assert.equal(
    (await route.POST(request({ "content-type": "text/plain" }))).status,
    415,
  );
  assert.equal(
    (await route.POST(request({ "content-length": "999999" }))).status,
    400,
  );
  assert.equal(calls, 0, "Invalid settings never fetch provider credentials");
  process.env.METERED_APP_NAME = "test-app";
  assert.equal((await route.POST(request())).status, 503, "Missing API key");
  process.env.METERED_TURN_API_KEY = "test-only-credential-api-key";
  for (const app of [
    "test-app",
    " TEST-APP ",
    "test-app.metered.live",
    "https://test-app.metered.live/",
    " HTTPS://TEST-APP.METERED.LIVE/ ",
  ]) {
    process.env.METERED_APP_NAME = app;
    assert.deepEqual(await route.GET().json(), { configured: true });
    assert.equal(meteredConfiguration().appName, "test-app");
  }
  for (const app of [
    "https://evil.invalid",
    "a.metered.live.evil.invalid",
    "https://a.metered.live@evil.invalid",
    "http://a.metered.live",
    "https://a.metered.live/path",
    "https://a.metered.live?query=1",
    "https://a.metered.live:443",
    "-bad.metered.live",
    `${"a".repeat(64)}.metered.live`,
    "bad/name",
    "-bad",
    "a".repeat(64),
  ]) {
    process.env.METERED_APP_NAME = app;
    assert.deepEqual(await route.GET().json(), { configured: false });
  }
  process.env.METERED_APP_NAME = "test-app";
  assert.deepEqual(await route.GET().json(), { configured: true });
  assert.equal(
    (await route.POST(request({ origin: "https://evil.invalid" }))).status,
    403,
  );
  assert.equal(calls, 0);
  const meteredPayload = [
    { urls: "stun:stun.relay.metered.ca:80" },
    ...ice.iceServers[0].urls.map((urls) => ({
      urls,
      username: "test-only-turn-user",
      credential: "test-only-turn-password",
      apiKey: "should-not-be-returned",
    })),
  ];
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(url.origin, "https://test-app.metered.live");
    assert.equal(url.pathname, "/api/v1/turn/credentials");
    assert.equal(
      url.searchParams.get("apiKey"),
      "test-only-credential-api-key",
    );
    assert.equal(url.searchParams.get("region"), "standard");
    assert.equal(url.searchParams.get("secretKey"), null);
    assert.equal(options.method, "GET");
    assert.equal(options.cache, "no-store");
    return Response.json(meteredPayload);
  };
  process.env.METERED_APP_NAME = "https://TEST-APP.metered.live/";
  const response = await route.POST(request());
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /no-store/);
  const safe = await response.json();
  assert.deepEqual(Object.keys(safe), ["iceServers"]);
  assert.deepEqual(
    safe.iceServers,
    udpIceServers({ iceServers: meteredPayload }),
  );
  assert.ok(!JSON.stringify(safe).includes("api-key"));
  assert.ok(!JSON.stringify(safe).includes("should-not-be-returned"));
  for (const status of [401, 500, 429]) {
    globalThis.fetch = async () =>
      new Response("secret upstream error", { status });
    const failed = await route.POST(request());
    assert.equal(failed.status, status === 429 ? 429 : 502);
    assert.deepEqual(await failed.json(), { code: "credentials-unavailable" });
    if (status === 429) assert.equal(failed.headers.get("retry-after"), "60");
  }
  for (const bad of [
    [],
    { iceServers: ice.iceServers },
    [{ ...ice.iceServers[0], credential: "test-only-credential-api-key" }],
    [
      {
        ...ice.iceServers[0],
        urls: "turn:standard.relay.metered.ca:80?transport=tcp",
      },
    ],
  ]) {
    globalThis.fetch = async () => Response.json(bad);
    assert.equal((await route.POST(request())).status, 502);
  }
  const hangingFetch = (_url, options) =>
    new Promise((_, reject) =>
      options.signal.addEventListener(
        "abort",
        () => reject(new DOMException("cancel", "AbortError")),
        { once: true },
      ),
    );
  globalThis.fetch = hangingFetch;
  const pending = route.POST(request());
  await new Promise(setImmediate); // Let the native request-body stream settle.
  await tick(8000);
  assert.equal((await pending).status, 502);
  assert.equal(timers.size, 0, "Server timeout is disposed");
  const upstreamAbort = new AbortController();
  const abortedRequest = route.POST(request({}, upstreamAbort.signal));
  await new Promise(setImmediate);
  upstreamAbort.abort();
  assert.equal((await abortedRequest).status, 502);
  assert.equal(timers.size, 0);

  let bodyCancelled = false;
  const stalledBody = new Request(
    "http://localhost:3000/api/turn-credentials",
    {
      method: "POST",
      headers: {
        origin: "http://localhost:3000",
        "x-internettest-test": "packet-loss",
        "content-type": "application/json",
      },
      body: new ReadableStream({
        cancel() {
          bodyCancelled = true;
        },
      }),
      duplex: "half",
    },
  );
  const slowBody = route.POST(stalledBody);
  await tick(8000);
  assert.equal((await slowBody).status, 408);
  assert.ok(bodyCancelled, "Timed-out body stream is cancelled");
  assert.equal(timers.size, 0);

  let peers = [],
    channels = [],
    lost = new Set(),
    duplicate = false,
    protocol = "udp",
    hangStats = false,
    sentMessages = [],
    delayFor = () => 0;
  const stats = () =>
    new Map([
      ["transport", { type: "transport", selectedCandidatePairId: "pair" }],
      [
        "pair",
        {
          state: "succeeded",
          localCandidateId: "local",
          remoteCandidateId: "remote",
        },
      ],
      [
        "local",
        { candidateType: "relay", protocol: "udp", relayProtocol: protocol },
      ],
      ["remote", { candidateType: "relay", protocol: "udp" }],
    ]);
  class Channel {
    readyState = "connecting";
    constructor() {
      channels.push(this);
    }
    send(data) {
      assert.equal(this.readyState, "open");
      const sequence = Number(data.split("|")[0]);
      sentMessages.push({ data, at: now });
      if (!lost.has(sequence)) {
        const deliver = () => {
          channels[1].onmessage?.({ data });
          if (duplicate) channels[1].onmessage?.({ data });
          channels[1].onmessage?.({ data: "not-a-sample" });
          channels[1].onmessage?.({ data: "101" });
        };
        if (delayFor(sequence)) setTimeout(deliver, delayFor(sequence));
        else queueMicrotask(deliver);
      }
    }
    close() {
      this.readyState = "closed";
    }
  }
  class Peer {
    connectionState = "new";
    constructor(config) {
      assert.equal(config.iceTransportPolicy, "relay");
      assert.equal(udpIceServers(config).length, 1);
      peers.push(this);
    }
    createDataChannel(_label, config) {
      assert.deepEqual(config, { ordered: false, maxRetransmits: 0 });
      return new Channel();
    }
    async createOffer() {
      return { type: "offer" };
    }
    async createAnswer() {
      return { type: "answer" };
    }
    async setLocalDescription(value) {
      this.localDescription = value;
      this.onicecandidate?.({
        candidate: {
          protocol: "udp",
          type: "relay",
          candidate: "candidate:1 1 udp 1 127.0.0.1 1234 typ relay",
        },
      });
      this.onicecandidate?.({
        candidate: { protocol: "tcp", type: "relay", candidate: "" },
      });
      this.onicecandidate?.({
        candidate: { protocol: "udp", type: "host", candidate: "" },
      });
    }
    async setRemoteDescription(value) {
      this.remoteDescription = value;
    }
    async addIceCandidate(candidate) {
      assert.ok(
        this.remoteDescription,
        "ICE is queued until the remote description exists",
      );
      assert.equal(candidate.protocol, "udp");
      assert.equal(candidate.type, "relay");
    }
    getStats() {
      return hangStats ? new Promise(() => {}) : Promise.resolve(stats());
    }
    close() {
      this.connectionState = "closed";
    }
  }
  globalThis.RTCPeerConnection = Peer;
  const reset = () => {
    peers = [];
    channels = [];
    lost = new Set();
    duplicate = false;
    protocol = "udp";
    hangStats = false;
    sentMessages = [];
    delayFor = () => 0;
  };
  const open = async () => {
    await flush();
    peers.forEach((peer) => (peer.connectionState = "connected"));
    const receiving = new Channel();
    peers[1].ondatachannel({ channel: receiving });
    channels.forEach((channel) => (channel.readyState = "open"));
    channels.forEach((channel) => channel.onopen?.());
    await flush();
  };
  const clean = () => {
    assert.equal(timers.size, 0, "No owned timers remain");
    assert.ok(peers.every((peer) => peer.connectionState === "closed"));
    assert.ok(channels.every((channel) => channel.readyState === "closed"));
  };
  for (const lossCount of [0, 3]) {
    reset();
    lost = new Set(Array.from({ length: lossCount }, (_, n) => n + 1));
    duplicate = true;
    const measured = engine.measurePacketLoss(
      udpIceServers(ice),
      new AbortController().signal,
    );
    await open();
    await tick(5100);
    const result = await measured;
    assert.equal(result.sentPackets, 100);
    assert.equal(result.receivedPackets, 100 - lossCount);
    assert.equal(result.lossPercent, lossCount);
    clean();
  }
  for (const preset of Object.values(packetPresets))
    assert.deepEqual(
      validatePacketLossSettings(preset.settings),
      preset.settings,
    );
  for (const bad of [
    { ...packetPresets.default.settings, packetSize: 1201 },
    { ...packetPresets.default.settings, frequency: NaN },
    { ...packetPresets.default.settings, frequency: 0 },
    { ...packetPresets.default.settings, duration: 61 },
    { ...packetPresets.default.settings, duration: 5.5 },
    { ...packetPresets.default.settings, acceptableDelay: -1 },
    { ...packetPresets.default.settings, warmup: "yes" },
    { ...packetPresets.default.settings, frequency: 60, duration: 60 },
    {
      ...packetPresets.default.settings,
      packetSize: 1200,
      frequency: 30,
      duration: 29,
      warmup: true,
    },
    { ...packetPresets.default.settings, extra: "test-only-rejected-metadata" },
  ])
    await assert.rejects(
      engine.runPacketLoss(new AbortController().signal, undefined, bad),
      { code: "invalid-settings" },
    );
  reset();
  lost = new Set([3]);
  duplicate = true;
  delayFor = (sequence) => (sequence === 2 ? 300 : 40);
  const chosen = {
    packetSize: 300,
    frequency: 2,
    duration: 5,
    acceptableDelay: 200,
    warmup: true,
  };
  const details = [];
  const paced = engine.measurePacketLoss(
    udpIceServers(ice),
    new AbortController().signal,
    (sent, received, detail) => details.push({ sent, received, ...detail }),
    chosen,
  );
  await open();
  chosen.packetSize = 999; // A caller changing settings must not change an active test.
  await tick(1000);
  assert.equal(details.at(-1).phase, "warmup");
  assert.equal(details.at(-1).sent, 0);
  await tick(11000);
  const pacedResult = await paced;
  assert.equal(pacedResult.sentPackets, 10);
  assert.equal(pacedResult.receivedPackets, 9);
  assert.equal(pacedResult.lossPercent, 10);
  assert.equal(pacedResult.delivery.latePackets, 1);
  assert.equal(pacedResult.delivery.latePercent, 10);
  assert.equal(pacedResult.delivery.settings.packetSize, 300);
  assert.equal(pacedResult.delivery.samples[2].delayMs, null);
  assert.equal(pacedResult.delivery.samples[1].delayMs, 300);
  assert.equal(pacedResult.delivery.samples[0].delayMs, 40);
  assert.equal(pacedResult.delivery.averageDelayMs, (300 + 8 * 40) / 9);
  assert.equal(pacedResult.delivery.jitterMs, 65);
  const forbidden = "test-only-export-forbidden-value";
  const tainted = {
    ...pacedResult,
    apiKey: forbidden,
    iceServers: [{ username: forbidden, credential: forbidden }],
    delivery: {
      ...pacedResult.delivery,
      credential: forbidden,
      settings: { ...pacedResult.delivery.settings, apiKey: forbidden },
      samples: pacedResult.delivery.samples.map((sample) => ({
        ...sample,
        token: forbidden,
      })),
    },
  };
  const date = new Date("2026-10-03T15:00:00.000Z");
  for (const format of ["json", "csv"]) {
    const exported = exportPacketLoss(tainted, format, date);
    assert.equal(
      exported.filename,
      `internettest-packet-loss-2026-10-03.${format}`,
    );
    assert.ok(!exported.text.includes(forbidden));
    assert.ok(!/apiKey|credential|iceServers|token/.test(exported.text));
  }
  const exported = JSON.parse(exportPacketLoss(tainted, "json", date).text);
  assert.equal(exported.delivery.latePackets, 1);
  assert.equal(exported.lostPackets, 1);
  assert.match(
    exportPacketLoss(tainted, "csv", date).text,
    /2,300,late\n3,,lost/,
  );
  assert.throws(() =>
    exportPacketLoss(
      {
        ...tainted,
        delivery: {
          ...tainted.delivery,
          samples: [
            { sequence: "=HYPERLINK()", delayMs: 40 },
            ...tainted.delivery.samples.slice(1),
          ],
        },
      },
      "csv",
      date,
    ),
  );
  assert.equal(
    validatePacketLossSettings({
      ...packetPresets.gaming.settings,
      duration: 30,
    }).duration,
    30,
  );
  assert.equal(
    validatePacketLossSettings({
      packetSize: 1200,
      frequency: 30,
      duration: 29,
      acceptableDelay: 200,
      warmup: false,
    }).packetSize,
    1200,
    "Payload close to the budget is accepted",
  );
  assert.equal(sentMessages.length, 14);
  assert.ok(sentMessages.every(({ data }) => Buffer.byteLength(data) === 300));
  const recorded = sentMessages.filter(({ data }) => !data.startsWith("w"));
  assert.equal(recorded[0].at - sentMessages[0].at, 2000);
  for (let index = 1; index < recorded.length; index++)
    assert.equal(recorded[index].at - recorded[index - 1].at, 500);
  clean();
  for (const phase of ["warmup", "testing", "waiting"]) {
    reset();
    lost = new Set([1]);
    const controller = new AbortController();
    const pending = engine
      .measurePacketLoss(udpIceServers(ice), controller.signal, undefined, {
        ...chosen,
        packetSize: 300,
      })
      .catch((error) => error);
    await open();
    await tick(phase === "warmup" ? 500 : phase === "testing" ? 3000 : 7100);
    controller.abort();
    assert.equal((await pending).name, "AbortError");
    clean();
    await tick(20000);
    clean();
  }
  assert.equal(
    deliveryStatistics([{ sequence: 1, delayMs: 200 }], {
      ...chosen,
      packetSize: 300,
    }).latePackets,
    0,
    "Threshold equality is not late",
  );
  assert.equal(
    deliveryStatistics([{ sequence: 1, delayMs: 200 }], {
      ...chosen,
      packetSize: 300,
    }).jitterMs,
    null,
  );
  for (const scenario of [
    "tcp",
    "no-delivery",
    "connection-failed",
    "timeout",
    "cancel-negotiation",
    "cancel-sending",
  ]) {
    reset();
    const controller = new AbortController();
    const observed = engine
      .measurePacketLoss(udpIceServers(ice), controller.signal)
      .then(
        () => ({ success: true }),
        (error) => ({ error }),
      );
    if (scenario === "tcp") {
      protocol = "tcp";
      await open();
    }
    if (scenario === "no-delivery") {
      lost = new Set(Array.from({ length: 100 }, (_, n) => n + 1));
      await open();
      await tick(5100);
    }
    if (scenario === "connection-failed") await tick(7000);
    if (scenario === "timeout") {
      hangStats = true;
      await open();
      await tick(15000);
    }
    if (scenario === "cancel-negotiation") controller.abort();
    if (scenario === "cancel-sending") {
      await open();
      controller.abort();
    }
    const { error } = await observed;
    assert.ok(error, `${scenario} cannot produce a percentage`);
    assert.equal(
      error.name,
      scenario.startsWith("cancel") ? "AbortError" : "PacketLossError",
    );
    if (scenario === "no-delivery") assert.equal(error.code, "no-delivery");
    clean();
    await tick(20000);
    clean();
  }
  assert.equal(engine.verifiedUdpRelay(stats()), true);
  protocol = "tls";
  assert.equal(engine.verifiedUdpRelay(stats()), false);
  assert.equal(engine.verifiedUdpRelay(new Map()), false);
  delete globalThis.RTCPeerConnection;
  await assert.rejects(engine.runPacketLoss(new AbortController().signal), {
    code: "unsupported",
  });
  globalThis.RTCPeerConnection = Peer;
  globalThis.fetch = async () =>
    Response.json({ code: "setup-required" }, { status: 503 });
  await assert.rejects(engine.runPacketLoss(new AbortController().signal), {
    code: "setup-required",
  });
  globalThis.fetch = async () => {
    throw new Error("network offline");
  };
  await assert.rejects(engine.runPacketLoss(new AbortController().signal), {
    code: "credentials-unavailable",
  });
  globalThis.fetch = hangingFetch;
  const credentialsAbort = new AbortController();
  const cancelledCredentials = engine
    .runPacketLoss(credentialsAbort.signal)
    .catch((error) => error);
  credentialsAbort.abort();
  assert.equal((await cancelledCredentials).name, "AbortError");
  clean();
  const stalled = engine
    .runPacketLoss(new AbortController().signal)
    .catch((error) => error);
  await tick(9000);
  assert.equal((await stalled).code, "timeout");
  clean();
} finally {
  Object.assign(globalThis, saved);
  for (const [name, value] of [
    ["METERED_APP_NAME", priorEnv.key],
    ["METERED_TURN_API_KEY", priorEnv.token],
  ]) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}
console.log(
  "Packet loss passed: actual modules with mocked WebRTC, legacy sample, settings validation, fixed-size pacing, warm-up exclusion, delay/lateness/jitter, UDP verification, errors, timeouts, cancellation in every phase, and zero leaked connections/timers. No real traffic.",
);
