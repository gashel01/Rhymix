import React, { useEffect, useRef, useState } from "react";
import useRecorder from "../useRecorder";
import { draw as drawWaveform } from "./Waveform";
import { uploadFiles, deleteSong } from "../api";
import { formatTime } from "../player";
import { toWavBlob } from "../wav";
import "./HumRecorder.css";

/**
 * Hum a few bars straight into the browser — no other app, no file to find
 * afterward. Recording draws itself live with the exact bars a finished
 * track's waveform uses (`Waveform`'s own `draw`), so what you see while
 * humming is not a placeholder standing in for the real thing.
 *
 * Stopping uploads immediately and hands the new source id up through
 * `onReady` — there is nothing left to confirm once you can see and hear
 * what you made, the same way picking a track from the list needs no
 * separate "use this" step. `onUploaded` is a second, lighter callback that
 * just says "a file landed, go re-fetch your list" — the caller's uploads
 * list is in listUploads()'s normalised shape and /api/upload's own response
 * is not the same shape, so folding the raw response straight in was a
 * mismatched field away from a blank, unselectable row.
 */

const MIC = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 2.4a3 3 0 0 1 3 3v6.2a3 3 0 1 1-6 0V5.4a3 3 0 0 1 3-3zm-6.4 9h2a4.4 4.4 0 0 0 8.8 0h2a6.4 6.4 0 0 1-5.4 6.3v2.9h2.4v2H8.6v-2H11v-2.9a6.4 6.4 0 0 1-5.4-6.3z" />
  </svg>
);
const STOP = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </svg>
);
const PLAY = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M8 5.2v13.6c0 .9 1 1.4 1.7.9l10.1-6.8a1.1 1.1 0 0 0 0-1.8L9.7 4.3A1.1 1.1 0 0 0 8 5.2z" />
  </svg>
);
const PAUSE = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <rect x="6" y="4.5" width="4.2" height="15" rx="1.5" />
    <rect x="13.8" y="4.5" width="4.2" height="15" rx="1.5" />
  </svg>
);


/** The canvas alone — live while recording, scrubbable once stopped. */
function RecordingWaveform({ peaks, tint, progress, onSeek }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    let frame = 0;
    const repaint = () => drawWaveform(canvas, peaks.length ? peaks : [0, 0], tint, progress);
    repaint();
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(repaint);
    };
    const observer = new ResizeObserver(schedule);
    if (canvas.parentElement) observer.observe(canvas.parentElement);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [peaks, tint, progress]);

  return (
    <canvas
      ref={canvasRef}
      className="rx-humwave"
      aria-hidden="true"
      data-scrub={onSeek ? "" : undefined}
      onClick={
        onSeek
          ? (event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              onSeek(Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)));
            }
          : undefined
      }
    />
  );
}

