import {
  PacketLossError,
  type PacketLossSettings,
} from "../../types/packet-loss";

export const settingLimits = {
  packetSize: { min: 64, max: 1200, step: 1 },
  frequency: { min: 1, max: 60, step: 1 },
  duration: { min: 5, max: 60, step: 1 },
  acceptableDelay: { min: 20, max: 2000, step: 10 },
} as const;

export const testBudgets = {
  measuredMessages: 1800,
  totalMessages: 1920, // Includes at most 120 warm-up messages.
  payloadBytes: 1024 * 1024,
} as const;

export function packetLossBudget(settings: PacketLossSettings) {
  const measuredMessages = settings.frequency * settings.duration;
  const warmupMessages = settings.warmup ? settings.frequency * 2 : 0;
  const totalMessages = measuredMessages + warmupMessages;
  return {
    measuredMessages,
    warmupMessages,
    totalMessages,
    payloadBytes: totalMessages * settings.packetSize,
  };
}

export const packetPresets = {
  quick: {
    label: "Quick",
    settings: {
      packetSize: 212,
      frequency: 10,
      duration: 5,
      acceptableDelay: 200,
      warmup: false,
    },
  },
  default: {
    label: "Default",
    settings: {
      packetSize: 212,
      frequency: 15,
      duration: 10,
      acceptableDelay: 200,
      warmup: false,
    },
  },
  gaming: {
    label: "Gaming",
    settings: {
      packetSize: 256,
      frequency: 60,
      duration: 15,
      acceptableDelay: 100,
      warmup: true,
    },
  },
  voice: {
    label: "Voice call",
    settings: {
      packetSize: 160,
      frequency: 50,
      duration: 15,
      acceptableDelay: 150,
      warmup: true,
    },
  },
  video: {
    label: "Video call",
    settings: {
      packetSize: 1000,
      frequency: 30,
      duration: 15,
      acceptableDelay: 200,
      warmup: true,
    },
  },
  stability: {
    label: "Stability",
    settings: {
      packetSize: 212,
      frequency: 15,
      duration: 60,
      acceptableDelay: 200,
      warmup: true,
    },
  },
} satisfies Record<string, { label: string; settings: PacketLossSettings }>;

export function validatePacketLossSettings(input: unknown): PacketLossSettings {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new PacketLossError("invalid-settings");
  const settings = input as Record<string, unknown>;
  if (
    typeof settings.warmup !== "boolean" ||
    Object.keys(settings).length !== 5
  )
    throw new PacketLossError("invalid-settings");
  for (const [key, limits] of Object.entries(settingLimits)) {
    const value = settings[key];
    if (
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < limits.min ||
      value > limits.max
    )
      throw new PacketLossError("invalid-settings");
  }
  // Whitelist fields rather than retaining unknown internal metadata.
  const validated = {
    packetSize: settings.packetSize as number,
    frequency: settings.frequency as number,
    duration: settings.duration as number,
    acceptableDelay: settings.acceptableDelay as number,
    warmup: settings.warmup,
  };
  const budget = packetLossBudget(validated);
  if (
    budget.measuredMessages > testBudgets.measuredMessages ||
    budget.totalMessages > testBudgets.totalMessages ||
    budget.payloadBytes > testBudgets.payloadBytes
  )
    throw new PacketLossError("invalid-settings");
  return validated;
}
