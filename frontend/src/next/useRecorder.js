import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A hum, recorded straight into the browser.
 *
 * Before this, humming a melody meant recording it in some other app first
 * and importing the file — an extra round trip for the one mode where what
 * you actually have is your own voice, right now. `peaks` grows live, in the
 * same [min, max, min, max, ...] shape the backend's own waveform endpoints
 * already use, so the exact same drawing code (Waveform's exported `draw`)
 * renders it — a hum looks like every other waveform in the app, live or not.
 *
 * States: idle → requesting (mic permission) → recording → stopped, or error
 * at any point the microphone refuses. `reset()` discards and returns to
 * idle; nothing here uploads anything — that is the caller's job once it has
 * a blob it is happy with.
 */

const BUCKET_MS = 60;
// A safety ceiling, not a target — "a few bars" is the pitch, and a forgotten
// recording should stop on its own well before it becomes an unusable file.
const MAX_SECONDS = 120;

export default function useRecorder() {
  const streamRef = useRef(null);
  const ctxRef = useRef(null);
  const analyserRef = useRef(null);
  const dataRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const rafRef = useRef(null);
  const startedAtRef = useRef(0);
  const bucketRef = useRef({ min: 0, max: 0, since: 0 });

  const [state, setState] = useState("idle");
  const [error, setError] = useState(null);
  const [peaks, setPeaks] = useState([]);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [blob, setBlob] = useState(null);
  const [url, setUrl] = useState(null);

  const teardownStream = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (ctxRef.current) {
      ctxRef.current.close().catch(() => {});
      ctxRef.current = null;
    }
    analyserRef.current = null;
    dataRef.current = null;
  }, []);

  const tick = useCallback(() => {
    const analyser = analyserRef.current;
    const data = dataRef.current;
    if (!analyser || !data) return;
    analyser.getFloatTimeDomainData(data);
    let min = 0;
    let max = 0;
    for (let i = 0; i < data.length; i += 1) {
      const value = data[i];
      if (value < min) min = value;
      if (value > max) max = value;
    }
    const bucket = bucketRef.current;
    bucket.min = Math.min(bucket.min, min);
    bucket.max = Math.max(bucket.max, max);

    const now = performance.now();
    if (now - bucket.since >= BUCKET_MS) {
      const { min: bMin, max: bMax } = bucket;
      setPeaks((prev) => [...prev, bMin, bMax]);
      bucket.min = 0;
      bucket.max = 0;
      bucket.since = now;
    }
    setElapsedMs(now - startedAtRef.current);

    if ((now - startedAtRef.current) / 1000 >= MAX_SECONDS) {
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.stop();
      }
      return;
    }
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setBlob(null);
    setUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setPeaks([]);
    setElapsedMs(0);
    chunksRef.current = [];
    setState("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtx();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      ctxRef.current = ctx;
      analyserRef.current = analyser;
      dataRef.current = new Float32Array(analyser.fftSize);

      const options = {};
      if (window.MediaRecorder?.isTypeSupported?.("audio/webm;codecs=opus")) {
        options.mimeType = "audio/webm;codecs=opus";
      }
      const recorder = new MediaRecorder(stream, options);
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        setError("Recording failed partway through.");
        setState("error");
        teardownStream();
      };
      recorder.onstop = () => {
        const outBlob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        setBlob(outBlob);
        setUrl(URL.createObjectURL(outBlob));
        setState("stopped");
        teardownStream();
      };

      const now = performance.now();
      startedAtRef.current = now;
      bucketRef.current = { min: 0, max: 0, since: now };
      recorder.start();
      setState("recording");
      rafRef.current = requestAnimationFrame(tick);
    } catch (err) {
      setError(
        err?.name === "NotAllowedError"
          ? "Microphone access was denied."
          : err?.message || "Could not reach the microphone."
      );
      setState("error");
      teardownStream();
    }
  }, [tick, teardownStream]);

  const stop = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
  }, []);

  const reset = useCallback(() => {
    teardownStream();
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      try {
        recorderRef.current.stop();
      } catch (_err) {
        // Already stopping — the state reset below still applies.
      }
    }
    recorderRef.current = null;
    setUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setBlob(null);
    setPeaks([]);
    setElapsedMs(0);
    setError(null);
    setState("idle");
  }, [teardownStream]);

  useEffect(
    () => () => {
      teardownStream();
      setUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    },
    // Empty deps deliberately — this only ever runs once, on unmount; the
    // inner setUrl(prev => ...) reads the latest ref-backed value without
    // needing `url` itself as a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  return { state, error, peaks, elapsedMs, blob, url, start, stop, reset };
}
