"use client";

import { memo } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { AnimatedNumber } from "./animated-number";
import { SpeedTrace } from "@/components/charts/speed-trace";
import type { MeasurementPoint, TestMetrics } from "@/types/speedtest";
import { formatMetric } from "@/utils/format";

export const LiveMeasurement = memo(function LiveMeasurement({
  stage,
  value,
  points,
  metrics,
}: {
  stage: "latency" | "download" | "upload";
  value: number | null;
  points: MeasurementPoint[];
  metrics: TestMetrics;
}) {
  const label =
    stage === "latency"
      ? "Latency"
      : stage === "download"
        ? "Download"
        : "Upload";
  const unit = stage === "latency" ? "ms" : "Mbps";
  return (
    <div className="live-measurement" key={stage}>
      <div className="measurement-label">
        {stage === "download" ? (
          <ArrowDown size={17} aria-hidden="true" />
        ) : stage === "upload" ? (
          <ArrowUp size={17} aria-hidden="true" />
        ) : (
          <span className="latency-mark" aria-hidden="true" />
        )}
        {label}
      </div>
      <div className="number-slot">
        <AnimatedNumber value={value} animate={stage !== "latency"} />
        <span className="sr-only">
          {label}: {formatMetric(value)} {unit}
        </span>
      </div>
      <span className="measurement-unit">{unit}</span>
      <SpeedTrace points={points} />
      <dl className="support-metrics">
        {stage !== "latency" && metrics.latencyMs !== null && (
          <div>
            <dt>Ping</dt>
            <dd>
              {formatMetric(metrics.latencyMs)} <span>ms</span>
            </dd>
          </div>
        )}
        {metrics.jitterMs !== null && (
          <div>
            <dt>Jitter</dt>
            <dd>
              {formatMetric(metrics.jitterMs)} <span>ms</span>
            </dd>
          </div>
        )}
        {stage === "upload" && metrics.downloadMbps !== null && (
          <div>
            <dt>Download</dt>
            <dd>
              {formatMetric(metrics.downloadMbps)} <span>Mbps</span>
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
});
