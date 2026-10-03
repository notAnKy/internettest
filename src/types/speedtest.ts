export type TestStage =
  | "idle"
  | "preparing"
  | "latency"
  | "download"
  | "upload"
  | "finalizing"
  | "complete"
  | "error"
  | "cancelled";

export interface TestMetrics {
  latencyMs: number | null;
  jitterMs: number | null;
  downloadMbps: number | null;
  uploadMbps: number | null;
  downloadLoadedLatencyMs: number | null;
  uploadLoadedLatencyMs: number | null;
}

export interface SpeedTestResult extends TestMetrics {
  timestamp: string;
  durationMs: number;
}

export interface MeasurementPoint {
  timeMs: number;
  value: number;
}

export interface TestSnapshot {
  stage: TestStage;
  metrics: TestMetrics;
  latency: MeasurementPoint[];
  download: MeasurementPoint[];
  upload: MeasurementPoint[];
  elapsedMs: number;
  error: string | null;
  result: SpeedTestResult | null;
}

export const emptyMetrics = (): TestMetrics => ({
  latencyMs: null,
  jitterMs: null,
  downloadMbps: null,
  uploadMbps: null,
  downloadLoadedLatencyMs: null,
  uploadLoadedLatencyMs: null,
});

export const initialSnapshot = (): TestSnapshot => ({
  stage: "idle",
  metrics: emptyMetrics(),
  latency: [],
  download: [],
  upload: [],
  elapsedMs: 0,
  error: null,
  result: null,
});

export const isActive = (stage: TestStage) =>
  ["preparing", "latency", "download", "upload", "finalizing"].includes(stage);
