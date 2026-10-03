import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const canaryId = "internettest-build-only-metered-app";
const canaryToken = "internettest-build-only-turn-secret-canary-20261003";
if (process.argv.includes("--build")) {
  const build = spawnSync(
    process.execPath,
    ["node_modules/next/dist/bin/next", "build"],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        METERED_APP_NAME: canaryId,
        METERED_TURN_API_KEY: canaryToken,
      },
    },
  );
  assert.equal(
    build.status,
    0,
    "Production build passed with synthetic server-only values",
  );
}
const route = await readFile("src/app/api/turn-credentials/route.ts", "utf8");
assert.match(route, /import "server-only"/);
assert.ok(
  !/console\./.test(route),
  "Credential handler does not log errors or secrets",
);
const provider = await readFile("src/lib/turn/metered.ts", "utf8");
assert.match(provider, /import "server-only"/);
assert.ok(!/console\./.test(provider));
const ignore = await readFile(".gitignore", "utf8");
assert.match(ignore, /^\.env\*$/m);
assert.match(ignore, /^!\.env\.example$/m);
const example = await readFile(".env.example", "utf8");
assert.match(example, /METERED_APP_NAME=your_app_name/);
assert.match(example, /METERED_TURN_API_KEY=your_credential_api_key/);
assert.ok(!/NEXT_PUBLIC_METERED/.test(example));
async function files(path) {
  const entries = await readdir(path, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) =>
        entry.isDirectory()
          ? files(`${path}/${entry.name}`)
          : [`${path}/${entry.name}`],
      ),
    )
  ).flat();
}
let checked = 0;
for (const path of await files(".next/static")) {
  if (!/\.(js|map)$/.test(path)) continue;
  const source = await readFile(path, "utf8");
  for (const forbidden of [
    canaryId,
    canaryToken,
    "METERED_TURN_API_KEY",
    "METERED_APP_NAME",
    "/api/v1/turn/credentials",
  ])
    assert.ok(
      !source.includes(forbidden),
      "Client bundle excludes server secret/code canaries",
    );
  checked++;
}
assert.ok(checked > 0);
console.log(
  `Packet-loss security passed: ${checked} client JS/maps checked; no server credential names, API endpoint, or synthetic secrets. Server-only/no-log guard, ignored .env.local, and placeholder example verified.`,
);
