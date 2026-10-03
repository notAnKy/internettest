import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const base = process.env.TEST_URL || "http://127.0.0.1:3000";
for (const [route, title] of [
  ["/", "InternetTest"],
  ["/packet-loss", "Packet loss test — InternetTest"],
]) {
  const response = await fetch(`${base}${route}`);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.ok(html.includes(`<title>${title}</title>`));
  assert.ok(html.includes('name="viewport"'));
  assert.ok(html.includes('property="og:title"'));
  assert.ok(
    !html.includes("maximum-scale=1") && !html.includes("user-scalable=no"),
  );
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
}
assert.equal((await fetch(`${base}/icon.svg`)).status, 200);
assert.equal((await fetch(`${base}/third-party-notices.txt`)).status, 200);
const api = `${base}/api/turn-credentials`;
const status = await fetch(api);
assert.match(status.headers.get("cache-control"), /no-store/);
assert.deepEqual(Object.keys(await status.json()), ["configured"]);
for (const method of ["HEAD", "OPTIONS", "PUT", "PATCH", "DELETE"]) {
  const response = await fetch(api, { method });
  assert.equal(
    response.status,
    method === "HEAD" ? 200 : method === "OPTIONS" ? 204 : 405,
  );
  assert.match(response.headers.get("cache-control"), /no-store/);
}
for (const [headers, body, code] of [
  [
    {
      origin: "https://invalid.example",
      "x-internettest-test": "packet-loss",
      "content-type": "application/json",
    },
    "{}",
    403,
  ],
  [
    { origin: new URL(base).origin, "content-type": "application/json" },
    "{}",
    403,
  ],
  [
    {
      origin: new URL(base).origin,
      "x-internettest-test": "packet-loss",
      "content-type": "text/plain",
    },
    "{}",
    415,
  ],
  [
    {
      origin: new URL(base).origin,
      "x-internettest-test": "packet-loss",
      "content-type": "application/json",
    },
    "{}",
    400,
  ],
  [
    {
      origin: new URL(base).origin,
      "x-internettest-test": "packet-loss",
      "content-type": "application/json",
    },
    " ".repeat(1025),
    400,
  ],
]) {
  const response = await fetch(api, { method: "POST", headers, body });
  assert.equal(response.status, code);
  assert.deepEqual(Object.keys(await response.json()), ["code"]);
  assert.match(response.headers.get("cache-control"), /no-store/);
}
const ui = spawnSync(
  process.execPath,
  ["scripts/packet-loss-browser-check.mjs", "--release"],
  { stdio: "inherit", env: { ...process.env, TEST_URL: base } },
);
assert.equal(ui.status, 0);
console.log(
  "Production HTTP smoke passed: direct pages, metadata/viewport/favicon, private status, methods, origins, bounded invalid requests, and notices. No valid credential POST or provider traffic.",
);
