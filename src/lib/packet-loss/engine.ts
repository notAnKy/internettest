// Adapted from @cloudflare/speedtest 1.14.1 PacketLossEngine and
// SelfWebRtcDataConnection (Copyright (c) 2023 Cloudflare, MIT).
// See ./CLOUDFLARE-LICENSE.txt. Upstream has no public disposal API for this
// phase; this adaptation adds cancellation, owned timers, guarded negotiation,
// unique receive counts, and verification of the selected UDP TURN path.
// https://github.com/cloudflare/speedtest/tree/main/src/engines/PacketLossEngine
import {
  PacketLossError,
  type PacketLossResult,
  type PacketLossSettings,
  type PacketLossProgress,
} from "../../types/packet-loss";
import { packetLossResult, deliveryStatistics } from "./statistics";
import { udpIceServers } from "./turn";
import { packetPresets, validatePacketLossSettings } from "./settings";

export const packetConfig = {
  numPackets: 100,
  batchSize: 10,
  batchWaitTime: 10,
  responsesWaitTime: 5000,
  connectionTimeout: 7000,
  timeout: 15000,
} as const;

// Candidate.protocol alone is insufficient: it can be UDP between relays even
// when the browser's TURN allocation uses TCP. Check local relayProtocol too.
export function verifiedUdpRelay(stats: RTCStatsReport): boolean {
  let pairId: string | undefined;
  stats.forEach((entry) => {
    if (entry.type === "transport" && entry.selectedCandidatePairId)
      pairId = entry.selectedCandidatePairId;
  });
  const pair = pairId ? stats.get(pairId) : undefined;
  const local = pair && stats.get(pair.localCandidateId);
  const remote = pair && stats.get(pair.remoteCandidateId);
  return Boolean(
    pair?.state === "succeeded" &&
    local?.candidateType === "relay" &&
    local.protocol === "udp" &&
    local.relayProtocol === "udp" &&
    remote?.candidateType === "relay" &&
    remote.protocol === "udp",
  );
}

