"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  Download,
  Radio,
  RotateCcw,
  Square,
  CircleHelp,
} from "lucide-react";
import { Header } from "@/components/layout/header";
import { runPacketLoss } from "@/lib/packet-loss/engine";
import { lossNote } from "@/lib/packet-loss/statistics";
import {
  packetPresets,
  settingLimits,
  packetLossBudget,
  validatePacketLossSettings,
} from "@/lib/packet-loss/settings";
import { exportPacketLoss } from "@/lib/packet-loss/export";
import {
  PacketLossError,
  type PacketLossFailure,
  type PacketLossProgress,
  type PacketLossResult,
  type PacketLossSettings,
} from "@/types/packet-loss";
import { PacketDeliveryChart } from "@/components/charts/packet-delivery";

const messages: Record<PacketLossFailure, string> = {
  "setup-required": "Packet loss needs Metered TURN configured on the server.",
  "credentials-unavailable":
    "TURN credentials are unavailable. Try again later.",
  unsupported: "This browser does not support the WebRTC test.",
  "connection-failed": "Could not establish or maintain a UDP TURN connection.",
  "udp-unverified": "A UDP TURN route could not be verified in this browser.",
  timeout: "The test timed out. Keep this tab active and try again.",
  "no-delivery":
    "No test messages arrived; packet loss could not be established.",
  "invalid-settings": "Choose settings within the displayed limits.",
};
const controls = [
  {
    key: "packetSize",
    label: "Packet size",
    unit: "bytes",
    help: "Application payload size. Network headers add overhead.",
  },
  {
    key: "frequency",
    label: "Frequency",
    unit: "messages / second",
    help: "How often a message is sent through the relay.",
  },
  {
    key: "duration",
    label: "Duration",
    unit: "seconds",
    help: "Recording time, excluding connection, warm-up, and the final receive window.",
  },
  {
    key: "acceptableDelay",
    label: "Acceptable delay",
    unit: "ms",
    help: "Messages arriving after this threshold are late, not lost.",
  },
] as const;
const phaseLabels = {
  connecting: "Connecting to relay",
  warmup: "Warming up · 2 seconds",
  testing: "Measuring delivery",
  waiting: "Waiting for remaining messages",
};

