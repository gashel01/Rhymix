import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export function useMicrophoneRecorder() {
  const streamRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const stopTimerRef = useRef(null);
  const rafRef = useRef(null);

  const analyserCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const levelDataRef = useRef(null);

  const [state, setState] = useState("idle");
  const [error, setError] = useState(null);
  const [level, setLevel] = useState(0);
  const [db, setDb] = useState(-60);
  const [clip, setClip] = useState(false);
  const [blob, setBlob] = useState(null);

  const cleanup = useCallback(async () => {
    if (stopTimerRef.current) {
      window.clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (analyserCtxRef.current) {
      try {
        await analyserCtxRef.current.close();
      } catch (_err) {}
      analyserCtxRef.current = null;
    }
    analyserRef.current = null;
    levelDataRef.current = null;
    recorderRef.current = null;
  }, []);

  const updateMeter = useCallback(() => {
    const analyser = analyserRef.current;
    const arr = levelDataRef.current;
    if (!analyser || !arr) return;

    analyser.getFloatTimeDomainData(arr);
    let sum = 0;
    let peak = 0;
    for (let i = 0; i < arr.length; i += 1) {
      const v = arr[i];
      sum += v * v;
      const abs = Math.abs(v);
      if (abs > peak) peak = abs;
    }
    const rms = Math.sqrt(sum / arr.length);
    const nextDb = rms > 0 ? 20 * Math.log10(rms) : -120;
    setLevel(Math.min(1, rms * 3));
    setDb(Math.max(-60, nextDb));
    setClip(peak >= 0.98);
    rafRef.current = requestAnimationFrame(updateMeter);
  }, []);

  const requestMic = useCallback(async () => {
    if (streamRef.current) return streamRef.current;
    setState("requesting");
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioCtx();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
    analyserCtxRef.current = ctx;
    analyserRef.current = analyser;
    levelDataRef.current = new Float32Array(analyser.fftSize);
    return stream;
  }, []);

  const start = useCallback(
    async (durationSec = 8) => {
      setError(null);
      setBlob(null);
      chunksRef.current = [];
      try {
        const stream = await requestMic();
        const options = {};
        if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
          options.mimeType = "audio/webm;codecs=opus";
        }
        const recorder = new MediaRecorder(stream, options);
        recorderRef.current = recorder;
        recorder.ondataavailable = (ev) => {
          if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data);
        };
        recorder.onerror = () => {
          setState("error");
          setError("Recorder failed.");
        };
        recorder.onstop = () => {
          const out = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
          setBlob(out);
          setState("stopped");
        };
        recorder.start();
        setState("recording");
        updateMeter();
        stopTimerRef.current = window.setTimeout(() => {
          if (recorderRef.current && recorderRef.current.state === "recording") {
            recorderRef.current.stop();
          }
        }, Math.max(1000, durationSec * 1000));
      } catch (err) {
        setState("error");
        setError(err?.message || "Microphone permission failed.");
      }
    },
    [requestMic, updateMeter]
  );

  const stop = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state === "recording") {
      recorderRef.current.stop();
    }
  }, []);

  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  return useMemo(
    () => ({
      state,
      error,
      level,
      db,
      clip,
      blob,
      start,
      stop,
      requestMic,
      cleanup,
    }),
    [state, error, level, db, clip, blob, start, stop, requestMic, cleanup]
  );
}
