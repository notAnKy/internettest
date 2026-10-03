import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { qualityModule } from "./quality-module.mjs";

const release = process.argv.includes("--release");
const { packetPresets } = await import(
  await qualityModule(
    new URL("../src/lib/packet-loss/settings.ts", import.meta.url),
  )
);

const browser = await chromium.launch({
  headless: true,
  channel:
    process.env.BROWSER_CHANNEL ||
    (process.platform === "win32" ? "msedge" : undefined),
});
const page = await browser.newPage({
  viewport: { width: release ? 1366 : 1440, height: release ? 768 : 1000 },
});
let configured = false,
  credentialState = "ok",
  posts = 0,
  externalRequests = 0;
const errors = [];
let blockedSpeedRequests = 0;
page.on("pageerror", (error) => errors.push(error.message));
await page.route("**/*", async (route) => {
  const url = new URL(route.request().url());
  if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    if (release && url.hostname === "speed.cloudflare.com") {
      blockedSpeedRequests++;
      return route.abort("blockedbyclient");
    }
    externalRequests++;
    return route.abort();
  }
  if (url.pathname !== "/api/turn-credentials") return route.continue();
  if (route.request().method() === "GET")
    return route.fulfill({ json: { configured } });
  posts++;
  assert.equal(route.request().headers()["content-type"], "application/json");
  assert.equal(Object.keys(route.request().postDataJSON()).length, 5);
  if (credentialState === "timeout")
    return route.fulfill({ status: 408, json: { code: "request-timeout" } });
  return route.fulfill(
    credentialState === "error"
      ? { status: 502, json: { code: "credentials-unavailable" } }
      : {
          json: {
            iceServers: [
              {
                urls: ["turn:standard.relay.metered.ca:80?transport=udp"],
                username: "test-only-user",
                credential: "test-only-password",
              },
            ],
          },
        },
  );
});
await page.addInitScript(() => {
  // Test-only peers. Actual UI, payload pacing, and statistics run unchanged.
  window.packetFake = {
    peers: [],
    channels: [],
    payloads: [],
    mode: "success",
  };
  class Channel {
    readyState = "connecting";
    constructor() {
      window.packetFake.channels.push(this);
    }
    send(data) {
      window.packetFake.payloads.push(data);
      const sequence = Number(data.split("|")[0]);
      if (sequence === 1 || sequence === 3) return;
      setTimeout(
        () => {
          const receiver = window.packetFake.channels.at(-1);
          receiver.onmessage?.({ data });
          receiver.onmessage?.({ data });
        },
        sequence === 2 ? 300 : 25,
      );
    }
    close() {
      this.readyState = "closed";
    }
  }
  class Peer {
    connectionState = "new";
    constructor(config) {
      this.config = config;
      window.packetFake.peers.push(this);
    }
    createDataChannel(_label, config) {
      this.channelConfig = config;
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
    }
    async setRemoteDescription(value) {
      this.remoteDescription = value;
      if (value.type !== "answer" || window.packetFake.mode === "hold") return;
      queueMicrotask(() => {
        if (this.connectionState === "closed") return;
        const peers = window.packetFake.peers.slice(-2);
        peers.forEach((peer) => {
          peer.connectionState = "connected";
        });
        const channel = new Channel();
        peers[1].ondatachannel?.({ channel });
        const channels = window.packetFake.channels.slice(-2);
        channels.forEach((dc) => {
          dc.readyState = "open";
        });
        channels.forEach((dc) => dc.onopen?.());
      });
    }
    async addIceCandidate() {}
    async getStats() {
      return new Map([
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
          {
            candidateType: "relay",
            protocol: "udp",
            relayProtocol: window.packetFake.mode === "tcp" ? "tcp" : "udp",
          },
        ],
        ["remote", { candidateType: "relay", protocol: "udp" }],
      ]);
    }
    close() {
      this.connectionState = "closed";
    }
  }
  window.RTCPeerConnection = Peer;
  window.packetPeer = Peer;
});
const clean = () =>
  page.evaluate(
    () =>
      window.packetFake.peers.every((pc) => pc.connectionState === "closed") &&
      window.packetFake.channels.every((dc) => dc.readyState === "closed"),
  );
