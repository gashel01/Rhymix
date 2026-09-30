import React, { useEffect, useRef, useState } from "react";
import { fetchPeaks } from "../api";
import useVisible from "../useVisible";

/**
 * One audio waveform, drawn from peaks the backend already computed.
 *
 * Deliberately a canvas and not an SVG: a library page draws a dozen of these
 * at 800 bars each, and that many DOM nodes makes scrolling stutter on the
 * hardware this app targets.
 *
 * `tint` is a CSS custom property name, not a colour. The component reads the
 * resolved value off its own element, so a waveform recoloured by a parent
 * (vocals turning from orange to green when you switch to a converted take)
 * repaints correctly without anyone passing hex around.
 */

const BAR_WIDTH = 2;
const BAR_GAP = 1;

/** Exported so a live recording can draw itself with the same bars, before
 * the backend has ever seen the audio to compute peaks for it. */
export function draw(canvas, peaks, tint, progress) {
  const context = canvas.getContext("2d");
  if (!context) return;

  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!width || !height) return;

  // Only touch width/height when they actually differ — assigning either one
  // clears the canvas and counts as a layout change even if the value is the
  // same, which is half of what keeps a resize loop alive.
  const nextWidth = Math.round(width * ratio);
  const nextHeight = Math.round(height * ratio);
  if (canvas.width !== nextWidth) canvas.width = nextWidth;
  if (canvas.height !== nextHeight) canvas.height = nextHeight;

  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);

  const colour = getComputedStyle(canvas).getPropertyValue(tint).trim() || "#888";
  const step = BAR_WIDTH + BAR_GAP;
  const bars = Math.max(1, Math.floor(width / step));
  const mid = height / 2;
  // Two peak values (min, max) per bucket.
  const buckets = Math.max(1, Math.floor(peaks.length / 2));
  const played = Math.round(bars * Math.min(1, Math.max(0, progress)));

  for (let i = 0; i < bars; i += 1) {
    const bucket = Math.min(buckets - 1, Math.floor((i / bars) * buckets));
    const low = peaks[bucket * 2] || 0;
    const high = peaks[bucket * 2 + 1] || 0;
    // A silent lead-in should still read as a waveform, not as a gap.
    const amplitude = Math.max(Math.abs(low), Math.abs(high), 0.012);
    const barHeight = Math.max(2, amplitude * (height - 4));

    context.globalAlpha = i < played ? 1 : 0.42;
    context.fillStyle = colour;
    context.beginPath();
    context.roundRect(i * step, mid - barHeight / 2, BAR_WIDTH, barHeight, 1);
    context.fill();
  }
  context.globalAlpha = 1;
}

export default function Waveform({ jobId, assetKey, tint = "--accent", progress = 0, className }) {
  const canvasRef = useRef(null);
  const [peaks, setPeaks] = useState(null);
  // Distinct from "hasn't loaded yet" (peaks === null, missing === false): the
  // backend was asked and confirmed there is nothing left on disk to read.
  const [missing, setMissing] = useState(false);
  // A library row draws one or two of these, and a library of twenty rows
  // used to mean forty waveform fetches fired in the same instant the list
  // rendered — most of them for canvases scrolled well out of sight. Nothing
  // requests its peaks until it is about to be seen.
  const visible = useVisible(canvasRef);

  useEffect(() => {
    let cancelled = false;
    setPeaks(null);
    setMissing(false);
    if (!jobId || !assetKey || !visible) return undefined;
    const controller = new AbortController();
    fetchPeaks(jobId, assetKey, controller.signal).then((result) => {
      if (cancelled) return;
      if (result?.missing) setMissing(true);
      else if (result) setPeaks(result.peaks);
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [jobId, assetKey, visible]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !peaks) return undefined;

    const repaint = () => draw(canvas, peaks, tint, progress);
    repaint();

    // Drawing sets canvas.width/height, which is a layout change, which the
    // observer that triggered the draw then sees — "ResizeObserver loop
    // completed with undelivered notifications", and in dev that error puts
    // CRA's overlay over the whole app. Deferring the draw to the next frame
    // takes the mutation out of the callback and ends the loop.
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(repaint);
    };

    // The parent is observed rather than the canvas itself, so resizing the
    // canvas cannot feed back into the thing watching it.
    const observer = new ResizeObserver(schedule);
    if (canvas.parentElement) observer.observe(canvas.parentElement);

    // A theme flip changes what the tint resolves to without re-rendering.
    const themeWatcher = new MutationObserver(schedule);
    themeWatcher.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      themeWatcher.disconnect();
    };
  }, [peaks, tint, progress]);

  return (
    <>
      <canvas
        ref={canvasRef}
        className={className}
        aria-hidden="true"
        data-empty={peaks ? undefined : "true"}
      />
      {missing && <span className="rx-wmissing">File not on disk</span>}
    </>
  );
}
