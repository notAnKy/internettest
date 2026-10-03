"use client";

import { useState } from "react";
import type { ConnectionInfo } from "@/lib/network/connection";
import type { TestSnapshot } from "@/types/speedtest";
import { MeasurementSamples } from "./measurement-samples";

export function ConnectionInformation({
  info,
  snapshot,
}: {
  info: ConnectionInfo;
  snapshot: TestSnapshot;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="connection-info"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>Connection info</summary>
      {open && (
        <div className="connection-content">
          <dl>
            <div>
              <dt>Test network</dt>
              <dd>Cloudflare Edge</dd>
            </div>
            <div>
              <dt>Connection</dt>
              <dd>
                {info.online === null
                  ? "Checking…"
                  : info.online
                    ? "Online"
                    : "Offline"}
              </dd>
            </div>
            <div>
              <dt>Page protocol</dt>
              <dd>
                {info.protocol}
                {info.protocol === "HTTP" && <small> · unencrypted page</small>}
              </dd>
            </div>
            <div>
              <dt>Browser network type</dt>
              <dd>{info.networkType}</dd>
            </div>
            <div>
              <dt>Browser downlink estimate</dt>
              <dd>
                {info.downlink === null
                  ? "Unavailable"
                  : `${info.downlink} Mbps`}
              </dd>
            </div>
          </dl>
          {snapshot.result && (
            <p>
              Completed in {(snapshot.result.durationMs / 1000).toFixed(1)}{" "}
              seconds · {new Date(snapshot.result.timestamp).toLocaleString()}
            </p>
          )}
          <p>
            Network type and downlink above are browser estimates, separate from
            measured speed.
          </p>
          <details className="method-details">
            <summary>Method & privacy</summary>
            <div>
              <p>
                Real transfers go directly to Cloudflare over HTTPS. The
                configured sequence uses up to about 117 MB of payloads before
                probes, overhead, or retries. Slower connections may stop
                earlier.
              </p>
              <p>
                Ping is HTTP timing to Cloudflare, not ICMP or game-server
                latency. Idle and loaded latency use the median; jitter is the
                average difference between consecutive idle samples. Final
                throughput is Cloudflare’s 90th percentile of eligible samples.
                Short transfers can underestimate fast links, and loaded latency
                can be unavailable.
              </p>
              <p>
                Live numbers ease toward real samples for display only. Final
                results use unmodified Cloudflare values. Optional result
                logging is disabled; Cloudflare still receives your network
                address as the test endpoint. Only your latest completed result
                is saved in this browser when storage is available. No location
                permission or fingerprinting is used.
              </p>
            </div>
          </details>
          {snapshot.stage !== "idle" && (
            <MeasurementSamples
              latency={snapshot.latency}
              download={snapshot.download}
              upload={snapshot.upload}
            />
          )}
        </div>
      )}
    </details>
  );
}
