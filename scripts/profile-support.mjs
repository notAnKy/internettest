export async function installProfile(page) {
  await page.addInitScript(() => {
    globalThis.testProfile = {
      commits: 0,
      renders: {},
      longTasks: [],
      numericUpdates: [],
      stages: [],
      targets: [],
      rafScheduled: 0,
      rafExecuted: 0,
      rafPending: 0,
    };
    const requestFrame = window.requestAnimationFrame.bind(window);
    const cancelFrame = window.cancelAnimationFrame.bind(window);
    const pending = new Set();
    window.requestAnimationFrame = (callback) => {
      if (globalThis.testProfile.recording)
        globalThis.testProfile.rafScheduled++;
      const id = requestFrame((time) => {
        pending.delete(id);
        globalThis.testProfile.rafPending = pending.size;
        if (globalThis.testProfile.recording)
          globalThis.testProfile.rafExecuted++;
        callback(time);
      });
      pending.add(id);
      globalThis.testProfile.rafPending = pending.size;
      return id;
    };
    window.cancelAnimationFrame = (id) => {
      pending.delete(id);
      globalThis.testProfile.rafPending = pending.size;
      cancelFrame(id);
    };
    globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      supportsFiber: true,
      inject: () => 1,
      onCommitFiberRoot: (_id, root) => {
        const profile = globalThis.testProfile;
        if (!profile.recording) return;
        profile.commits++;
        const visit = (fiber) => {
          if (!fiber) return;
          const type = fiber.type?.type ?? fiber.type;
          if (typeof type === "function" && fiber.flags & 1) {
            const name = type.displayName || type.name || "Anonymous";
            profile.renders[name] = (profile.renders[name] ?? 0) + 1;
          }
          visit(fiber.child);
          visit(fiber.sibling);
        };
        visit(root.current);
      },
      onCommitFiberUnmount() {},
      onPostCommitFiberRoot() {},
    };
    new PerformanceObserver((list) => {
      if (globalThis.testProfile.recording)
        globalThis.testProfile.longTasks.push(
          ...list
            .getEntries()
            .map((e) => ({ duration: e.duration, start: e.startTime })),
        );
    }).observe({ type: "longtask", buffered: true });
    addEventListener("DOMContentLoaded", () => {
      let lastTarget = "",
        last = "",
        stage = "";
      new MutationObserver(() => {
        const p = globalThis.testProfile;
        if (!p.recording) return;
        const el = document.querySelector(
          "[data-animated-value], .reading-number",
        );
        const value = el?.textContent ?? "";
        const target = el?.dataset.target ?? "";
        const targetKey = `${document.querySelector("#test-status")?.textContent}:${target}`;
        if (targetKey !== lastTarget && target !== "") {
          p.targets.push({
            time: performance.now(),
            value: Number(target),
            stage: document.querySelector("#test-status")?.textContent,
          });
          lastTarget = targetKey;
        }
        if (value !== last) {
          p.numericUpdates.push({
            time: performance.now(),
            value,
            target: el?.dataset.target ?? null,
            stage: document.querySelector("#test-status")?.textContent,
          });
          last = value;
        }
        const nextStage = document.querySelector("#test-status")?.textContent;
        if (nextStage !== stage) {
          p.stages.push({ time: performance.now(), stage: nextStage });
          stage = nextStage;
        }
      }).observe(document, {
        subtree: true,
        characterData: true,
        childList: true,
        attributes: true,
        attributeFilter: ["data-target"],
      });
    });
  });
}

export function summarizeCpu(profile) {
  const nodes = new Map(profile.nodes.map((n) => [n.id, n.callFrame]));
  const times = new Map();
  (profile.samples ?? []).forEach((id, i) =>
    times.set(id, (times.get(id) ?? 0) + (profile.timeDeltas?.[i] ?? 0)),
  );
  return [...times]
    .map(([id, us]) => ({
      function: nodes.get(id)?.functionName || "anonymous",
      url: nodes.get(id)?.url,
      sampledMs: +(us / 1000).toFixed(1),
    }))
    .sort((a, b) => b.sampledMs - a.sampledMs)
    .filter((n) => n.function !== "(idle)")
    .slice(0, 15);
}
