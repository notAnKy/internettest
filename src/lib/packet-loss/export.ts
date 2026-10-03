import type { PacketLossResult } from "../../types/packet-loss";
import { PacketLossError } from "../../types/packet-loss";
import { validatePacketLossSettings } from "./settings";
import { packetLossResult, deliveryStatistics } from "./statistics";

// Rebuild from explicit diagnostic fields. Never serialize arbitrary additions,
// ICE configuration, or credentials attached to an in-memory result object.
export function exportPacketLoss(
  result: PacketLossResult,
  format: "json" | "csv",
  now = new Date(),
) {
  if (!result.delivery) throw new PacketLossError("no-delivery");
  const { packetSize, frequency, duration, acceptableDelay, warmup } =
    result.delivery.settings;
  const settings = validatePacketLossSettings({
    packetSize,
    frequency,
    duration,
    acceptableDelay,
    warmup,
  });
  const samples = result.delivery.samples.map(
    ({ sequence, delayMs }, index) => {
      if (
        sequence !== index + 1 ||
        (delayMs !== null &&
          (typeof delayMs !== "number" ||
            !Number.isFinite(delayMs) ||
            delayMs < 0))
      )
        throw new PacketLossError("connection-failed");
      return { sequence, delayMs };
    },
  );
  if (
    samples.length !== settings.frequency * settings.duration ||
    samples.length !== result.sentPackets ||
    samples.filter((sample) => sample.delayMs !== null).length !==
      result.receivedPackets
  )
    throw new PacketLossError("connection-failed");
  const diagnostic = {
    exportedAt: now.toISOString(),
    ...packetLossResult(
      result.sentPackets,
      result.receivedPackets,
      result.durationMs,
    ),
    delivery: deliveryStatistics(samples, settings),
  };
  return {
    filename: `internettest-packet-loss-${now.toISOString().slice(0, 10)}.${format}`,
    mimeType: format === "json" ? "application/json" : "text/csv;charset=utf-8",
    text:
      format === "json"
        ? JSON.stringify(diagnostic, null, 2)
        : [
            "sequence,delay_ms,status",
            ...samples.map(
              ({ sequence, delayMs }) =>
                `${sequence},${delayMs ?? ""},${delayMs === null ? "lost" : delayMs > acceptableDelay ? "late" : "received"}`,
            ),
          ].join("\n"),
  };
}
