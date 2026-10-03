"use client";

import { ArrowUpRight, RotateCcw, Square, TriangleAlert } from "lucide-react";
import { Header } from "@/components/layout/header";
import { ConnectionInformation } from "./connection-info";
import { LiveMeasurement } from "./live-measurement";
import { Results } from "./results";
import { QualityAnalysis } from "./quality-analysis";
import { useSpeedTest } from "@/hooks/use-speedtest";
import { useNetwork } from "@/hooks/use-network";
import { isActive, type TestStage } from "@/types/speedtest";

const labels: Record<TestStage, string> = {
  idle: "Ready to test",
  preparing: "Connecting",
  latency: "Measuring latency",
  download: "Measuring download",
  upload: "Measuring upload",
  finalizing: "Finishing up",
  complete: "Test complete",
  error: "Test interrupted",
  cancelled: "Test cancelled",
};

export function TestConsole() {
  const { snapshot, start, cancel } = useSpeedTest();
  const info = useNetwork();
  const { stage, metrics, result } = snapshot;
  const active = isActive(stage);
  const measuring =
    stage === "latency" || stage === "download" || stage === "upload";
  const completed = stage === "complete" && result !== null;
  // The live readout follows the latest genuine individual sample. The
  // result summary below exclusively uses Cloudflare's final aggregate.
  const points = measuring ? snapshot[stage] : [];
  const current = points.at(-1)?.value ?? null;

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to speed test
      </a>
      <Header />
      <main id="main" className={`main-shell${completed ? " has-result" : ""}`}>
        <h1 className="sr-only">Internet speed test</h1>
        <div className="primary-flow">
          <section
            className={`test-space ${stage === "idle" ? "is-idle" : ""}`}
            aria-label="Internet speed test"
            data-stage={stage}
          >
            <h2
              id="test-status"
              className={
                stage === "idle" || measuring ? "sr-only" : "test-status"
              }
              role="status"
            >
              {labels[stage]}
            </h2>
            {stage === "idle" ? (
              <div className="idle-control">
                <div className="start-surround" aria-hidden="true">
                  <span />
                </div>
                <button
                  className="start-control"
                  onClick={start}
                  disabled={info.online === false}
                >
                  <span>
                    <ArrowUpRight
                      size={25}
                      strokeWidth={1.4}
                      aria-hidden="true"
                    />
                    Start
                  </span>
                </button>
              </div>
            ) : completed ? (
              <Results result={result} />
            ) : measuring ? (
              <LiveMeasurement
                key={stage}
                stage={stage}
                value={current}
                points={points}
                metrics={metrics}
              />
            ) : active ? (
              <div className="connecting-mark" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
            ) : (
              <div className="stopped-mark" aria-hidden="true">
                {stage === "error" ? (
                  <TriangleAlert size={37} strokeWidth={1.2} />
                ) : (
                  <Square size={26} strokeWidth={1.2} />
                )}
              </div>
            )}
            {snapshot.error && (
              <p className="test-error" role="alert">
                {snapshot.error}
              </p>
            )}
            {stage === "cancelled" && (
              <p className="quiet-message">Ready for a fresh start.</p>
            )}
            {stage !== "idle" && (
              <div className="test-action">
                {active ? (
                  <button className="cancel-button" onClick={cancel}>
                    <Square size={10} aria-hidden="true" />
                    Cancel test
                  </button>
                ) : (
                  <button
                    className="again-button"
                    onClick={start}
                    disabled={info.online === false}
                  >
                    <RotateCcw size={15} aria-hidden="true" />
                    Test again
                  </button>
                )}
              </div>
            )}
            {info.saveData && !active && (
              <p className="data-note">
                Data Saver is on. This test uses real network data.
              </p>
            )}
          </section>
          <footer className="connection-area">
            <div className="connection-line">
              <span
                className={`status-dot ${info.online === false ? "is-offline" : ""}`}
                aria-hidden="true"
              />
              <span>Cloudflare Edge</span>
              {info.online === false && (
                <span className="offline-label">Offline</span>
              )}
              {info.protocol === "HTTPS" && (
                <span className="protocol-label">HTTPS</span>
              )}
            </div>
            <ConnectionInformation info={info} snapshot={snapshot} />
          </footer>
        </div>
        {completed && <QualityAnalysis result={result} />}
      </main>
    </>
  );
}
