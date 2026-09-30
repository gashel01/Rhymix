import React, { useEffect, useRef, useState } from "react";
import { hexToRgba } from "../../utils/color";

const DOWNLOAD_PREFIX = "/api/download/";
const WAVEFORM_PREFIX = "/api/waveform/";
// Song generation assets are addressed by job id + asset key, not by a
// filename resolve_media_path can look up — they never went through
// /api/download/ at all, so the DOWNLOAD_PREFIX swap below always missed
// them and no waveform request was ever made for a generated song's clips.
// The backend's dedicated route for them (waveform.py) sits at the same
// path as the asset's own audio URL with "audio" swapped for "waveform".
const SONGGEN_AUDIO_RE = /\/api\/song-generation\/[^/]+\/audio\/[^/?]+/;

// One entry per asset URL. A timeline shows the same asset across several
// clips, and each of them would otherwise refetch the same peaks.
const peaksCache = new Map();

const loadPeaks = (url) => {
  if (!url) return Promise.resolve(null);
  if (peaksCache.has(url)) return peaksCache.get(url);

  let peaksUrl = null;
  if (SONGGEN_AUDIO_RE.test(url)) {
    peaksUrl = url.replace("/audio/", "/waveform/");
  } else {
    const index = url.indexOf(DOWNLOAD_PREFIX);
    if (index !== -1) {
      peaksUrl = url.slice(0, index) + WAVEFORM_PREFIX + url.slice(index + DOWNLOAD_PREFIX.length);
    }
  }

  if (!peaksUrl) {
    peaksCache.set(url, Promise.resolve(null));
    return peaksCache.get(url);
  }

  const request = fetch(peaksUrl, { headers: { Accept: "application/json" } })
    .then((response) => (response.ok ? response.json() : null))
    .then((data) => {
      if (!Array.isArray(data?.peaks?.[0]) || !Number.isFinite(data?.duration)) return null;
      return { peaks: data.peaks[0], duration: data.duration };
    })
    .catch(() => null);

  peaksCache.set(url, request);
  return request;
};

/**
 * Clip waveform, drawn from precomputed peaks onto a canvas.
 *
 * This used to mount a full WaveSurfer instance — and with it an <audio>
 * element — per clip, purely to draw: playback in the Studio is driven by
 * useStudioPlayback, and this was mounted non-interactive with no controls.
 * A dense arrangement meant dozens of media players doing nothing but render.
 */
const StudioWaveform = ({
  url,
  height = 64,
  color = "#00c2ff",
  /* The clip used to be a dark box with a light waveform floating in it. It is
     now a solid block of the lane's colour with the signal cut out of it in
     darker ink, which is what makes a Suno arrangement readable at a glance —
     so the ink needs to be able to sit heavier than a 0.55 wash. */
  inkAlpha = 0.55,
  clipStartSec = 0,
  pixelsPerSecond,
}) => {
  const canvasRef = useRef(null);
  const [data, setData] = useState(null);

  useEffect(() => {
    let cancelled = false;
    loadPeaks(url).then((result) => {
      if (!cancelled) setData(result);
    });
    return () => {
      cancelled = true;
    };
  }, [url]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return undefined;

    /* Sized from the parent's own width rather than pixelsPerSecond * some
       stored duration, because the parent (.studio-waveform, then
       .studio-clip-wave, then the clip itself) is what the timeline's zoom
       actually resizes — reading pixelsPerSecond directly would drift from
       it the moment any of those boxes had their own padding or a border. */
    const draw = (width) => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      if (!data || !data.peaks.length || !data.duration) return;

      const buckets = Math.floor(data.peaks.length / 2);
      const pxPerSec = Number(pixelsPerSecond) > 0 ? Number(pixelsPerSecond) : width / data.duration;
      const mid = height / 2;

      ctx.fillStyle = hexToRgba(color, inkAlpha) || "rgba(255,255,255,0.5)";

      for (let x = 0; x < width; x += 1) {
        const time = (Number(clipStartSec) || 0) + x / pxPerSec;
        const bucket = Math.floor((time / data.duration) * buckets);
        if (bucket < 0 || bucket >= buckets) continue;

        const low = data.peaks[bucket * 2];
        const high = data.peaks[bucket * 2 + 1];
        const top = mid - Math.max(0, high) * mid;
        const bottom = mid - Math.min(0, low) * mid;
        ctx.fillRect(x, top, 1, Math.max(1, bottom - top));
      }
    };

    draw(Math.max(1, Math.floor(parent.clientWidth || 0)));

    /* Redrawing only when data/color/etc. changed assumed the parent's own
       width was already settled by the time this effect ran — true for a
       prop change (pixelsPerSecond among the deps below triggers this same
       effect), but not for every way the parent's box can change size. A
       ResizeObserver reacts to the box itself instead of guessing which
       props correlate with it. */
    const observer = new ResizeObserver((entries) => {
      const width = Math.max(1, Math.floor(entries[0]?.contentRect?.width || parent.clientWidth || 0));
      draw(width);
    });
    observer.observe(parent);
    return () => observer.disconnect();
  }, [data, height, color, inkAlpha, clipStartSec, pixelsPerSecond]);

  return (
    <div className="studio-waveform" style={{ height }}>
      <canvas ref={canvasRef} style={{ display: "block" }} />
    </div>
  );
};

export default StudioWaveform;
