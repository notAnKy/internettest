import type { SpeedTestResult } from "../../types/speedtest";
import type {
  ConnectionQualityReport,
  QualityCategory,
  QualityMetric,
} from "../../types/quality";
import { analyzeBufferbloat } from "./bufferbloat";
import {
  band,
  grades,
  increaseGrade,
  thresholds as t,
  validMetric,
  worstGrade,
  type RatedGrade,
} from "./thresholds";

const metric = (
  key: string,
  label: string,
  value: number | null,
  unit: "ms" | "Mbps",
  signed = false,
): QualityMetric[] =>
  value === null ? [] : [{ key, label, value, unit, signed }];

function category(
  core: (number | null)[],
  all: (number | null)[],
  ratings: (RatedGrade | null)[],
  metrics: QualityMetric[],
  summary: string,
  note?: string,
): QualityCategory {
  const enough = core.every((value) => value !== null);
  return {
    grade: enough ? worstGrade(ratings) : "unavailable",
    coverage: !enough
      ? "insufficient"
      : all.every((value) => value !== null)
        ? "complete"
        : "limited",
    summary: enough ? summary : "Not enough measurements for a rating.",
    metrics: metrics.slice(0, 3),
    note,
  };
}

export function analyzeConnection(
  result: SpeedTestResult,
): ConnectionQualityReport {
  // Pure derivation from raw measurements. No storage, animation, network
  // access or mutation; malformed and absent metrics never become zeros.
  const ping = validMetric(result.latencyMs),
    jitter = validMetric(result.jitterMs);
  const down = validMetric(result.downloadMbps),
    up = validMetric(result.uploadMbps);
  const loadedDown = validMetric(result.downloadLoadedLatencyMs),
    loadedUp = validMetric(result.uploadLoadedLatencyMs);
  const knownLoaded = [loadedDown, loadedUp].filter((value) => value !== null);
  const loaded = knownLoaded.length ? Math.max(...knownLoaded) : null;
  const bufferbloat = analyzeBufferbloat(result);
  const increase = bufferbloat.worstIncreaseMs;
  const loadGrade = increase === null ? null : increaseGrade(increase);
  const all = [ping, jitter, down, up, loadedDown, loadedUp];
  const loadMetric = metric(
    "worstIncreaseMs",
    "Added latency under load",
    increase,
    "ms",
    true,
  );

  const gaming = category(
    [ping, jitter],
    all,
    [
      band(ping, t.gaming.latency),
      band(jitter, t.gaming.jitter),
      loadGrade,
      band(down, t.gaming.download, true),
      band(up, t.gaming.upload, true),
    ],
    [
      ...metric("latencyMs", "Ping", ping, "ms"),
      ...metric("jitterMs", "Jitter", jitter, "ms"),
      ...loadMetric,
    ],
    increase !== null && increase >= 30
      ? "Heavy transfers may increase game latency."
      : jitter !== null && jitter > 15
        ? "Variable timing can affect fast-paced play."
        : ping !== null && ping > 80
          ? "Higher ping can delay in-game responses."
          : (down !== null && down < 3) || (up !== null && up < 0.5)
            ? "Bandwidth is tight for online play."
            : "Responsive timing for general online play.",
    "Actual game latency also depends on server location and routing.",
  );

  const streaming = category(
    [down],
    [down],
    [band(down, t.streaming.download, true)],
    metric("downloadMbps", "Download", down, "Mbps"),
    down !== null && down >= 30
      ? "Bandwidth leaves headroom for one 4K stream."
      : down !== null && down >= 20
        ? "Bandwidth meets a common 4K target with less headroom."
        : down !== null && down >= 7.5
          ? "Bandwidth leaves headroom for one 1080p stream."
          : down !== null && down >= 3
            ? "Lower resolutions leave more room for other traffic."
            : "Streaming may need a lower resolution.",
    "Service requirements vary; this short test cannot establish sustained stability.",
  );

  const browsing = category(
    [ping, down],
    [ping, down, loadedDown, loadedUp],
    [
      band(ping, t.browsing.latency),
      band(down, t.browsing.download, true),
      band(loaded, t.browsing.loaded),
    ],
    [
      ...metric("latencyMs", "Ping", ping, "ms"),
      ...metric("downloadMbps", "Download", down, "Mbps"),
      ...metric("worstLoadedLatencyMs", "Latency under load", loaded, "ms"),
    ],
    loaded !== null && loaded > 200
      ? "Busy-network delays may slow page responses."
      : ping !== null && ping > 100
        ? "Higher ping may make pages feel slower to respond."
        : down !== null && down < 5
          ? "Large pages and downloads may take longer."
          : "Enough bandwidth and responsive timing for everyday browsing.",
  );

  const videoCalls = category(
    [ping, down, up],
    all,
    [
      band(ping, t.videoCalls.latency),
      band(jitter, t.videoCalls.jitter),
      band(down, t.videoCalls.bandwidth, true),
      band(up, t.videoCalls.bandwidth, true),
      band(loaded, t.videoCalls.loaded),
      loadGrade,
    ],
    [
      ...metric("uploadMbps", "Upload", up, "Mbps"),
      ...metric("jitterMs", "Jitter", jitter, "ms"),
      ...metric(
        "uploadLoadedLatencyMs",
        "Upload-loaded latency",
        loadedUp,
        "ms",
      ),
    ],
    (up !== null && up < 3.2) || (down !== null && down < 3.2)
      ? "Lower video quality may help calls fit the available bandwidth."
      : (jitter !== null && jitter > 15) ||
          (loaded !== null && loaded > 200) ||
          (increase !== null && increase >= 30)
        ? "Calls may become less responsive while the network is busy."
        : ping !== null && ping > 100
          ? "Higher latency can make conversations feel delayed."
          : "Should handle one video call comfortably.",
  );

  const categories = { gaming, streaming, browsing, videoCalls };
  const available = Object.entries(categories).filter(
    ([, value]) => value.grade !== "unavailable",
  );
  const sufficient =
    available.length >= 3 &&
    browsing.grade !== "unavailable" &&
    videoCalls.grade !== "unavailable";
  let overallGrade: QualityCategory["grade"] = "unavailable";
  if (sufficient) {
    // Weighted median of use-case grades, not an average of raw measurements.
    const weights = grades.map((grade) =>
      available.reduce(
        (sum, [key, value]) =>
          sum +
          (value.grade === grade
            ? t.overallWeights[key as keyof typeof categories]
            : 0),
        0,
      ),
    );
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let cumulative = 0;
    const index = weights.findIndex((weight) => {
      cumulative += weight;
      return cumulative >= total / 2;
    });
    let rank = index;
    if (
      available.some(
        ([, value]) => value.grade === "fair" || value.grade === "poor",
      )
    )
      rank = Math.max(rank, 1);
    if (
      [gaming, browsing, videoCalls].some((value) => value.grade === "poor") ||
      bufferbloat.grade === "poor"
    )
      rank = Math.max(rank, 2);
    if (all.some((value) => value === null)) rank = Math.max(rank, 1);
    overallGrade = grades[rank];
  }
  const overall: QualityCategory = {
    grade: overallGrade,
    coverage: !sufficient
      ? "insufficient"
      : all.every((value) => value !== null)
        ? "complete"
        : "limited",
    metrics: [
      ...metric("downloadMbps", "Download", down, "Mbps"),
      ...metric("uploadMbps", "Upload", up, "Mbps"),
      ...metric("latencyMs", "Ping", ping, "ms"),
    ],
    summary: !sufficient
      ? "More measurements are needed for an overall rating."
      : bufferbloat.grade === "poor"
        ? "Heavy transfers can slow an otherwise capable connection."
        : [gaming, browsing, videoCalls].some((value) => value.grade === "poor")
          ? "Response times or bandwidth limit everyday connection quality."
          : overallGrade === "poor" || overallGrade === "fair"
            ? "Some everyday tasks may need lighter network use."
            : "A capable connection for everyday use.",
  };
  return {
    methodologyVersion: "1",
    overall,
    gaming,
    streaming,
    browsing,
    videoCalls,
    bufferbloat,
  };
}
