import type CloudflareSpeedTest from "@cloudflare/speedtest";
import {
  initialSnapshot,
  isActive,
  type TestSnapshot,
  type TestMetrics,
  type SpeedTestResult,
} from "@/types/speedtest";

type ProviderResults = CloudflareSpeedTest["results"];

// Browser timing can be absent, filtered, or non-finite. Zero latency is valid;
// zero bandwidth is not a successful throughput measurement.
export function validMeasurement(
  value: unknown,
  divisor = 1,
  positive = false,
): number | null {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    (positive ? value > 0 : value >= 0)
    ? value / divisor
    : null;
}

function readMetrics(results: ProviderResults): TestMetrics {
  return {
    latencyMs: validMeasurement(results.getUnloadedLatency()),
    jitterMs: validMeasurement(results.getUnloadedJitter()),
    downloadMbps: validMeasurement(results.getDownloadBandwidth(), 1e6, true),
    uploadMbps: validMeasurement(results.getUploadBandwidth(), 1e6, true),
    // Loaded latency needs transfers long enough to load the connection. On
    // fast links or restricted Resource Timing APIs, these may stay null.
    downloadLoadedLatencyMs: validMeasurement(results.getDownLoadedLatency()),
    uploadLoadedLatencyMs: validMeasurement(results.getUpLoadedLatency()),
  };
}

export class SpeedTestEngine {
  private snapshot = initialSnapshot();
  private listeners = new Set<() => void>();
  private provider: CloudflareSpeedTest | null = null;
  private generation = 0;
  private startedAt = 0;
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private finalization: ReturnType<typeof setTimeout> | null = null;
  private latencyCount = 0;
  private downloadCount = 0;
  private uploadCount = 0;

  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private update(patch: Partial<TestSnapshot>) {
    if (
      Object.entries(patch).every(
        ([key, value]) => this.snapshot[key as keyof TestSnapshot] === value,
      )
    )
      return;
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((listener) => listener());
  }

  private cleanup() {
    if (this.watchdog) clearTimeout(this.watchdog);
    if (this.finalization) clearTimeout(this.finalization);
    this.watchdog = null;
    this.finalization = null;
    if (this.provider) {
      // Verified in @cloudflare/speedtest: pause aborts its active fetch,
      // stops parallel loaded-latency probes, and clears retry timers.
      this.provider.onResultsChange = () => {};
      this.provider.onPhaseChange = () => {};
      this.provider.onFinish = () => {};
      this.provider.onError = () => {};
      this.provider.pause();
      this.provider = null;
    }
  }

  private fail(message: string) {
    ++this.generation;
    this.cleanup();
    this.update({
      stage: "error",
      error: message,
      elapsedMs: performance.now() - this.startedAt,
    });
  }

