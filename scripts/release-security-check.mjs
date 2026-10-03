import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { access } from "node:fs/promises";

// Print paths/categories only. Never print matched strings or file contents.
const git = (...args) =>
  execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
const published = git(
  "ls-files",
  "--cached",
  "--others",
  "--exclude-standard",
  "-z",
)
  .split("\0")
  .filter(Boolean);
for (const forbidden of [
  ".env.local",
  ".next/example",
  "node_modules/example",
  "artifacts/example.json",
  "test-results/example",
  "profiles/example.cpuprofile",
])
  assert.ok(
    git("check-ignore", forbidden).trim(),
    "Private/generated files are ignored",
  );
assert.ok(
  !published.some((file) =>
    /(^|\/)(?:\.env(?!\.example$)[^/]*|artifacts|node_modules|\.next|\.pnpm-store|\.vercel|test-results)(?:\/|$)/.test(
      file,
    ),
  ),
  "No private/generated files are publishable",
);
assert.ok(published.includes(".env.example"));
const example = await readFile(".env.example", "utf8");
assert.deepEqual(
  example.split(/\r?\n/).filter((line) => line && !line.startsWith("#")),
  [
    "METERED_APP_NAME=your_app_name",
    "METERED_TURN_API_KEY=your_credential_api_key",
  ],
);

const secrets = new Set();
for (const entry of await readdir(".", { withFileTypes: true })) {
  if (
    !entry.isFile() ||
    !/^\.env(?:\.|$)/.test(entry.name) ||
    entry.name === ".env.example"
  )
    continue;
  const content = await readFile(entry.name, "utf8");
  for (const match of content.matchAll(
    /^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.+)$/gm,
  )) {
    if (
      !/(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|TURN_USERNAME)/.test(match[1])
    )
      continue;
    const raw = match[2].trim();
    const value = /^(?:".*"|'.*')$/.test(raw)
      ? raw.slice(1, -1)
      : raw.split(/\s+#/)[0].trim();
    if (
      value.length >= 8 &&
      !/^(?:your_|test-only-|internettest-build-only-)/.test(value)
    )
      secrets.add(value);
  }
}
async function files(directory) {
  try {
    return (
      await Promise.all(
        (await readdir(directory, { withFileTypes: true })).map((entry) => {
          const file = path.join(directory, entry.name);
          return entry.isDirectory() ? files(file) : [file];
        }),
      )
    ).flat();
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}
const buildFiles = [
  ...(await files(".next/static")),
  ...(await files(".next/server")),
  ...(await files(".next/dev/static")),
  ...(await files(".next/dev/logs")),
];
for (const file of [".next/trace", ".next/dev/trace", ".next/trace-build"]) {
  try {
    await access(file);
    buildFiles.push(file);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
const scan = [
  ...new Set([...published, ...(await files("artifacts")), ...buildFiles]),
].filter(
  (file) =>
    /\.(?:tsx?|m?js|cjs|json|md|txt|ya?ml|html|map|svg|css|log|cpuprofile)$/.test(
      file,
    ) || /(?:LICENSE|NOTICE|trace|trace-build)$/.test(file),
);
const findings = [];
const unsafePattern =
  /(?:AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,})/;
let syntheticFiles = 0;
for (const file of scan) {
  const source = await readFile(file, "utf8");
  if ([...secrets].some((value) => source.includes(value)))
    findings.push({ file, category: "local credential copy" });
  if (unsafePattern.test(source))
    findings.push({ file, category: "credential-like pattern" });
  if (published.includes(file)) {
    let reviewedSynthetic = false;
    for (const match of source.matchAll(
      /(?:username|credential|password|apiKey|secretKey|accessToken|token)["']?\s*[:=]\s*["']([^"'\r\n]+)["']/g,
    )) {
      if (
        /^(?:test-only-|synthetic-|your_|should-not-be-returned|internettest-build-only-)/.test(
          match[1],
        ) &&
        file.replaceAll("\\", "/").startsWith("scripts/")
      )
        reviewedSynthetic = true;
      else findings.push({ file, category: "unreviewed credential literal" });
    }
    if (reviewedSynthetic) syntheticFiles++;
  }
}
// Scan existing Git objects too if the project later gains commits.
const history = git("rev-list", "--all", "--objects").trim();
let historyBlobs = 0;
if (history)
  for (const line of history.split("\n")) {
    const hash = line.split(" ")[0];
    if (git("cat-file", "-t", hash).trim() !== "blob") continue;
    historyBlobs++;
    const source = git("cat-file", "-p", hash);
    if (
      [...secrets].some((value) => source.includes(value)) ||
      unsafePattern.test(source)
    )
      findings.push({
        file: `Git blob ${hash}`,
        category: "historical credential match",
      });
  }
if (findings.length) {
  console.error(JSON.stringify(findings));
  process.exit(1);
}
console.log(
  `Security audit passed: ${published.length} publishable files, ${scan.length} source/artifact/build files, ${historyBlobs} historical blobs; no secret matches. ${syntheticFiles} test files contain explicit synthetic credentials only. Local env and generated files are ignored.`,
);
