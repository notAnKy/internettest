import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { installProfile, summarizeCpu } from "./profile-support.mjs";

// Success measurements are never mocked. --live uses Cloudflare traffic.
const live = process.argv.includes("--live");
const browser = await chromium.launch({
  headless: true,
  channel:
    process.env.BROWSER_CHANNEL ||
    (process.platform === "win32" ? "msedge" : undefined),
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
});
const page = await context.newPage();
// Playwright's default assertion polling also uses RAF. Keep those harness
// frames out of the app's animation profile, especially for reduced motion.
const waitForFunction = page.waitForFunction.bind(page);
page.waitForFunction = (predicate, arg, options = {}) =>
  waitForFunction(predicate, arg, { polling: 50, ...options });
await installProfile(page);
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
const requests = [];
page.on("request", (request) => {
  if (new URL(request.url()).hostname === "speed.cloudflare.com")
    requests.push({
      url: request.url(),
      method: request.method(),
      time: Date.now(),
    });
});
const baseUrl = process.env.TEST_URL || "http://localhost:3000";
const outputDir = "artifacts/polish";
await mkdir(outputDir, { recursive: true });
const start = () => page.getByRole("button", { name: "Start", exact: true });
const again = () =>
  page.getByRole("button", { name: "Test again", exact: true });
const cancel = () =>
  page.getByRole("button", { name: "Cancel test", exact: true });
