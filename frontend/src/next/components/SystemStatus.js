import React, { useEffect, useState } from "react";

/**
 * What the machine has left, at the foot of the rail.
 *
 * Permanent rather than tucked into settings because this app lives inside one
 * hard limit: 8 GB of VRAM with a song generator that wants 4.3 of them. When a
 * job refuses to start, this is the first thing worth looking at.
 *
 * VRAM only. Disk was here too, but half a terabyte free never changed a
 * decision — a number nobody acts on is just noise next to the one that
 * matters. The VRAM figure counts every process on the card, not just this
 * one: the engine runs in its own interpreter and its memory is just as
 * unavailable.
 */

// Every other poll in the app stops once nothing is running; this one is
// mounted for the life of the session, so it is the one loop that never
// stops on its own. Reading VRAM means a live torch.cuda.mem_get_info()
// call into the same process the RVC live-inference model shares a CUDA
// context with — on Windows' WDDM driver that GPU round trip is enough to
// stutter whatever else is drawing on the card, YouTube in another tab
// included, even with nothing here actually generating anything. 5s was
// overkill for a number that only needs to be fresh right before starting a
// job; 20s cuts the round trips by 4x, and pausing while the tab is hidden
// (below) cuts them to zero for however long the browser sits in another tab.
const POLL_MS = 20000;
const GB = 1024 ** 3;

const gb = (bytes) => (bytes / GB).toFixed(1);

export default function SystemStatus() {
  const [status, setStatus] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    let timer = null;
    let stopped = false;

    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const response = await fetch("/api/system", { signal: controller.signal });
        if (response.ok && !stopped) setStatus(await response.json());
      } catch (error) {
        // A backend that has gone away is already obvious everywhere else.
      }
      if (!stopped) timer = setTimeout(tick, POLL_MS);
    };
    tick();

    // A hidden tab still fires this timer — Chrome throttles it, not
    // stops it — so the GPU query kept firing while you tabbed away to
    // watch the thing this was making stutter. Reading on visibilitychange
    // instead catches up immediately on return without polling in between.
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (timer) clearTimeout(timer);
      tick();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      stopped = true;
      controller.abort();
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const gpu = status?.gpu;
  const ratio = gpu ? gpu.usedBytes / gpu.totalBytes : 0;

  // The shape is drawn before the first reading lands. Returning null until
  // then made this grow by 40px a second after mount, which is fine at the
  // foot of a rail and wrong inside a menu — the menu had already measured
  // itself to decide whether to open upwards.
  return (
    <div className="rx-sys">
      <div className="rx-sys-row" title={gpu ? gpu.name : "Reading the card…"}>
        <span className="rx-sys-label">VRAM</span>
        <span className="rx-sys-bar" data-hot={ratio > 0.85 ? "" : undefined}>
          <i style={{ width: `${Math.min(100, ratio * 100)}%` }} />
        </span>
        <b>{gpu ? `${gb(gpu.usedBytes)}/${gb(gpu.totalBytes)} GB` : "—"}</b>
      </div>
    </div>
  );
}