export async function measurePacketLoss(
  servers: RTCIceServer[],
  signal: AbortSignal,
  progress: (
    sent: number,
    received: number,
    detail?: PacketLossProgress,
  ) => void = () => {},
  requestedSettings?: PacketLossSettings,
): Promise<PacketLossResult> {
  const settings = requestedSettings
    ? validatePacketLossSettings(requestedSettings)
    : undefined;
  const total = settings
    ? settings.frequency * settings.duration
    : packetConfig.numPackets;
  const warmupMs = settings?.warmup ? 2000 : 0;
  if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
  if (typeof RTCPeerConnection === "undefined")
    throw new PacketLossError("unsupported");
  const iceServers = udpIceServers({ iceServers: servers });
  if (!iceServers.length) throw new PacketLossError("udp-unverified");
  const started = performance.now();
  let sender: RTCPeerConnection | undefined,
    receiver: RTCPeerConnection | undefined;
  let senderDc: RTCDataChannel | undefined,
    receiverDc: RTCDataChannel | undefined;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let active = true;
  const cleanup = () => {
    active = false;
    timers.forEach(clearTimeout);
    timers.clear();
    for (const pc of [sender, receiver])
      if (pc) {
        pc.onicecandidate =
          pc.ondatachannel =
          pc.onconnectionstatechange =
            null;
      }
    for (const dc of [senderDc, receiverDc])
      if (dc) {
        dc.onopen = dc.onclose = dc.onerror = dc.onmessage = null;
        dc.close();
      }
    sender?.close();
    receiver?.close();
  };
  const schedule = (fn: () => void, ms: number) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (active) fn();
    }, ms);
    timers.add(timer);
    return timer;
  };
  let abort = () => {};
  try {
    return await new Promise<PacketLossResult>((resolve, reject) => {
      const fail = (error: Error) => {
        if (active) {
          cleanup();
          reject(error);
        }
      };
      abort = () => fail(new DOMException("Cancelled", "AbortError"));
      signal.addEventListener("abort", abort, { once: true });
      let sent = 0,
        sending = false,
        allSent = false,
        finishing = false;
      const received = new Set<number>();
      const sentAt = new Map<number, number>();
      const delays = new Map<number, number>();
      let phase: PacketLossProgress["phase"] = "connecting";
      let recordingStarted = 0;
      const report = () =>
        progress(
          sent,
          received.size,
          settings
            ? {
                phase,
                total,
                elapsedMs: recordingStarted
                  ? Math.min(
                      settings.duration * 1000,
                      Math.max(0, performance.now() - recordingStarted),
                    )
                  : 0,
                durationMs: settings.duration * 1000,
              }
            : undefined,
        );
      report();
      const verify = async () =>
        Boolean(
          sender &&
          receiver &&
          sender.connectionState === "connected" &&
          receiver.connectionState === "connected" &&
          verifiedUdpRelay(await sender.getStats()) &&
          verifiedUdpRelay(await receiver.getStats()),
        );
      const finish = async () => {
        if (!active || finishing) return;
        finishing = true;
        try {
          if (!(await verify())) throw new PacketLossError("udp-unverified");
          if (!active) return;
          if (!received.size) throw new PacketLossError("no-delivery");
          const result = packetLossResult(
            sent,
            received.size,
            performance.now() - started,
          );
          if (settings)
            result.delivery = deliveryStatistics(
              Array.from({ length: sent }, (_, index) => ({
                sequence: index + 1,
                delayMs: delays.get(index + 1) ?? null,
              })),
              settings,
            );
          cleanup();
          resolve(result);
        } catch (error) {
          fail(
            error instanceof PacketLossError
              ? error
              : new PacketLossError("udp-unverified"),
          );
        }
      };
      const sendBatch = () => {
        if (!active) return;
        try {
          for (
            let n = 0;
            n < packetConfig.batchSize && sent < packetConfig.numPackets;
            n++
          ) {
            senderDc!.send(String(++sent));
          }
          report();
          if (sent < packetConfig.numPackets)
            schedule(sendBatch, packetConfig.batchWaitTime);
          else {
            allSent = true;
            if (received.size === sent) void finish();
            else
              schedule(() => {
                void finish();
              }, packetConfig.responsesWaitTime);
          }
        } catch {
          fail(new PacketLossError("connection-failed"));
        }
      };
      // Keep the legacy short sample for callers without settings. The dedicated
      // page uses individually paced, fixed-size application messages instead.
      const sendPaced = () => {
        if (!active || !settings) return;
        try {
          const sequence = sent + 1;
          const payload = `${sequence}|`.padEnd(settings.packetSize, "x");
          sentAt.set(sequence, performance.now());
          senderDc!.send(payload);
          sent = sequence;
          report();
          if (sent < total) {
            const due = recordingStarted + (sent * 1000) / settings.frequency;
            // A heavily throttled tab cannot provide trustworthy pacing.
            if (performance.now() - due > 1000) {
              fail(new PacketLossError("timeout"));
              return;
            }
            schedule(sendPaced, Math.max(1, due - performance.now()));
          } else {
            schedule(
              () => {
                allSent = true;
                phase = "waiting";
                report();
                if (received.size === sent) void finish();
                else
                  schedule(() => {
                    void finish();
                  }, packetConfig.responsesWaitTime);
              },
              Math.max(
                1,
                recordingStarted + settings.duration * 1000 - performance.now(),
              ),
            );
          }
        } catch {
          fail(new PacketLossError("connection-failed"));
        }
      };
      const startRecording = () => {
        recordingStarted = performance.now();
        phase = "testing";
        report();
        sendPaced();
      };
      const warmup = (start: number, sequence = 1) => {
        if (!active || !settings) return;
        if (performance.now() - start >= warmupMs) {
          startRecording();
          return;
        }
        if (sequence > (settings.frequency * warmupMs) / 1000) {
          schedule(
            startRecording,
            Math.max(1, start + warmupMs - performance.now()),
          );
          return;
        }
        try {
          senderDc!.send(`w${sequence}|`.padEnd(settings.packetSize, "x"));
          schedule(
            () => warmup(start, sequence + 1),
            Math.max(
              1,
              Math.min(
                start + (sequence * 1000) / settings.frequency,
                start + warmupMs,
              ) - performance.now(),
            ),
          );
        } catch {
          fail(new PacketLossError("connection-failed"));
        }
      };
      const begin = async () => {
        if (
          !active ||
          sending ||
          sender?.connectionState !== "connected" ||
          receiver?.connectionState !== "connected" ||
          senderDc?.readyState !== "open" ||
          receiverDc?.readyState !== "open"
        )
          return;
        sending = true;
        try {
          if (!(await verify())) throw new PacketLossError("udp-unverified");
          if (!active) return;
          clearTimeout(connectTimer);
          timers.delete(connectTimer);
          if (!settings) sendBatch();
          else if (warmupMs) {
            phase = "warmup";
            report();
            warmup(performance.now());
          } else startRecording();
        } catch {
          fail(new PacketLossError("udp-unverified"));
        }
      };
      const connectTimer = schedule(
        () => fail(new PacketLossError("connection-failed")),
        packetConfig.connectionTimeout,
      );
      schedule(
        () => fail(new PacketLossError("timeout")),
        settings
          ? packetConfig.connectionTimeout +
              warmupMs +
              settings.duration * 1000 +
              packetConfig.responsesWaitTime +
              2000
          : packetConfig.timeout,
      );
      try {
        sender = new RTCPeerConnection({
          iceServers,
          iceTransportPolicy: "relay",
        });
        receiver = new RTCPeerConnection({
          iceServers,
          iceTransportPolicy: "relay",
        });
        senderDc = sender.createDataChannel("packet-loss", {
          ordered: false,
          maxRetransmits: 0,
        });
        senderDc.onopen = () => {
          void begin();
        };
        senderDc.onclose = senderDc.onerror = () =>
          fail(new PacketLossError("connection-failed"));
        receiver.ondatachannel = ({ channel }) => {
          if (!active) {
            channel.close();
            return;
          }
          receiverDc = channel;
          channel.onopen = () => {
            void begin();
          };
          channel.onclose = channel.onerror = () =>
            fail(new PacketLossError("connection-failed"));
          channel.onmessage = ({ data }) => {
            if (!active || typeof data !== "string") return;
            const match = settings
              ? /^([1-9]\d*)\|x*$/.exec(data)
              : /^([1-9]\d*)$/.exec(data);
            if (!match || (settings && data.length !== settings.packetSize))
              return;
            const n = Number(match[1]);
            if (n > sent || !Number.isSafeInteger(n) || received.has(n)) return;
            if (settings) {
              const timestamp = sentAt.get(n);
              if (timestamp === undefined) return;
              delays.set(n, Math.max(0, performance.now() - timestamp));
            }
            received.add(n);
            report();
            if (allSent && received.size === sent) void finish();
          };
          void begin();
        };
        const pending = new Map<RTCPeerConnection, RTCIceCandidate[]>();
        const addCandidate = (
          target: RTCPeerConnection,
          candidate: RTCIceCandidate,
        ) => {
          void target.addIceCandidate(candidate).catch(() => {
            if (active) fail(new PacketLossError("connection-failed"));
          });
        };
        const flushCandidates = (target: RTCPeerConnection) => {
          if (active)
            for (const candidate of pending.get(target) ?? [])
              addCandidate(target, candidate);
          pending.delete(target);
        };
        const exchange = (
          event: RTCPeerConnectionIceEvent,
          target: RTCPeerConnection,
        ) => {
          if (!active || !event.candidate) return;
          const candidate = event.candidate;
          const protocol =
            candidate.protocol || candidate.candidate.split(" ")[2];
          const type = candidate.type || candidate.candidate.split(" ")[7];
          if (protocol?.toLowerCase() === "udp" && type === "relay") {
            if (target.remoteDescription) addCandidate(target, candidate);
            else
              pending.set(target, [...(pending.get(target) ?? []), candidate]);
          }
        };
        sender.onicecandidate = (event) => exchange(event, receiver!);
        receiver.onicecandidate = (event) => exchange(event, sender!);
        for (const pc of [sender, receiver])
          pc.onconnectionstatechange = () => {
            if (
              ["failed", "disconnected", "closed"].includes(pc.connectionState)
            )
              fail(new PacketLossError("connection-failed"));
            else void begin();
          };
        void (async () => {
          const offer = await sender!.createOffer();
          if (!active) return;
          await sender!.setLocalDescription(offer);
          if (!active) return;
          await receiver!.setRemoteDescription(sender!.localDescription!);
          if (!active) return;
          flushCandidates(receiver!);
          const answer = await receiver!.createAnswer();
          if (!active) return;
          await receiver!.setLocalDescription(answer);
          if (!active) return;
          await sender!.setRemoteDescription(receiver!.localDescription!);
          if (active) flushCandidates(sender!);
        })().catch(() => {
          if (active) fail(new PacketLossError("connection-failed"));
        });
      } catch {
        fail(new PacketLossError("connection-failed"));
      }
    });
  } finally {
    signal.removeEventListener("abort", abort);
    cleanup();
  }
}

