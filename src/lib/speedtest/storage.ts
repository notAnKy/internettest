import type { SpeedTestResult } from "@/types/speedtest";

const LATEST_KEY = "internettest:latest:v1";

export interface ResultStore {
  save(result: SpeedTestResult): boolean;
  latest(): SpeedTestResult | null;
}

// Storage is optional: private browsing, disabled storage, and quota errors
// must never turn a successfully measured result into a failed test.
export const localResultStore: ResultStore = {
  save(result) {
    try {
      localStorage.setItem(LATEST_KEY, JSON.stringify(result));
      return true;
    } catch {
      return false;
    }
  },
  latest() {
    try {
      const parsed: unknown = JSON.parse(
        localStorage.getItem(LATEST_KEY) ?? "null",
      );
      if (!parsed || typeof parsed !== "object") return null;
      const r = parsed as Record<string, unknown>;
      const fields = [
        "latencyMs",
        "jitterMs",
        "downloadMbps",
        "uploadMbps",
        "downloadLoadedLatencyMs",
        "uploadLoadedLatencyMs",
      ];
      if (
        typeof r.timestamp !== "string" ||
        !Number.isFinite(Date.parse(r.timestamp)) ||
        typeof r.durationMs !== "number" ||
        !Number.isFinite(r.durationMs) ||
        r.durationMs < 0 ||
        !fields.every(
          (key) =>
            r[key] === null ||
            (typeof r[key] === "number" &&
              Number.isFinite(r[key]) &&
              r[key] >= 0),
        )
      )
        return null;
      return r as unknown as SpeedTestResult;
    } catch {
      return null;
    }
  },
};
