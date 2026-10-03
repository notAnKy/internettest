import {
  PacketLossError,
  type PacketLossResult,
  type PacketDeliverySample,
  type PacketLossSettings,
} from "../../types/packet-loss";

export function packetLossResult(
  sent: number,
  received: number,
  durationMs: number,
): PacketLossResult {
  if (
    !Number.isInteger(sent) ||
    sent <= 0 ||
    !Number.isInteger(received) ||
    received < 0 ||
    received > sent ||
    !Number.isFinite(durationMs) ||
    durationMs < 0
  )
    throw new PacketLossError("connection-failed");
  return {
    status: "complete",
    measurementType: "webrtc-turn-udp",
    sentPackets: sent,
    receivedPackets: received,
    lostPackets: sent - received,
    lossPercent: ((sent - received) / sent) * 100,
    durationMs,
  };
}

export function deliveryStatistics(
  samples: PacketDeliverySample[],
  settings: PacketLossSettings,
): NonNullable<PacketLossResult["delivery"]> {
  const received = samples.filter(
    (sample): sample is PacketDeliverySample & { delayMs: number } =>
      sample.delayMs !== null,
  );
  if (!received.length) throw new PacketLossError("no-delivery");
  if (received.some(({ delayMs }) => !Number.isFinite(delayMs) || delayMs < 0))
    throw new PacketLossError("connection-failed");
  const latePackets = received.filter(
    ({ delayMs }) => delayMs > settings.acceptableDelay,
  ).length;
  const differences = received
    .slice(1)
    .map((sample, index) => Math.abs(sample.delayMs - received[index].delayMs));
  return {
    settings: { ...settings },
    samples,
    latePackets,
    latePercent: (latePackets / samples.length) * 100,
    averageDelayMs:
      received.reduce((sum, sample) => sum + sample.delayMs, 0) /
      received.length,
    jitterMs: differences.length
      ? differences.reduce((sum, delta) => sum + delta, 0) / differences.length
      : null,
  };
}

// Display guidance, not a universal quality score. Cisco's voice guidance aims
// for <1% loss; this short relay delivery sample cannot establish call quality.
// https://www.cisco.com/c/en/us/td/docs/solutions/Enterprise/Branch/BRBranch/BRB_CH2.html
export function lossNote(percent: number) {
  return percent === 0
    ? "No loss observed in this short test."
    : percent < 1
      ? "Some loss observed. This is a short sample."
      : "Loss observed. Real-time applications may be affected.";
}
