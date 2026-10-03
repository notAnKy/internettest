import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { chromium } from "playwright";

// A saved prior real result, used only by this layout harness. Inject it through
// React's existing test-page state; no test entry point or fixture ships in app code.
const raw = JSON.parse(
  await readFile(
    new URL("./fixtures/layout-result.json", import.meta.url),
    "utf8",
  ),
);
const browser = await chromium.launch({
  headless: true,
  channel:
    process.env.BROWSER_CHANNEL ||
    (process.platform === "win32" ? "msedge" : undefined),
});
const page = await browser.newPage();
const errors = [];
let measurementRequests = 0;
let gameRequests = 0;
page.on("pageerror", (error) => errors.push(error.message));
page.on("request", (request) => {
  if (new URL(request.url()).hostname === "speed.cloudflare.com")
    measurementRequests++;
  if (new URL(request.url()).hostname.endsWith(".ds.on.epicgames.com"))
    gameRequests++;
});
await mkdir("artifacts/layout", { recursive: true });
try {
  await page.goto(process.env.TEST_URL || "http://localhost:3000");
  await page.getByRole("button", { name: "Start", exact: true }).waitFor();
  await page.waitForFunction(
    () =>
      Object.keys(document.querySelector(".test-space") ?? {}).some((key) =>
        key.startsWith("__reactFiber$"),
      ),
    null,
    { polling: 50 },
  );
  await page.evaluate((result) => {
    const node = document.querySelector(".test-space");
    let fiber =
      node[Object.keys(node).find((key) => key.startsWith("__reactFiber$"))];
    let engine = null;
    while (fiber && !engine) {
      let hook = fiber.memoizedState;
      while (hook) {
        const candidate = hook.memoizedState;
        if (
          candidate?.getSnapshot &&
          candidate?.subscribe &&
          candidate?.update
        ) {
          engine = candidate;
          break;
        }
        hook = hook.next;
      }
      fiber = fiber.return;
    }
    if (!engine)
      throw new Error(
        "Layout harness could not locate the existing engine state",
      );
    window.layoutEngine = engine;
    engine.update({ stage: "complete", metrics: result, result });
  }, raw);
  await page.locator(".has-result").waitFor();
  await page.locator(".result-summary").evaluate(async (node) => {
    await Promise.all(
      node.getAnimations().map((animation) => animation.finished),
    );
  });
  const sizes = [
    ["desktop", 1440, 900],
    ["laptop", 1366, 768],
    ["mobile", 390, 844],
  ];
  for (const [name, width, height] of sizes) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => scrollTo(0, 0));
    const left = await page.locator(".primary-flow").boundingBox();
    const right = await page.locator(".quality-section").boundingBox();
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      `${name}: no horizontal overflow`,
    );
    if (width >= 1100) {
      assert.ok(right.x >= left.x + left.width, `${name}: two columns`);
      assert.ok(
        left.y + left.height <= height && right.y + right.height <= height,
        `${name}: both results fit in the viewport`,
      );
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollHeight <= innerHeight + 1,
        ),
        `${name}: no required vertical scroll`,
      );
    } else {
      assert.ok(
        right.y >= left.y + left.height,
        "Mobile stacks primary results before quality",
      );
    }
    const number = await page
      .locator("[data-result='downloadMbps']")
      .boundingBox();
    for (const key of ["gaming", "bufferbloat"]) {
      await page.locator(`[data-quality='${key}'] button`).click();
      assert.equal(
        await page.locator(".quality-details").count(),
        1,
        "Only one row expands",
      );
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `${name}: expanded content fits`,
      );
      if (width >= 1100) {
        // Compare layout after returning from any accordion auto-scroll.
        await page.evaluate(() => scrollTo(0, 0));
        const after = await page
          .locator("[data-result='downloadMbps']")
          .boundingBox();
        assert.equal(
          after.y,
          number.y,
          "Expanding quality does not move the primary speed",
        );
        assert.equal(after.x, number.x, "Primary speed remains aligned");
      }
    }
    await page.locator("[data-quality='bufferbloat'] button").click();
    await page.evaluate(() => {
      document.activeElement?.blur();
      scrollTo(0, 0);
    });
    // Three representative captures; no screenshot matrix or network run.
    await page.screenshot({
      path: `artifacts/layout/${name}.png`,
      fullPage: true,
      animations: "disabled",
    });
  }
  const rerunStage = await page.evaluate(() => {
    document.querySelector(".again-button").click();
    const stage = window.layoutEngine.getSnapshot().stage;
    // Cancel synchronously before the dynamic provider import can send data.
    window.layoutEngine.cancel();
    return stage;
  });
  assert.equal(rerunStage, "preparing", "Test again starts a new run");
  await page.locator(".test-space[data-stage='cancelled']").waitFor();
  assert.equal(
    await page.locator(".quality-section").count(),
    0,
    "Previous analysis clears on rerun",
  );
  assert.equal(
    measurementRequests,
    0,
    "Layout checks consume no speed-test traffic",
  );
  assert.equal(gameRequests, 0, "No Fortnite request survives unmount/rerun");
  assert.deepEqual(errors, [], "No runtime errors");
  console.log(
    "Layout passed: 1440×900, 1366×768, 390×844; expansion, stable primary numbers, overflow, and Test again. No Cloudflare traffic.",
  );
} finally {
  await browser.close();
}