export function PacketLossConsole() {
  const [settings, setSettings] = useState<PacketLossSettings>({
    ...packetPresets.default.settings,
  });
  const [preset, setPreset] = useState("default");
  const [availability, setAvailability] = useState<
    "checking" | "ready" | "setup-required" | "unknown"
  >("checking");
  const [state, setState] = useState<
    "idle" | "testing" | "complete" | "unavailable" | "cancelled"
  >("idle");
  const [result, setResult] = useState<PacketLossResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [progress, setProgress] = useState({
    sent: 0,
    received: 0,
    phase: "connecting",
    total: 150,
    elapsedMs: 0,
    durationMs: 10000,
  } as PacketLossProgress & { sent: number; received: number });
  const run = useRef<AbortController | null>(null);
  const check = useRef<AbortController | null>(null);
  const lastProgress = useRef({ at: 0, phase: "connecting" });
  const [exportError, setExportError] = useState<string | null>(null);
  useEffect(() => {
    let mounted = true;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      check.current?.abort();
      clearTimeout(timer);
      const controller = new AbortController();
      check.current = controller;
      timer = setTimeout(() => controller.abort(), 8000);
      void fetch("/api/turn-credentials", {
        cache: "no-store",
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) throw new Error("Status unavailable");
          const data = await response.json();
          if (mounted && !controller.signal.aborted)
            setAvailability(
              data.configured === true ? "ready" : "setup-required",
            );
        })
        .catch(() => {
          if (mounted && check.current === controller)
            setAvailability("unknown");
        })
        .finally(() => {
          if (check.current === controller) clearTimeout(timer);
        });
    };
    refresh();
    window.addEventListener("focus", refresh);
    return () => {
      mounted = false;
      window.removeEventListener("focus", refresh);
      clearTimeout(timer);
      check.current?.abort();
      run.current?.abort();
      run.current = null;
    };
  }, []);

  const active = state === "testing";
  const budget = packetLossBudget(settings);
  const total = budget.measuredMessages;
  const warmupCount = budget.warmupMessages;
  const payloadKb = (budget.payloadBytes / 1024).toFixed(1);
  let settingsError: string | null = null;
  try {
    validatePacketLossSettings(settings);
  } catch {
    settingsError =
      "Reduce size, frequency or duration: max 1,800 recorded messages and 1 MB payload, including warm-up.";
  }
  const update = (key: keyof PacketLossSettings, value: number | boolean) => {
    setSettings((previous) => ({ ...previous, [key]: value }));
    setPreset("custom");
  };
  const start = async () => {
    if (run.current) return;
    const controller = new AbortController();
    run.current = controller;
    setState("testing");
    setMessage(null);
    setResult(null);
    setExportError(null);
    lastProgress.current = { at: 0, phase: "connecting" };
    setProgress({
      sent: 0,
      received: 0,
      phase: "connecting",
      total,
      elapsedMs: 0,
      durationMs: settings.duration * 1000,
    });
    try {
      const measured = await runPacketLoss(
        controller.signal,
        (sent, received, detail) => {
          if (run.current === controller && detail) {
            const now = performance.now();
            if (
              detail.phase !== lastProgress.current.phase ||
              now - lastProgress.current.at >= 150 ||
              sent === detail.total
            ) {
              lastProgress.current = { at: now, phase: detail.phase };
              setProgress({ sent, received, ...detail });
            }
          }
        },
        settings,
      );
      if (run.current !== controller) return;
      setResult(measured);
      setState("complete");
    } catch (error) {
      if (run.current !== controller) return;
      const code =
        error instanceof PacketLossError ? error.code : "connection-failed";
      if (code === "setup-required") setAvailability("setup-required");
      setMessage(messages[code]);
      setState("unavailable");
    } finally {
      if (run.current === controller) run.current = null;
    }
  };
  const cancel = () => {
    const controller = run.current;
    run.current = null;
    controller?.abort();
    setState("cancelled");
    setResult(null);
    setMessage("Test cancelled. Change settings or start again.");
  };
  const download = (format: "json" | "csv") => {
    if (!result?.delivery) return;
    const exported = exportPacketLoss(result, format);
    const url = URL.createObjectURL(
      new Blob([exported.text], {
        type: exported.mimeType,
      }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = exported.filename;
    anchor.hidden = true;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  const status = active
    ? phaseLabels[progress.phase]
    : availability === "checking"
      ? "Checking setup"
      : availability === "setup-required"
        ? "Setup required"
        : state === "complete"
          ? "Test complete"
          : state === "unavailable"
            ? "Test unavailable"
            : state === "cancelled"
              ? "Test cancelled"
              : "Ready to test";

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to packet loss test
      </a>
      <Header active="packet-loss" />
      <main id="main" className="packet-page" data-packet-state={state}>
        <div className="packet-intro">
          <p className="packet-eyebrow">Connection quality</p>
          <h1>Packet loss test</h1>
          <p>
            Choose your settings and check how reliably your connection delivers
            data.
          </p>
        </div>
        <div className="packet-workspace">
          <form
            className="packet-settings"
            onSubmit={(event) => {
              event.preventDefault();
              if (
                !active &&
                availability !== "checking" &&
                availability !== "setup-required" &&
                !settingsError
              )
                void start();
            }}
          >
            <div className="packet-panel-heading">
              <h2>Test settings</h2>
              <button
                type="button"
                className="packet-reset"
                disabled={active}
                onClick={() => {
                  setSettings({ ...packetPresets.default.settings });
                  setPreset("default");
                }}
              >
                <RotateCcw size={13} aria-hidden="true" /> Reset
              </button>
            </div>
            <fieldset disabled={active}>
              <div className="packet-preset">
                <label htmlFor="packet-preset">Preset</label>
                <select
                  id="packet-preset"
                  value={preset}
                  onChange={(event) => {
                    const key = event.target.value;
                    setPreset(key);
                    if (key in packetPresets)
                      setSettings({
                        ...packetPresets[key as keyof typeof packetPresets]
                          .settings,
                      });
                  }}
                >
                  {Object.entries(packetPresets).map(([key, value]) => (
                    <option key={key} value={key}>
                      {value.label}
                    </option>
                  ))}
                  <option value="custom">Custom</option>
                </select>
              </div>
              <p className="packet-preset-note">
                General traffic profiles, not replicas of a specific game or
                app.
              </p>
              <div className="packet-controls">
                {controls.map(({ key, label, unit, help }) => (
                  <div className="packet-setting" key={key}>
                    <div className="packet-setting-label">
                      <div className="packet-control-title">
                        <label htmlFor={`packet-${key}`}>{label}</label>
                        {(key === "frequency" || key === "acceptableDelay") && (
                          <details className="packet-help">
                            <summary
                              aria-label={`About ${label.toLowerCase()}`}
                            >
                              <CircleHelp size={13} aria-hidden="true" />
                            </summary>
                            <span>{help}</span>
                          </details>
                        )}
                      </div>
                      <span>
                        <output htmlFor={`packet-${key}`}>
                          {settings[key]}
                        </output>{" "}
                        {unit}
                      </span>
                    </div>
                    <input
                      id={`packet-${key}`}
                      type="range"
                      {...settingLimits[key]}
                      value={settings[key]}
                      aria-describedby={`packet-${key}-help`}
                      aria-valuetext={`${settings[key]} ${unit}`}
                      onChange={(event) =>
                        update(key, Number(event.target.value))
                      }
                    />
                    <p id={`packet-${key}-help`} className="sr-only">
                      {help}
                    </p>
                  </div>
                ))}
              </div>
              <label className="packet-warmup">
                <input
                  type="checkbox"
                  checked={settings.warmup}
                  onChange={(event) => update("warmup", event.target.checked)}
                />
                <span>Warm up for 2 seconds before recording</span>
              </label>
            </fieldset>
            <div className="packet-server">
              <Radio size={16} aria-hidden="true" />
              <div>
                <span>Test route</span>
                <strong>
                  Metered Standard <span>· UDP</span>
                </strong>
              </div>
            </div>
            <div className="packet-settings-footer">
              <p>
                <strong>{total.toLocaleString()} messages</strong> · ~
                {payloadKb} KB payload
                {settings.warmup && (
                  <span>Includes {warmupCount} extra warm-up messages.</span>
                )}
                <span>Network and relay overhead add data usage.</span>
              </p>
              {settingsError && (
                <p className="packet-budget-error" role="status">
                  {settingsError}
                </p>
              )}
              {active ? (
                <button
                  key="cancel"
                  className="packet-primary packet-cancel"
                  type="button"
                  onClick={(event) => {
                    event.preventDefault();
                    cancel();
                  }}
                >
                  <Square size={13} aria-hidden="true" /> Cancel test
                </button>
              ) : (
                <button
                  key="start"
                  className="packet-primary"
                  type="submit"
                  disabled={
                    availability === "checking" ||
                    availability === "setup-required" ||
                    !!settingsError
                  }
                >
                  <ArrowUpRight size={17} aria-hidden="true" />{" "}
                  {state === "complete"
                    ? "Test again"
                    : "Start packet loss test"}
                </button>
              )}
            </div>
            {availability === "setup-required" && (
              <p className="packet-setup" role="status">
                {messages["setup-required"]} Add the two Metered values to your
                server environment and refresh this page.
              </p>
            )}
          </form>
          <section
            className="packet-results"
            aria-labelledby="packet-results-heading"
          >
            <div className="packet-panel-heading">
              <h2 id="packet-results-heading">
                {result ? "Your results" : "Packet delivery"}
              </h2>
              <span
                className={`packet-status${active ? " is-testing" : ""}`}
                role="status"
              >
                {status}
              </span>
            </div>
            {result?.delivery ? (
              <>
                <div className="packet-loss-hero">
                  <div>
                    <span>Packet loss</span>
                    <p data-result="loss">
                      {result.lossPercent.toFixed(1)}
                      <small>%</small>
                    </p>
                  </div>
                  <p>{lossNote(result.lossPercent)}</p>
                </div>
                <dl className="packet-counters">
                  {[
                    ["Sent", result.sentPackets],
                    ["Received", result.receivedPackets],
                    ["Lost", result.lostPackets],
                    ["Late", result.delivery.latePackets],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
                <div className="packet-delay-results">
                  <div>
                    <span>Average delay</span>
                    <strong>
                      {result.delivery.averageDelayMs.toFixed(1)}{" "}
                      <small>ms</small>
                    </strong>
                  </div>
                  <div>
                    <span>Delay jitter</span>
                    <strong>
                      {result.delivery.jitterMs === null
                        ? "—"
                        : result.delivery.jitterMs.toFixed(1)}{" "}
                      <small>ms</small>
                    </strong>
                  </div>
                  <div>
                    <span>Late messages</span>
                    <strong>
                      {result.delivery.latePercent.toFixed(1)} <small>%</small>
                    </strong>
                  </div>
                </div>
                <PacketDeliveryChart delivery={result.delivery} />
                <p className="packet-result-note">
                  {result.delivery.settings.packetSize} bytes ·{" "}
                  {result.delivery.settings.frequency}/sec ·{" "}
                  {result.delivery.settings.duration} sec · late after{" "}
                  {result.delivery.settings.acceptableDelay} ms
                  {result.delivery.settings.warmup ? " · 2-sec warm-up" : ""}.
                  Delay measures delivery between this browser’s two peers
                  through TURN. Jitter is the mean change between successive
                  received-message delays.
                </p>
                <div className="packet-downloads">
                  <span>
                    <Download size={13} aria-hidden="true" /> Download results
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      try {
                        download("csv");
                        setExportError(null);
                      } catch {
                        setExportError("Couldn’t download results. Try again.");
                      }
                    }}
                  >
                    CSV
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      try {
                        download("json");
                        setExportError(null);
                      } catch {
                        setExportError("Couldn’t download results. Try again.");
                      }
                    }}
                  >
                    JSON
                  </button>
                </div>
                {exportError && (
                  <p className="packet-result-note" role="status">
                    {exportError}
                  </p>
                )}
              </>
            ) : (
              <div className="packet-empty">
                <div
                  className={`packet-orbit${active ? " is-testing" : ""}`}
                  aria-hidden="true"
                >
                  <span />
                  <Radio size={35} strokeWidth={1} />
                </div>
                <h3>
                  {active
                    ? phaseLabels[progress.phase]
                    : state === "unavailable"
                      ? "Couldn’t complete this test"
                      : state === "cancelled"
                        ? "Ready for another try"
                        : "Ready when you are"}
                </h3>
                <p>
                  {message ??
                    (active
                      ? "Keep this tab active while we measure delivery through the relay."
                      : "A separate test. No speed test needed.")}
                </p>
                {active && (
                  <div className="packet-progress" aria-live="off">
                    <progress
                      value={progress.sent}
                      max={progress.total}
                      aria-label="Messages sent"
                    />
                    <dl>
                      <div>
                        <dt>Sent</dt>
                        <dd>
                          {progress.sent} / {progress.total}
                        </dd>
                      </div>
                      <div>
                        <dt>Received</dt>
                        <dd>{progress.received}</dd>
                      </div>
                      <div>
                        <dt>Recording</dt>
                        <dd>
                          {(progress.elapsedMs / 1000).toFixed(1)} /{" "}
                          {progress.durationMs / 1000} s
                        </dd>
                      </div>
                    </dl>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
        <details className="packet-explainer">
          <summary>What does this test measure?</summary>
          <p>
            Unordered WebRTC messages travel from one local browser peer to
            another through Metered TURN over verified UDP, with retransmission
            disabled. Missing messages are lost; received messages above your
            delay threshold are late. They are counted separately. After
            sending, the test allows up to 5 seconds for arrivals.
          </p>
          <p>
            This checks the relay route, not a game server. Message sizes are
            application payloads, not exact wire-packet sizes. The relay path
            does not separate upload loss from download loss. Zero observed loss
            describes this sample and does not guarantee long-term stability.
          </p>
        </details>
      </main>
    </>
  );
}
