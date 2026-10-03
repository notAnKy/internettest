import { spawnSync } from "node:child_process";

// Deterministic tests only: no bandwidth tests, live TURN requests or browsers.
for (const script of [
  "animation-check.mjs",
  "quality-check.mjs",
  "fortnite-check.mjs",
  "packet-loss-check.mjs",
]) {
  const result = spawnSync(process.execPath, [`scripts/${script}`], {
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
