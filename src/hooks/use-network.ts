"use client";
import { useSyncExternalStore } from "react";
import {
  getConnectionSnapshot,
  serverConnection,
  subscribeConnection,
  type ConnectionInfo,
} from "@/lib/network/connection";
export function useNetwork(): ConnectionInfo {
  return JSON.parse(
    useSyncExternalStore(
      subscribeConnection,
      getConnectionSnapshot,
      () => serverConnection,
    ),
  );
}