export default function HumRecorder({ onReady, onUploaded, onDiscard }) {
  const recorder = useRecorder();
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  // What re-recording has to clean up: the source id a previous take already
  // handed to the parent, so switching takes does not just orphan the file
  // the first one left behind under the very form asking you to replace it.
  const uploadedIdRef = useRef(null);

  // A blob just finished recording is not yet a source anything else in the
  // app can point at — this is what turns it into one, the moment there is
  // one to turn in.
  useEffect(() => {
    if (recorder.state !== "stopped" || !recorder.blob) return;
    let cancelled = false;
    setUploading(true);
    setUploadError(null);
    // MediaRecorder's own output plays back fine right here in the browser,
    // but the backend's waveform peaks are computed with libsndfile, which
    // cannot open webm at all — every upload elsewhere in the app is wav, so
    // this is what made the recording it just made 500 the moment its own
    // row tried to draw a waveform for it.
    toWavBlob(recorder.blob)
      .then((wavBlob) => uploadFiles([new File([wavBlob], `hum-${Date.now()}.wav`, { type: "audio/wav" })]))
      .then((added) => {
        if (cancelled) return;
        const upload = added[0];
        const id = upload && (upload.fileId || upload.id);
        if (!id) throw new Error("Upload finished without a file id.");
        uploadedIdRef.current = `upload:${id}`;
        // The response here is /api/upload's own shape, not the normalised
        // one listUploads() produces for everywhere else the app reads an
        // upload from — passing it straight into a list of those mismatched
        // a field name and showed up as a blank, unclickable "?" row. A
        // signal to go re-fetch costs one request and is never wrong.
        if (onUploaded) onUploaded();
        if (onReady) onReady(`upload:${id}`, upload.name || upload.originalName || "Your hum");
      })
      .catch((error) => {
        if (!cancelled) setUploadError(error.message || "Could not upload the recording.");
      })
      .finally(() => {
        if (!cancelled) setUploading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorder.state, recorder.blob]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;
    const onTime = () => setProgress(audio.duration ? audio.currentTime / audio.duration : 0);
    const onEnd = () => {
      setPlaying(false);
      setProgress(0);
    };
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("ended", onEnd);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("ended", onEnd);
    };
  }, [recorder.url]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) audio.pause();
    else audio.play();
    setPlaying(!playing);
  };

  const seek = (ratio) => {
    const audio = audioRef.current;
    if (!audio || !audio.duration) return;
    audio.currentTime = ratio * audio.duration;
    setProgress(ratio);
  };

  const reRecord = () => {
    setPlaying(false);
    setProgress(0);
    setUploadError(null);
    if (uploadedIdRef.current) {
      deleteSong(uploadedIdRef.current).catch(() => {
        // Best-effort — an orphaned import is a smaller problem than
        // blocking the retake on a delete that failed.
      });
      uploadedIdRef.current = null;
      if (onDiscard) onDiscard();
    }
    recorder.reset();
  };

  if (recorder.state === "idle" || recorder.state === "requesting") {
    return (
      <div className="rx-humrec" data-state={recorder.state}>
        <button
          type="button"
          className="rx-humrec-btn"
          onClick={recorder.start}
          disabled={recorder.state === "requesting"}
        >
          {recorder.state === "requesting" ? <span className="spinner" /> : MIC}
        </button>
        <span className="hint">
          {recorder.state === "requesting"
            ? "Waiting for microphone access…"
            : "Hum a few bars — Rhymix arranges the rest."}
        </span>
      </div>
    );
  }

  if (recorder.state === "error") {
    return (
      <div className="rx-humrec" data-state="error">
        <button type="button" className="rx-humrec-btn" onClick={recorder.start}>
          {MIC}
        </button>
        <span className="hint rx-humrec-error">{recorder.error} Try again?</span>
      </div>
    );
  }

  if (recorder.state === "recording") {
    return (
      <div className="rx-humrec" data-state="recording">
        <div className="rx-humrec-live">
          <span className="rx-humrec-dot" />
          <RecordingWaveform peaks={recorder.peaks} tint="--vox" progress={1} />
          <span className="rx-humrec-clock">{formatTime(recorder.elapsedMs / 1000)}</span>
        </div>
        <button type="button" className="rx-humrec-btn rx-humrec-stop" onClick={recorder.stop}>
          {STOP}
        </button>
      </div>
    );
  }

  // "stopped" — recorded, uploading or already uploaded, playable either way.
  return (
    <div className="rx-humrec" data-state="stopped">
      <audio ref={audioRef} src={recorder.url} preload="auto" />
      <div className="rx-humrec-live">
        <button type="button" className="rx-humrec-play" onClick={togglePlay} aria-label={playing ? "Pause" : "Play"}>
          {playing ? PAUSE : PLAY}
        </button>
        <RecordingWaveform peaks={recorder.peaks} tint="--vox" progress={progress} onSeek={seek} />
        <span className="rx-humrec-clock">{formatTime(recorder.elapsedMs / 1000)}</span>
      </div>
      <div className="rx-humrec-foot">
        {uploading && (
          <span className="hint">
            <span className="spinner" /> Saving your hum…
          </span>
        )}
        {uploadError && <span className="hint rx-humrec-error">{uploadError}</span>}
        {!uploading && !uploadError && <span className="hint">Saved — it&rsquo;s the track this will build on.</span>}
        <button type="button" className="btn sm" onClick={reRecord}>
          Re-record
        </button>
      </div>
    </div>
  );
}
