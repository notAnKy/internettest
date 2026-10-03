"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { SpeedTestEngine } from "@/lib/speedtest/engine";
import { localResultStore } from "@/lib/speedtest/storage";
export function useSpeedTest() {
  const [engine] = useState(() => new SpeedTestEngine());
  const snapshot = useSyncExternalStore(
    engine.subscribe,
    engine.getSnapshot,
    engine.getSnapshot,
  );
  useEffect(() => {
    const offline = () => engine.handleOffline();
    const pagehide = () => engine.cancel();
    window.addEventListener("offline", offline);
    window.addEventListener("pagehide", pagehide);
    return () => {
      window.removeEventListener("offline", offline);
      window.removeEventListener("pagehide", pagehide);
      engine.dispose();
    };
  }, [engine]);
  useEffect(() => {
    if (snapshot.result) localResultStore.save(snapshot.result);
  }, [snapshot.result]);
  return {
    snapshot,
    start: () => void engine.start(),
    cancel: () => engine.cancel(),
  };
}
