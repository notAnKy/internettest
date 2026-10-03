import { ArrowDown, ArrowUp } from "lucide-react";
import type { SpeedTestResult } from "@/types/speedtest";
import { formatMetric } from "@/utils/format";

export function Results({ result }: { result: SpeedTestResult }) {
  return (
    <div className="result-summary">
      <div className="result-speeds">
        <div>
          <h2>
            <ArrowDown size={18} aria-hidden="true" />
            Download
          </h2>
          <p
            data-result="downloadMbps"
            className={result.downloadMbps === null ? "result-unavailable" : ""}
          >
            {formatMetric(result.downloadMbps, true)}
          </p>
          <span>
            {result.downloadMbps === null ? "No valid samples" : "Mbps"}
          </span>
        </div>
        <div>
          <h2>
            <ArrowUp size={18} aria-hidden="true" />
            Upload
          </h2>
          <p
            data-result="uploadMbps"
            className={result.uploadMbps === null ? "result-unavailable" : ""}
          >
            {formatMetric(result.uploadMbps, true)}
          </p>
          <span>
            {result.uploadMbps === null ? "No valid samples" : "Mbps"}
          </span>
        </div>
      </div>
      <dl className="result-latency">
        <div>
          <dt>Ping</dt>
          <dd data-result="latencyMs">
            {formatMetric(result.latencyMs, true)}
            {result.latencyMs !== null && <span> ms</span>}
          </dd>
        </div>
        <div>
          <dt>Jitter</dt>
          <dd data-result="jitterMs">
            {formatMetric(result.jitterMs, true)}
            {result.jitterMs !== null && <span> ms</span>}
          </dd>
        </div>
      </dl>
      <dl className="loaded-latency">
        <dt>Loaded latency</dt>
        <dd>
          <span>
            <ArrowDown size={13} aria-hidden="true" />
            <span className="sr-only">Download: </span>
            <span data-result="downloadLoadedLatencyMs">
              {formatMetric(result.downloadLoadedLatencyMs, true)}
            </span>
            {result.downloadLoadedLatencyMs !== null && <small> ms</small>}
          </span>
          <span>
            <ArrowUp size={13} aria-hidden="true" />
            <span className="sr-only">Upload: </span>
            <span data-result="uploadLoadedLatencyMs">
              {formatMetric(result.uploadLoadedLatencyMs, true)}
            </span>
            {result.uploadLoadedLatencyMs !== null && <small> ms</small>}
          </span>
        </dd>
      </dl>
    </div>
  );
}
