import React, { useEffect, useRef, useState } from "react";

const DOWNLOAD_PREFIX = "/api/download/";
const WAVEFORM_PREFIX = "/api/waveform/";

// One entry per asset URL. A timeline shows the same asset across several
// clips, and each of them would otherwise refetch the same peaks.
const peaksCache = new Map();

const hexToRgba = (hex, alpha) => {
  if (!hex || typeof hex !== "string") return null;
  const trimmed = hex.replace("#", "").trim();
  if (trimmed.length !== 3 && trimmed.length !== 6) return null;
  const full =
    trimmed.length === 3
      ? trimmed
          .split("")
          .map((c) => c + c)
          .join("")
      : trimmed;
  const intVal = Number.parseInt(full, 16);
  if (Number.isNaN(intVal)) return null;
  const r = (intVal >> 16) & 255;
  const g = (intVal >> 8) & 255;
  const b = intVal & 255;
  const a = Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 1;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
};

const loadPeaks = (url) => {
  if (!url) return Promise.resolve(null);
  if (peaksCache.has(url)) return peaksCache.get(url);

  const index = url.indexOf(DOWNLOAD_PREFIX);
  if (index === -1) {
    peaksCache.set(url, Promise.resolve(null));
    return peaksCache.get(url);
  }

  const peaksUrl =
    url.slice(0, index) + WAVEFORM_PREFIX + url.slice(index + DOWNLOAD_PREFIX.length);

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
    if (!canvas) return;

    const parent = canvas.parentElement;
    const width = Math.max(1, Math.floor(parent?.clientWidth || 0));
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
  }, [data, height, color, inkAlpha, clipStartSec, pixelsPerSecond]);

  return (
    <div className="studio-waveform" style={{ height }}>
      <canvas ref={canvasRef} style={{ display: "block" }} />
    </div>
  );
};

export default StudioWaveform;