const slider = async (label, steps) => {
  const input = page.getByRole("slider", { name: label, exact: true });
  await input.focus();
  await input.press("Home");
  for (let n = 0; n < steps; n++) await input.press("ArrowRight");
};
const capture = async (name) => {
  if (release) return;
  await mkdir("artifacts/packet-loss", { recursive: true });
  await page.screenshot({
    path: `artifacts/packet-loss/${name}.png`,
    fullPage: true,
    animations: "disabled",
  });
};
try {
  const base = process.env.TEST_URL || "http://localhost:3000";
  await page.goto(base);
  await page.getByRole("button", { name: "Start", exact: true }).waitFor();
  await page
    .getByRole("navigation", { name: "Tests" })
    .getByRole("link", { name: "Packet loss" })
    .click();
  await page.waitForURL("**/packet-loss");
  await page.reload(); // A direct server route must survive refresh.
  await page.getByRole("heading", { name: "Test settings" }).waitFor();
  await page.getByText("Setup required", { exact: true }).waitFor();
  const start = page.getByRole("button", {
    name: "Start packet loss test",
    exact: true,
  });
  assert.ok(await start.isDisabled());
  assert.equal(posts, 0);
  configured = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.getByText("Ready to test", { exact: true }).waitFor();
  assert.ok(await start.isEnabled());
  assert.equal(
    posts,
    0,
    "Navigation and setup check never start a measurement",
  );
  assert.equal(
    await page
      .getByRole("navigation", { name: "Tests" })
      .getByRole("link", { name: "Packet loss", exact: true })
      .getAttribute("aria-current"),
    "page",
  );
  assert.ok(
    await page.getByRole("button", { name: "History Soon" }).isDisabled(),
  );
  for (const [key, { settings }] of Object.entries(packetPresets)) {
    await page.getByLabel("Preset", { exact: true }).selectOption(key);
    for (const [label, field] of [
      ["Packet size", "packetSize"],
      ["Frequency", "frequency"],
      ["Duration", "duration"],
      ["Acceptable delay", "acceptableDelay"],
    ])
      assert.equal(
        Number(
          await page
            .getByRole("slider", { name: label, exact: true })
            .inputValue(),
        ),
        settings[field],
      );
    assert.equal(await page.getByRole("checkbox").isChecked(), settings.warmup);
  }
  await page.getByLabel("Preset", { exact: true }).selectOption("gaming");
  assert.equal(
    await page
      .getByRole("slider", { name: "Frequency", exact: true })
      .inputValue(),
    "60",
  );
  assert.ok(await page.getByRole("checkbox").isChecked());
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  assert.equal(
    await page.getByLabel("Preset", { exact: true }).inputValue(),
    "default",
  );
  assert.equal(
    await page
      .getByRole("slider", { name: "Frequency", exact: true })
      .inputValue(),
    "15",
  );
  await capture("page-desktop-idle");
  const help = page.locator('summary[aria-label="About frequency"]');
  await help.focus();
  await help.press("Enter");
  assert.ok(await page.locator(".packet-help[open] > span").isVisible());
  await help.press("Enter");
  for (const label of ["Packet size", "Frequency", "Duration"])
    await page.getByRole("slider", { name: label, exact: true }).press("End");
  await page.getByRole("checkbox").check();
  assert.ok(await start.isDisabled());
  await page.getByText(/Reduce size, frequency or duration/).waitFor();
  assert.equal(posts, 0, "Excessive settings cannot start a test");
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await slider("Packet size", 0);
  await slider("Frequency", 4);
  await slider("Duration", 0);
  await page.getByRole("checkbox").check();
  assert.equal(
    await page.getByLabel("Preset", { exact: true }).inputValue(),
    "custom",
  );
  await start.click();
  await page
    .getByRole("button", { name: "Cancel test", exact: true })
    .waitFor();
  assert.ok(
    await page
      .getByRole("slider", { name: "Frequency", exact: true })
      .isDisabled(),
  );
  assert.equal(
    await page.locator(".packet-progress").getAttribute("aria-live"),
    "off",
  );
  await page
    .locator('[data-packet-state="complete"]')
    .waitFor({ timeout: 22000 });
  assert.equal(
    await page.locator('[data-result="loss"]').textContent(),
    "8.0%",
  );
  assert.deepEqual(
    await page.locator(".packet-counters dd").allTextContents(),
    ["25", "23", "2", "1"],
  );
  assert.ok(
    await page
      .getByRole("img", { name: /Message delivery delay chart/ })
      .isVisible(),
  );
  assert.equal(posts, 1);
  const payloads = await page.evaluate(() => window.packetFake.payloads);
  assert.equal(payloads.filter((data) => data.startsWith("w")).length, 10);
  assert.equal(payloads.filter((data) => !data.startsWith("w")).length, 25);
  assert.ok(payloads.every((data) => data.length === 64));
  assert.ok(await clean());
  await capture("page-desktop-result");
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "JSON", exact: true }).click();
  const file = await downloaded;
  assert.match(
    file.suggestedFilename(),
    /^internettest-packet-loss-\d{4}-\d{2}-\d{2}\.json$/,
  );
  let text = "";
  for await (const chunk of await file.createReadStream()) text += chunk;
  const exported = JSON.parse(text);
  assert.equal(exported.sentPackets, 25);
  assert.equal(exported.delivery.settings.packetSize, 64);
  assert.equal(exported.delivery.latePackets, 1);
  assert.ok(
    !/username|credential|iceServers|apiKey|test-only-password|test-only-user/.test(
      text,
    ),
  );
  const csvDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "CSV", exact: true }).click();
  const csv = await csvDownload;
  assert.match(
    csv.suggestedFilename(),
    /^internettest-packet-loss-\d{4}-\d{2}-\d{2}\.csv$/,
  );
  let csvText = "";
  for await (const chunk of await csv.createReadStream()) csvText += chunk;
  assert.equal(csvText.split("\n").length, 26);
  assert.match(csvText, /^sequence,delay_ms,status\n1,,lost\n/);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => document.activeElement?.blur());
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  for (const selector of [
    ".packet-setting-label",
    ".packet-result-note",
    ".packet-chart-legend",
    ".packet-downloads",
  ]) {
    assert.ok(
      await page
        .locator(selector)
        .first()
        .evaluate(
          (element) => parseFloat(getComputedStyle(element).fontSize) >= 12,
        ),
    );
  }
  await capture("page-mobile-result");
  await page.evaluate(() => {
    window.packetFake.mode = "hold";
  });
  await page.getByRole("button", { name: "Test again", exact: true }).click();
  await page.waitForFunction(() =>
    window.packetFake.peers.some((pc) => pc.connectionState === "new"),
  );
  await page.getByRole("button", { name: "Cancel test", exact: true }).click();
  await page
    .getByText("Test cancelled. Change settings or start again.")
    .waitFor();
  assert.ok(await clean());
  credentialState = "timeout";
  assert.equal(
    posts,
    2,
    "Cancel must not submit the form and start another test",
  );
  await start.click();
  await page
    .getByText("The test timed out. Keep this tab active and try again.")
    .waitFor();
  credentialState = "ok";
  await page.evaluate(() => {
    delete window.RTCPeerConnection;
  });
  const beforeUnsupported = posts;
  await start.click();
  await page
    .getByText("This browser does not support the WebRTC test.")
    .waitFor();
  assert.equal(posts, beforeUnsupported);
  await page.evaluate(() => {
    window.RTCPeerConnection = window.packetPeer;
  });
  credentialState = "error";
  await start.click();
  await page
    .getByText("TURN credentials are unavailable. Try again later.")
    .waitFor();
  assert.equal(await page.locator('[data-result="loss"]').count(), 0);
  credentialState = "ok";
  await page.evaluate(() => {
    window.packetFake.mode = "tcp";
  });
  await start.click();
  await page
    .getByText("A UDP TURN route could not be verified in this browser.")
    .waitFor();
  assert.equal(await page.locator('[data-result="loss"]').count(), 0);
  assert.ok(await clean());
  await page.evaluate(() => {
    window.packetFake.mode = "hold";
  });
  await start.click();
  await page.waitForFunction(() =>
    window.packetFake.peers.some((pc) => pc.connectionState === "new"),
  );
  await page
    .getByRole("navigation", { name: "Tests" })
    .getByRole("link", { name: "Speed test", exact: true })
    .click();
  await page.getByRole("button", { name: "Start", exact: true }).waitFor();
  assert.ok(await clean(), "Leaving the page closes both peers and channels");
  if (release) {
    await page.context().setOffline(true);
    await page.getByText("Offline", { exact: true }).waitFor();
    assert.ok(
      await page
        .getByRole("button", { name: "Start", exact: true })
        .isDisabled(),
    );
    await page.context().setOffline(false);
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await page.locator(".test-error").waitFor();
    assert.match(
      await page.locator(".test-error").textContent(),
      /Couldn’t reach/,
    );
    assert.ok(blockedSpeedRequests > 0);
    const result = JSON.parse(
      await readFile(
        new URL("./fixtures/layout-result.json", import.meta.url),
        "utf8",
      ),
    );
    await page.evaluate((result) => {
      const node = document.querySelector(".test-space");
      let fiber =
        node[Object.keys(node).find((key) => key.startsWith("__reactFiber$"))];
      while (fiber) {
        for (let hook = fiber.memoizedState; hook; hook = hook.next) {
          const value = hook.memoizedState;
          if (value?.getSnapshot && value?.subscribe && value?.update) {
            value.update({ stage: "complete", metrics: result, result });
            return;
          }
        }
        fiber = fiber.return;
      }
      throw new Error("Existing engine unavailable");
    }, result);
    for (const [width, height] of [
      [1366, 768],
      [390, 844],
    ]) {
      await page.setViewportSize({ width, height });
      await page.locator("[data-quality='gaming'] button").click();
      assert.equal(
        await page
          .locator("[data-quality='gaming'] button")
          .getAttribute("aria-expanded"),
        "true",
      );
      assert.equal(await page.locator(".quality-details").count(), 1);
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      await page.locator("[data-quality='gaming'] button").click();
    }
  }
  assert.equal(externalRequests, 0, "No speed test or real TURN traffic");
  assert.deepEqual(errors, []);
  console.log(
    "Packet loss page passed: independent navigation, setup refresh, presets/settings, real pacing with mocked WebRTC, warm-up excluded, loss vs late counts, chart/export, mobile layout, cancellation, failures, and navigation cleanup. No real measurement traffic.",
  );
} catch (error) {
  console.error(await page.locator("main").innerText());
  await mkdir("artifacts/packet-loss", { recursive: true });
  await page.screenshot({
    path: "artifacts/packet-loss/page-failure.png",
    fullPage: true,
  });
  throw error;
} finally {
  await browser.close();
}