async function stage(value) {
  await page
    .locator(`.test-space[data-stage="${value}"]`)
    .waitFor({ timeout: 125_000 });
}
async function quiet() {
  await page.waitForTimeout(300);
  const count = requests.length;
  const frames = await page.evaluate(() => globalThis.testProfile.rafExecuted);
  await page.waitForTimeout(500);
  assert.equal(requests.length, count, "Requests stop after cancel");
  assert.equal(
    await page.evaluate(() => globalThis.testProfile.rafPending),
    0,
    "No pending RAF after cancel",
  );
  assert.equal(
    await page.evaluate(() => globalThis.testProfile.rafExecuted),
    frames,
    "No animation frames after cancel",
  );
}
async function captures(name, variant = "both") {
  for (const size of variant === "both" ? ["desktop", "mobile"] : [variant]) {
    await page.setViewportSize(
      size === "desktop"
        ? { width: 1440, height: 900 }
        : { width: 390, height: 844 },
    );
    if (["latency", "download", "upload"].includes(name)) {
      await page.waitForFunction(() => {
        const node = document.querySelector("[data-animated-value]");
        return node?.dataset.target && node.textContent !== "—";
      });
      assert.equal(
        await page.locator(".test-space").getAttribute("data-stage"),
        name,
      );
    }
    await page.screenshot({
      path: `${outputDir}/${name}-${size}.png`,
      fullPage: true,
      animations: "disabled",
    });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
}
try {
  await page.goto(baseUrl);
  await start().waitFor();
  assert.equal(requests.length, 0, "No pre-start measurement requests");
  assert.equal(
    await page
      .locator(
        ".live-number, .result-summary, .speed-trace, .metrics-grid, .test-steps",
      )
      .count(),
    0,
    "Idle has no dashboard or graph",
  );
  assert.equal(
    await page.locator(".connection-content").count(),
    0,
    "Technical content is collapsed and unmounted",
  );
  await captures("idle");
  const responsive = [];
  for (const width of [320, 375, 390, 430, 768, 1024, 1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 844 });
    const dimensions = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      viewport: innerWidth,
      height: document.documentElement.scrollHeight,
    }));
    assert.ok(dimensions.scroll <= width, `No overflow at ${width}px`);
    responsive.push({ width, ...dimensions });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.keyboard.press("Tab");
  assert.equal(await page.locator(":focus").innerText(), "Skip to speed test");
  await page.keyboard.press("Tab");
  assert.equal(
    await page.locator(":focus").getAttribute("aria-label"),
    "InternetTest home",
  );
  await page.keyboard.press("Tab");
  assert.match(await page.locator(":focus").innerText(), /Start/);
  assert.notEqual(
    await page
      .locator(":focus")
      .evaluate((el) => getComputedStyle(el).outlineStyle),
    "none",
  );
  await start().click();
  await cancel().click();
  await stage("cancelled");
  await quiet();
  await context.setOffline(true);
  await page.waitForFunction(
    () => document.querySelector(".again-button")?.disabled,
  );
  await context.setOffline(false);
  await page.waitForFunction(
    () => !document.querySelector(".again-button")?.disabled,
  );
  await again().click();
  await cancel().waitFor();
  await context.setOffline(true);
  await stage("error");
  assert.match(await page.locator(".test-error").innerText(), /offline/);
  await context.setOffline(false);
  await page.waitForFunction(
    () => !document.querySelector(".again-button")?.disabled,
  );
  await page.route("https://speed.cloudflare.com/**", (route) =>
    route.abort("blockedbyclient"),
  );
  await again().click();
  await stage("error");
  assert.match(await page.locator(".test-error").innerText(), /Couldn’t reach/);
  await page.getByText("Connection info", { exact: true }).click();
  await page.getByText("Measured samples", { exact: true }).click();
  await page.locator(".sample-tables summary").first().click();
  assert.ok(
    (await page.getByText("Unavailable", { exact: true }).count()) > 0,
    "Missing samples render safely",
  );
  await page.getByText("Connection info", { exact: true }).click();
  await page.unroute("https://speed.cloudflare.com/**");
  assert.deepEqual(
    errors.splice(0).filter((error) => !error.includes("net::ERR_")),
    [],
    "No unexpected JavaScript/hydration errors",
  );
  await page.evaluate(() => {
    globalThis.originalGetEntries = performance.getEntriesByName;
    performance.getEntriesByName = undefined;
  });
  await again().click();
  await stage("error");
  assert.match(await page.locator(".test-error").innerText(), /timing APIs/);
  await page.evaluate(() => {
    performance.getEntriesByName = globalThis.originalGetEntries;
    delete globalThis.originalGetEntries;
  });

  let result = null,
    profile = null,
    metrics = null,
    cpu = null,
    reduced = null;
  if (live) {
    const session = await context.newCDPSession(page);
    await session.send("Performance.enable");
    await session.send("Profiler.enable");
    await session.send("Profiler.start");
    const before = await session.send("Performance.getMetrics");
    await page.evaluate(() => {
      globalThis.testProfile.recording = true;
    });
    const liveStart = requests.length;
    await again().click();
    for (const name of ["latency", "download", "upload"]) {
      await stage(name);
      await captures(name, name === "latency" ? "desktop" : "both");
      if (name === "download") {
        const beforeNumber = await page.locator(".number-slot").boundingBox();
        const previousTarget = await page
          .locator("[data-animated-value]")
          .getAttribute("data-target");
        await page.waitForFunction(
          (target) =>
            document.querySelector("[data-animated-value]")?.dataset.target !==
            target,
          previousTarget,
        );
        const afterNumber = await page.locator(".number-slot").boundingBox();
        assert.equal(
          afterNumber.width,
          beforeNumber.width,
          "Changing real readings retain the same number width",
        );
        assert.equal(
          afterNumber.x,
          beforeNumber.x,
          "Changing readings retain the same centered slot",
        );
      }
    }
    await page.waitForFunction(
      () =>
        ["complete", "error"].includes(
          document.querySelector(".test-space")?.dataset.stage,
        ),
      null,
      { timeout: 125_000 },
    );
    await stage("complete");
    const after = await session.send("Performance.getMetrics");
    const { profile: cpuProfile } = await session.send("Profiler.stop");
    profile = await page.evaluate(() => {
      globalThis.testProfile.recording = false;
      return globalThis.testProfile;
    });
    metrics = Object.fromEntries(
      after.metrics.map((m) => [
        m.name,
        +(
          m.value - (before.metrics.find((b) => b.name === m.name)?.value ?? 0)
        ).toFixed(4),
      ]),
    );
    cpu = summarizeCpu(cpuProfile);
    assert.equal(
      profile.rafPending,
      0,
      "All number animation frames stop on completion",
    );
    assert.ok(
      profile.rafExecuted > 50,
      "Browser-refresh-rate frames run between genuine samples",
    );
    assert.ok(
      profile.commits < profile.rafExecuted,
      "RAF does not commit the React tree every frame",
    );
    const throughput = profile.numericUpdates.filter(
      (p) => p.stage === "Measuring download" || p.stage === "Measuring upload",
    );
    const genuine = profile.targets.filter(
      (p) => p.stage === "Measuring download" || p.stage === "Measuring upload",
    );
    assert.ok(
      throughput.length > genuine.length * 2,
      "Intermediate display values between actual samples",
    );
    let currentStage = "",
      currentTarget = null,
      previousDisplay = null,
      from = null;
    for (const sample of throughput) {
      if (currentStage !== sample.stage) {
        currentStage = sample.stage;
        currentTarget = null;
        previousDisplay = null;
        from = null;
      }
      const target = Number(sample.target),
        displayed = Number(sample.value.replaceAll(",", ""));
      if (!Number.isFinite(displayed)) continue;
      if (target !== currentTarget) {
        from = previousDisplay ?? target;
        currentTarget = target;
      }
      if (from !== null)
        assert.ok(
          displayed >= Math.min(from, target) - 0.11 &&
            displayed <= Math.max(from, target) + 0.11,
          "Display stays between real targets without peaks",
        );
      previousDisplay = displayed;
    }
    await page.waitForFunction(
      () => localStorage.getItem("internettest:latest:v1") !== null,
    );
    result = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("internettest:latest:v1")),
    );
    for (const field of [
      "latencyMs",
      "jitterMs",
      "downloadMbps",
      "uploadMbps",
      "downloadLoadedLatencyMs",
      "uploadLoadedLatencyMs",
    ]) {
      const expected =
        result[field] === null
          ? "Unavailable"
          : new Intl.NumberFormat("en-US", {
              minimumFractionDigits: 1,
              maximumFractionDigits: 1,
            }).format(result[field]);
      assert.equal(
        (await page.locator(`[data-result="${field}"]`).innerText())
          .replace(/\s+ms$/, "")
          .trim(),
        expected,
        `${field} final display exactly matches the true stored result`,
      );
    }
    assert.ok(
      result.latencyMs !== null &&
        result.jitterMs !== null &&
        result.downloadMbps > 0 &&
        result.uploadMbps > 0,
      "All core measurements are real",
    );
    assert.ok(
      requests
        .slice(liveStart)
        .some((r) => r.method === "POST" && r.url.includes("/__up")),
    );
    assert.ok(
      requests
        .slice(liveStart)
        .every((r) => ["/__down", "/__up"].includes(new URL(r.url).pathname)),
      "No telemetry or TURN requests",
    );
    await writeFile(
      `${outputDir}/live-profile.json`,
      JSON.stringify({ profile, metrics, cpu, result }, null, 2),
    );
    await captures("complete");
    for (const width of [320, 375, 390, 430, 768, 1024, 1280, 1440, 1920]) {
      await page.setViewportSize({ width, height: 844 });
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `Results fit ${width}px`,
      );
    }
    await page.getByText("Connection info", { exact: true }).click();
    await page.getByText("Measured samples", { exact: true }).click();
    assert.equal(
      await page.locator(".sample-tables summary").count(),
      3,
      "All three sample tables preserved",
    );
    await page.getByText("Connection info", { exact: true }).click();

    // Start a real reduced-motion transfer, inspect its immediate readout,
    // and cancel under load. No fake measurements or success responses.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => {
      const p = globalThis.testProfile;
      p.numericUpdates = [];
      p.targets = [];
      p.rafScheduled = 0;
      p.rafExecuted = 0;
      p.recording = true;
    });
    await again().click();
    await stage("latency");
    await captures("latency", "mobile");
    await stage("download");
    await page.waitForFunction(
      () =>
        globalThis.testProfile.targets.filter(
          (p) => p.stage === "Measuring download",
        ).length >= 3,
      null,
      { timeout: 120_000 },
    );
    reduced = await page.evaluate(() => {
      const node = document.querySelector("[data-animated-value]");
      const p = globalThis.testProfile;
      return {
        targets: p.targets,
        values: p.numericUpdates,
        frames: p.rafExecuted,
        display: node.textContent,
        target: Number(node.dataset.target),
        animation: getComputedStyle(document.querySelector(".live-measurement"))
          .animationName,
        width: node.getBoundingClientRect().width,
      };
    });
    assert.equal(
      reduced.frames,
      0,
      "Reduced motion creates no animation frames",
    );
    assert.equal(reduced.animation, "none");
    assert.equal(
      reduced.display,
      new Intl.NumberFormat("en-US", {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      }).format(reduced.target),
    );
    await cancel().click();
    await stage("cancelled");
    await quiet();
    assert.deepEqual(
      await page.evaluate(() =>
        JSON.parse(localStorage.getItem("internettest:latest:v1")),
      ),
      result,
      "Cancel preserves the last real completed result",
    );
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await again().click();
    await stage("download");
    await page.waitForFunction(
      () => globalThis.testProfile.rafPending > 0,
      null,
      { timeout: 120_000 },
    );
    await cancel().click();
    await stage("cancelled");
    assert.equal(
      await page.locator("[data-animated-value]").count(),
      0,
      "Cancel unmounts the animated component",
    );
    await quiet();
    // Exercise the browser page-exit lifecycle while a real reading animates.
    // Cancel above already verifies React component unmount cleanup. Native
    // history.pushState in App Router updates the URL without route navigation.
    await again().click();
    await stage("download");
    await page.waitForFunction(
      () => globalThis.testProfile.rafPending > 0,
      null,
      { timeout: 120_000 },
    );
    await page.evaluate(() => {
      dispatchEvent(new PageTransitionEvent("pagehide"));
    });
    await stage("cancelled");
    await page.waitForFunction(
      () => !document.querySelector("[data-animated-value]"),
    );
    await quiet();
  }
  assert.deepEqual(
    errors,
    [],
    "No unexpected console, runtime, or hydration errors",
  );
  const report = {
    passed: true,
    live,
    responsive,
    result,
    profile,
    metrics,
    cpu,
    reduced,
    measurementRequests: requests.length,
    checked: [
      "minimal idle",
      "keyboard focus",
      "320–1920px layout",
      "cancel/restart",
      "offline",
      "blocked requests",
      "unsupported timing",
      "unavailable samples",
      ...(live
        ? [
            "real Cloudflare metrics",
            "exact final values",
            "RAF interpolation",
            "bounded display",
            "isolated React updates",
            "reduced motion",
            "cancel during active RAF",
            "unmount cleanup",
            "real sample tables",
          ]
        : []),
    ],
  };
  await writeFile(`${outputDir}/report.json`, JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify(
      {
        ...report,
        profile: profile
          ? {
              commits: profile.commits,
              renders: profile.renders,
              realTargets: profile.targets.length,
              displayUpdates: profile.numericUpdates.length,
              frames: profile.rafExecuted,
              longTasks: profile.longTasks,
            }
          : null,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
