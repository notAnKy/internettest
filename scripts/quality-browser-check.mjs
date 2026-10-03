import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { qualityModule } from "./quality-module.mjs";

const { analyzeConnection } = await import(await qualityModule());
const output = "artifacts/quality";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  channel:
    process.env.BROWSER_CHANNEL ||
    (process.platform === "win32" ? "msedge" : undefined),
});
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
});
const page = await context.newPage();
const errors = [],
  requests = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
page.on("request", (request) => {
  const url = new URL(request.url());
  if (url.hostname === "speed.cloudflare.com")
    requests.push({ path: url.pathname, method: request.method() });
});
const labels = {
  excellent: "Excellent",
  good: "Good",
  fair: "Fair",
  poor: "Poor",
  unavailable: "Unavailable",
};
const format = (value) =>
  value === null
    ? "Unavailable"
    : new Intl.NumberFormat("en-US", {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      }).format(value);
try {
  await page.goto(process.env.TEST_URL || "http://localhost:3000");
  await page.getByRole("button", { name: "Start", exact: true }).waitFor();
  assert.equal(requests.length, 0, "No pre-start traffic");
  assert.equal(
    await page.locator(".quality-section").count(),
    0,
    "No quality rows before a completed result",
  );
  await page.getByRole("button", { name: "Start", exact: true }).click();
  console.log("Running one real Cloudflare test…");
  await page.waitForFunction(
    () =>
      ["complete", "error"].includes(
        document.querySelector(".test-space")?.dataset.stage,
      ),
    null,
    { timeout: 125_000, polling: 100 },
  );
  assert.equal(
    await page.locator(".test-space").getAttribute("data-stage"),
    "complete",
    "Real test completes",
  );
  await page.waitForFunction(
    () => localStorage.getItem("internettest:latest:v1"),
    null,
    { polling: 100 },
  );
  const raw = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("internettest:latest:v1")),
  );
  const report = analyzeConnection(raw);
  assert.ok(
    raw.downloadMbps > 0 &&
      raw.uploadMbps > 0 &&
      raw.latencyMs !== null &&
      raw.jitterMs !== null,
    "Genuine completed measurements",
  );
  assert.equal(Object.keys(raw).length, 8, "Storage remains raw-only");
  for (const key of [
    "downloadMbps",
    "uploadMbps",
    "latencyMs",
    "jitterMs",
    "downloadLoadedLatencyMs",
    "uploadLoadedLatencyMs",
  ]) {
    assert.equal(
      (await page.locator(`[data-result="${key}"]`).innerText())
        .replace(/\s+ms$/, "")
        .trim(),
      format(raw[key]),
      `${key}: unchanged final reading`,
    );
  }
  assert.equal(await page.locator(".quality-row").count(), 6);
  assert.equal(
    await page.locator(".quality-details").count(),
    0,
    "Details are collapsed and unmounted",
  );
  for (const key of [
    "overall",
    "gaming",
    "streaming",
    "browsing",
    "videoCalls",
    "bufferbloat",
  ]) {
    const row = page.locator(`[data-quality="${key}"]`);
    assert.equal(
      await row.getAttribute("data-grade"),
      report[key].grade,
      `${key}: derives from this actual result`,
    );
    assert.equal(
      await row.locator(".quality-grade").innerText(),
      labels[report[key].grade],
    );
  }
  const sizes = [];
  for (const [name, width, height] of [
    ["desktop", 1280, 900],
    ["mobile", 390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => scrollTo(0, 0));
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      `${name}: no horizontal overflow`,
    );
    const qualityBox = await page.locator(".quality-section").boundingBox();
    const primaryBox = await page.locator(".primary-flow").boundingBox();
    if (width >= 1100) {
      assert.ok(
        qualityBox.x >= primaryBox.x + primaryBox.width,
        `${name}: analysis is beside the primary result`,
      );
      assert.ok(
        qualityBox.y + qualityBox.height <= height,
        `${name}: quality fits the first viewport`,
      );
    } else {
      assert.ok(
        qualityBox.y >= primaryBox.y + primaryBox.height,
        `${name}: analysis follows the primary result`,
      );
    }
    const speedBox = await page.locator(".result-speeds").boundingBox();
    assert.ok(
      speedBox.y + speedBox.height < height,
      `${name}: primary speeds remain visible`,
    );
    await page.screenshot({
      path: `${output}/${name}.png`,
      fullPage: true,
      animations: "disabled",
    });
    for (const key of [
      "overall",
      "gaming",
      "streaming",
      "browsing",
      "videoCalls",
      "bufferbloat",
    ]) {
      const row = page.locator(`[data-quality="${key}"]`);
      const button = row.locator("button");
      assert.ok(
        (await button.boundingBox()).height >= 44,
        "Accessible touch target",
      );
      await button.click();
      assert.equal(
        await page.locator(".quality-details").count(),
        1,
        "Only one expanded category",
      );
      assert.equal(await button.getAttribute("aria-expanded"), "true");
      for (const metric of report[key].metrics) {
        const node = row.locator(`[data-quality-metric="${metric.key}"]`);
        assert.equal(
          Number(await node.getAttribute("data-value")),
          metric.value,
          `${name}/${key}: exact actual metric or measured delta`,
        );
        const signed = metric.signed && metric.value >= 0 ? "+" : "";
        assert.equal(
          (await node.innerText()).trim(),
          `${signed}${format(metric.value)} ${metric.unit}`,
        );
      }
      assert.ok(
        (await row.locator(".quality-details").innerText()).includes(
          report[key].summary,
        ),
      );
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `${name}: expanded details fit`,
      );
    }
    await page.locator("[data-quality='gaming'] button").click();
    await page.locator(".quality-section").screenshot({
      path: `${output}/${name}-expanded.png`,
      animations: "disabled",
    });
    await page.locator("[data-quality='gaming'] button").focus();
    await page.keyboard.press("Enter");
    assert.equal(
      await page.locator(".quality-details").count(),
      0,
      "Keyboard collapses the category",
    );
    sizes.push({ name, width, height });
  }
  assert.deepEqual(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("internettest:latest:v1")),
    ),
    raw,
    "Expanding categories leaves raw storage unchanged",
  );
  assert.ok(
    requests.some(
      (request) => request.path === "/__up" && request.method === "POST",
    ),
  );
  assert.ok(
    requests.every((request) => ["/__down", "/__up"].includes(request.path)),
    "Measurement endpoints only",
  );
  // Verify rerun/cancel with a short partial run, not another full transfer.
  await page.getByRole("button", { name: "Test again", exact: true }).click();
  await page.getByRole("button", { name: "Cancel test", exact: true }).click();
  await page.locator(".test-space[data-stage='cancelled']").waitFor();
  assert.equal(
    await page.locator(".quality-section").count(),
    0,
    "Old analysis is removed on rerun",
  );
  await page.waitForTimeout(300);
  const stopped = requests.length;
  await page.waitForTimeout(500);
  assert.equal(requests.length, stopped, "Cancelled rerun stops requests");
  assert.deepEqual(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("internettest:latest:v1")),
    ),
    raw,
  );
  assert.deepEqual(errors, [], "No console, runtime, or hydration errors");
  const validation = {
    passed: true,
    completedRealTests: 1,
    sizes,
    raw,
    grades: Object.fromEntries(
      Object.entries(report)
        .filter(([key]) => key !== "methodologyVersion")
        .map(([key, category]) => [key, category.grade]),
    ),
    bufferbloat: report.bufferbloat,
    measurementRequests: requests.length,
  };
  await writeFile(
    `${output}/validation.json`,
    JSON.stringify(validation, null, 2),
  );
  console.log(
    JSON.stringify(
      {
        ...validation,
        bufferbloat: {
          downloadIncreaseMs: report.bufferbloat.downloadIncreaseMs,
          uploadIncreaseMs: report.bufferbloat.uploadIncreaseMs,
        },
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