export async function runPacketLoss(
  signal: AbortSignal,
  progress?: (
    sent: number,
    received: number,
    detail?: PacketLossProgress,
  ) => void,
  requestedSettings?: PacketLossSettings,
): Promise<PacketLossResult> {
  const settings = requestedSettings
    ? validatePacketLossSettings(requestedSettings)
    : undefined;
  if (typeof RTCPeerConnection === "undefined")
    throw new PacketLossError("unsupported");
  if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, 9000);
  let servers: RTCIceServer[];
  let response: Response;
  try {
    response = await fetch("/api/turn-credentials", {
      method: "POST",
      cache: "no-store",
      headers: {
        "x-internettest-test": "packet-loss",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(settings ?? packetPresets.default.settings),
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.json();
      throw new PacketLossError(
        body.code === "setup-required"
          ? "setup-required"
          : body.code === "invalid-settings"
            ? "invalid-settings"
            : body.code === "request-timeout"
              ? "timeout"
              : "credentials-unavailable",
      );
    }
    servers = udpIceServers(await response.json());
    if (!servers.length) throw new PacketLossError("credentials-unavailable");
  } catch (error) {
    if (signal.aborted || error instanceof PacketLossError) throw error;
    throw new PacketLossError(
      controller.signal.aborted ? "timeout" : "credentials-unavailable",
    );
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
  return measurePacketLoss(servers, signal, progress, settings);
}
