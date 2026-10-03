import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";

const env = {
  ...process.env,
  METERED_APP_NAME: "internettest-build-only-metered-app",
  METERED_TURN_API_KEY: "internettest-build-only-turn-secret-canary-20261003",
};
function run(args, variables = env) {
  const result = spawnSync(process.execPath, args, {
    stdio: "inherit",
    env: variables,
  });
  if (result.status !== 0) throw new Error(`Release check failed: ${args[0]}`);
}
const smokeOnly = process.argv.includes("--smoke-only");
if (!smokeOnly) {
  run(["scripts/unit-check.mjs"]);
  run(["node_modules/eslint/bin/eslint.js", "."]);
  run(["node_modules/typescript/bin/tsc", "--noEmit"]);
  run(["scripts/packet-loss-security-check.mjs", "--build"]);
  run(["scripts/release-security-check.mjs"]);
}
const available = createServer();
await new Promise((resolve) => available.listen(0, "127.0.0.1", resolve));
const port = available.address().port;
await new Promise((resolve) => available.close(resolve));
const server = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(port),
  ],
  { env, stdio: "ignore" },
);
const base = `http://127.0.0.1:${port}`;
try {
  const deadline = Date.now() + 20000;
  while (true) {
    if (server.exitCode !== null)
      throw new Error("Production server exited before smoke check");
    try {
      const response = await fetch(base, { signal: AbortSignal.timeout(1500) });
      if (response.ok) break;
    } catch {
      /* Wait for startup only. */
    }
    if (Date.now() > deadline)
      throw new Error("Production server startup timed out");
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  run(["scripts/release-smoke.mjs"], { ...env, TEST_URL: base });
  console.log(
    smokeOnly
      ? "Production smoke passed against the existing build: 1366px desktop / 390px mobile. No live bandwidth or TURN tests."
      : "Final release check passed: unit tests, lint, typecheck, one production build/security scan, and one 1366px desktop / 390px mobile smoke run. No live bandwidth or TURN tests.",
  );
} finally {
  if (server.exitCode === null) {
    const exited = new Promise((resolve) => server.once("exit", resolve));
    server.kill();
    await exited;
  }
}
