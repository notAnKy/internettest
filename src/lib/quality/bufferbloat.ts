import type { SpeedTestResult } from "../../types/speedtest";
import type { BufferbloatAnalysis } from "../../types/quality";
import { increaseGrade, validMetric } from "./thresholds";

export function analyzeBufferbloat(
  result: SpeedTestResult,
): BufferbloatAnalysis {
  const idle = validMetric(result.latencyMs);
  const download = validMetric(result.downloadLoadedLatencyMs);
  const upload = validMetric(result.uploadLoadedLatencyMs);
  const downDelta = idle !== null && download !== null ? download - idle : null;
  const upDelta = idle !== null && upload !== null ? upload - idle : null;
  const deltas = [downDelta, upDelta].filter((value) => value !== null);
  // Retain signed measured differences for display. Negative differences
  // reflect timing variation; only grading treats them as no added latency.
  const worst = deltas.length ? Math.max(0, ...deltas) : null;
  const complete = downDelta !== null && upDelta !== null;
  const grade =
    complete && worst !== null ? increaseGrade(worst) : "unavailable";
  const direction =
    (downDelta ?? -Infinity) >= (upDelta ?? -Infinity)
      ? "Downloads"
      : "Uploads";
  return {
    grade,
    coverage: complete
      ? "complete"
      : deltas.length
        ? "limited"
        : "insufficient",
    downloadIncreaseMs: downDelta,
    uploadIncreaseMs: upDelta,
    worstIncreaseMs: worst,
    metrics: [
      ...(downDelta === null
        ? []
        : [
            {
              key: "downloadIncreaseMs",
              label: "Under download",
              value: downDelta,
              unit: "ms" as const,
              signed: true,
            },
          ]),
      ...(upDelta === null
        ? []
        : [
            {
              key: "uploadIncreaseMs",
              label: "Under upload",
              value: upDelta,
              unit: "ms" as const,
              signed: true,
            },
          ]),
    ],
    summary: !complete
      ? "Both loaded-latency measurements are needed for a rating."
      : grade === "excellent"
        ? "Latency stays close to idle while the connection is busy."
        : grade === "good"
          ? "Transfers add a small amount of latency."
          : grade === "fair"
            ? `${direction} noticeably increase latency.`
            : `${direction} can cause delays in games and calls.`,
  };
}