  async start() {
    if (isActive(this.snapshot.stage)) return;
    this.cleanup();
    const run = ++this.generation;
    this.startedAt = performance.now();
    this.latencyCount = 0;
    this.downloadCount = 0;
    this.uploadCount = 0;
    this.snapshot = initialSnapshot();
    this.update({ stage: "preparing" });
    if (!navigator.onLine) {
      this.fail("You’re offline. Reconnect and run the test again.");
      return;
    }
    if (
      !performance.getEntriesByName ||
      !performance.setResourceTimingBufferSize
    ) {
      this.fail(
        "This browser does not support the timing APIs needed for a speed test.",
      );
      return;
    }
    this.watchdog = setTimeout(
      () =>
        this.fail(
          "The test timed out. Check your connection or content blocker and try again.",
        ),
      120_000,
    );
    try {
      // Client-only import: the provider reads browser APIs and must never run
      // during server rendering. A cancelled import cannot start a stale run.
      const { default: Provider } = await import("@cloudflare/speedtest");
      if (run !== this.generation) return;
      const provider = new Provider({
        autoStart: false,
        logAimApiUrl: null,
        logMeasurementApiUrl: null,
        measureDownloadLoadedLatency: true,
        measureUploadLoadedLatency: true,
        bandwidthAbortRequestDuration: 15_000,
        measurements: [
          { type: "latency", numPackets: 16 },
          { type: "download", bytes: 100_000, count: 3 },
          { type: "download", bytes: 1_000_000, count: 3 },
          { type: "download", bytes: 10_000_000, count: 3 },
          { type: "download", bytes: 25_000_000, count: 2 },
          { type: "upload", bytes: 100_000, count: 3 },
          { type: "upload", bytes: 1_000_000, count: 3 },
          { type: "upload", bytes: 10_000_000, count: 3 },
        ],
      });
      this.provider = provider;
      provider.onPhaseChange = ({ measurement }) => {
        if (
          run === this.generation &&
          ["latency", "download", "upload"].includes(measurement.type)
        ) {
          this.update({
            stage: measurement.type as "latency" | "download" | "upload",
          });
        }
      };
      provider.onResultsChange = ({ type }) => {
        if (run !== this.generation) return;
        const r = provider.results;
        const now = performance.now() - this.startedAt;
        const points = type === "latency" ? r.getUnloadedLatencyPoints() : [];
        const fresh = points.slice(this.latencyCount);
        if (type === "latency") this.latencyCount = points.length;
        const latency = fresh.length
          ? [
              ...this.snapshot.latency,
              ...fresh.flatMap((value) => {
                const measured = validMeasurement(value);
                return measured === null
                  ? []
                  : [{ timeMs: now, value: measured }];
              }),
            ]
          : this.snapshot.latency;
        const bandwidthPoints = (
          items: ReturnType<ProviderResults["getDownloadBandwidthPoints"]>,
        ) =>
          items
            .flatMap((p) => {
              const value = validMeasurement(p.bps, 1e6, true);
              return value === null
                ? []
                : [{ timeMs: new Date(p.measTime).getTime(), value }];
            })
            .sort((a, b) => a.timeMs - b.timeMs);
        let download = this.snapshot.download;
        let upload = this.snapshot.upload;
        // Loaded-latency events arrive between throughput samples. Preserve
        // array identity unless a real sample was added, so traces can memoize.
        if (type === "download") {
          const samples = r.getDownloadBandwidthPoints();
          if (samples.length !== this.downloadCount) {
            this.downloadCount = samples.length;
            download = bandwidthPoints(samples);
          }
        }
        if (type === "upload") {
          const samples = r.getUploadBandwidthPoints();
          if (samples.length !== this.uploadCount) {
            this.uploadCount = samples.length;
            upload = bandwidthPoints(samples);
          }
        }
        const nextMetrics = readMetrics(r);
        const metrics = Object.entries(nextMetrics).every(
          ([key, value]) =>
            this.snapshot.metrics[key as keyof TestMetrics] === value,
        )
          ? this.snapshot.metrics
          : nextMetrics;
        if (
          metrics !== this.snapshot.metrics ||
          latency !== this.snapshot.latency ||
          download !== this.snapshot.download ||
          upload !== this.snapshot.upload
        ) {
          this.update({ metrics, latency, download, upload, elapsedMs: now });
        }
      };
      provider.onError = (message) => {
        if (run !== this.generation) return;
        console.warn("InternetTest measurement failed:", message);
        this.fail(
          "Couldn’t reach the test network. Check your connection, VPN, or content blocker and try again.",
        );
      };
      provider.onFinish = (results) => {
        if (run !== this.generation) return;
        const metrics = readMetrics(results);
        const result: SpeedTestResult = {
          ...metrics,
          timestamp: new Date().toISOString(),
          durationMs: performance.now() - this.startedAt,
        };
        this.cleanup();
        this.update({
          stage: "finalizing",
          metrics,
          elapsedMs: result.durationMs,
        });
        // Let the browser render the final stage before revealing the summary.
        // This delay never changes measured values or the measurement duration.
        this.finalization = setTimeout(() => {
          this.finalization = null;
          if (run === this.generation)
            this.update({ stage: "complete", result });
        }, 160);
      };
      provider.play();
    } catch (error) {
      if (run !== this.generation) return;
      console.warn("InternetTest initialization failed:", error);
      this.fail(
        "The test engine couldn’t start. Reload the page or try another modern browser.",
      );
    }
  }

  cancel() {
    if (!isActive(this.snapshot.stage)) return;
    ++this.generation;
    this.cleanup();
    this.update({
      stage: "cancelled",
      elapsedMs: performance.now() - this.startedAt,
    });
  }

  handleOffline() {
    if (isActive(this.snapshot.stage))
      this.fail(
        "Your connection went offline. Reconnect and run the test again.",
      );
  }

  dispose() {
    ++this.generation;
    this.cleanup();
  }
}
