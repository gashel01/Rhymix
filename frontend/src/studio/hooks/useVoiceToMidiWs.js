import { useCallback, useEffect, useRef, useState } from "react";

const DEFAULT_FRAME_SIZE = 2048;

const getWsUrl = () => {
  const envUrl = process.env.REACT_APP_VOICE_MIDI_WS;
  if (envUrl) return envUrl;
  const host = window.location.hostname || "localhost";
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${host}:8002/ws/voice_to_midi`;
};

export const useVoiceToMidiWs = ({ onFinal } = {}) => {
  const wsRef = useRef(null);
  const mediaRef = useRef({
    stream: null,
    ctx: null,
    node: null,
    source: null,
    mute: null,
    gain: null,
    analyser: null,
    levelData: null,
  });
  const [status, setStatus] = useState("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);
  const [inputLevel, setInputLevel] = useState(0);
  const [inputDb, setInputDb] = useState(-60);
  const [inputClip, setInputClip] = useState(false);
  const sessionRef = useRef(null);
  const inputGainRef = useRef(1);
  const levelRafRef = useRef(null);
  const levelUpdateRef = useRef(0);

  const cleanupAudio = useCallback(async () => {
    const { stream, ctx, node, source, mute, gain } = mediaRef.current;
    try {
      if (node && node.disconnect) node.disconnect();
    } catch {}
    try {
      if (source && source.disconnect) source.disconnect();
    } catch {}
    try {
      if (mute && mute.disconnect) mute.disconnect();
    } catch {}
    try {
      if (gain && gain.disconnect) gain.disconnect();
    } catch {}
    try {
      if (stream) stream.getTracks().forEach((track) => track.stop());
    } catch {}
    try {
      if (ctx && ctx.state !== "closed") await ctx.close();
    } catch {}
    if (levelRafRef.current) {
      cancelAnimationFrame(levelRafRef.current);
      levelRafRef.current = null;
    }
    setInputLevel(0);
    setInputDb(-60);
    setInputClip(false);
    mediaRef.current = {
      stream: null,
      ctx: null,
      node: null,
      source: null,
      mute: null,
      gain: null,
      analyser: null,
      levelData: null,
    };
  }, []);

  const closeWs = useCallback(() => {
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {}
      wsRef.current = null;
    }
  }, []);

  const sendBinary = (buffer) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(buffer);
  };

  const decodeAudioBlob = useCallback(async (blob) => {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const arrayBuffer = await blob.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    const channelCount = audioBuffer.numberOfChannels || 1;
    let samples = audioBuffer.getChannelData(0);
    if (channelCount > 1) {
      const mixed = new Float32Array(audioBuffer.length);
      for (let ch = 0; ch < channelCount; ch += 1) {
        const data = audioBuffer.getChannelData(ch);
        for (let i = 0; i < data.length; i += 1) {
          mixed[i] += data[i] / channelCount;
        }
      }
      samples = mixed;
    }
    const sampleRate = audioBuffer.sampleRate || ctx.sampleRate;
    await ctx.close();
    return { samples, sampleRate };
  }, []);

  const streamSamples = useCallback(async (samples, frameSize, gain = 1) => {
    const frame = new Int16Array(frameSize);
    const total = samples.length;
    for (let offset = 0; offset < total; offset += frameSize) {
      const end = Math.min(total, offset + frameSize);
      frame.fill(0);
      for (let i = offset, j = 0; i < end; i += 1, j += 1) {
        let sample = samples[i] * gain;
        if (sample > 1) sample = 1;
        if (sample < -1) sample = -1;
        frame[j] = Math.round(sample * 32767);
      }
      sendBinary(frame.buffer);
      if (offset % (frameSize * 20) === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
  }, []);

  const setupAudio = useCallback(async (frameSize) => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const source = ctx.createMediaStreamSource(stream);
    const gain = ctx.createGain();
    gain.gain.value = inputGainRef.current || 1;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    const levelData = new Float32Array(analyser.fftSize);
    let node = null;
    let mute = null;

    if (ctx.audioWorklet && window.AudioWorkletNode) {
      try {
        const moduleUrl = new URL("../audio/voiceToMidiWorklet.js", import.meta.url);
        await ctx.audioWorklet.addModule(moduleUrl);
        node = new AudioWorkletNode(ctx, "voice-to-midi-processor", {
          processorOptions: { frameSize },
        });
        node.port.onmessage = (event) => {
          if (event.data) sendBinary(event.data);
        };
        source.connect(gain);
        gain.connect(analyser);
        gain.connect(node);
        mute = ctx.createGain();
        mute.gain.value = 0;
        node.connect(mute).connect(ctx.destination);
      } catch {
        node = null;
      }
    }

    if (!node) {
      const processor = ctx.createScriptProcessor(frameSize, 1, 1);
      processor.onaudioprocess = (event) => {
        const input = event.inputBuffer.getChannelData(0);
        const out = new Int16Array(input.length);
        for (let i = 0; i < input.length; i += 1) {
          let sample = input[i];
          if (sample > 1) sample = 1;
          if (sample < -1) sample = -1;
          out[i] = Math.round(sample * 32767);
        }
        sendBinary(out.buffer);
      };
      source.connect(gain);
      gain.connect(analyser);
      gain.connect(processor);
      mute = ctx.createGain();
      mute.gain.value = 0;
      processor.connect(mute).connect(ctx.destination);
      node = processor;
    }

    const updateLevel = () => {
      if (!mediaRef.current.analyser || !mediaRef.current.levelData) return;
      mediaRef.current.analyser.getFloatTimeDomainData(mediaRef.current.levelData);
      const data = mediaRef.current.levelData;
      let sum = 0;
      let peak = 0;
      for (let i = 0; i < data.length; i += 1) {
        const v = data[i];
        sum += v * v;
        const abs = Math.abs(v);
        if (abs > peak) peak = abs;
      }
      const rms = Math.sqrt(sum / data.length);
      const db = rms > 0 ? 20 * Math.log10(rms) : -120;
      const now = performance.now();
      if (now - levelUpdateRef.current > 40) {
        levelUpdateRef.current = now;
        setInputLevel(Math.min(1, rms * 2.5));
        setInputDb(Math.max(-60, db));
        setInputClip(peak >= 0.98);
      }
      levelRafRef.current = requestAnimationFrame(updateLevel);
    };

    mediaRef.current = { stream, ctx, node, source, mute, gain, analyser, levelData };
    updateLevel();
    return ctx.sampleRate;
  }, []);

  const setInputGain = useCallback((value) => {
    const next = Number(value);
    if (!Number.isFinite(next)) return;
    inputGainRef.current = next;
    if (mediaRef.current.gain) {
      mediaRef.current.gain.gain.value = next;
    }
  }, []);

  const start = useCallback(
    async (config) => {
      setError(null);
      setProgress(0);
      setStatus("connecting");

      try {
        const ws = new WebSocket(getWsUrl());
        ws.binaryType = "arraybuffer";
        wsRef.current = ws;

        const sessionId =
          (crypto && crypto.randomUUID && crypto.randomUUID()) ||
          `session-${Math.random().toString(16).slice(2)}`;
        sessionRef.current = sessionId;

        await new Promise((resolve, reject) => {
          ws.onopen = resolve;
          ws.onerror = () => reject(new Error("WebSocket connection failed"));
        });

        const frameSize = config.frameSize || DEFAULT_FRAME_SIZE;
        const sendStartPayload = (sampleRate) =>
          ws.send(
            JSON.stringify({
              type: "start",
              sessionId,
              mode: config.mode,
              sampleRate,
              frameSize,
              instrument: config.instrument,
              targetBpm: config.targetBpm,
              targetPPQ: config.targetPPQ,
              quantize: config.quantize,
              swing: config.swing || 0,
              key: config.key || null,
              engine: config.engine || null,
              engineStrict: config.engineStrict ?? null,
              projectId: config.projectId || null,
              laneId: config.laneId || null,
              laneName: config.laneName || null,
              insertAtSec: config.insertAtSec ?? null,
              ddspSynth: config.ddspSynth ?? null,
              calibrateLabel: config.calibrateLabel || null,
              calibrateOnly: config.calibrateOnly ?? null,
              enableFormants: config.enableFormants ?? null,
              decodeMode: config.decodeMode ?? null,
              crepeConf: config.crepeConf ?? null,
              crepeStableFrames: config.crepeStableFrames ?? null,
              crepeHangoverFrames: config.crepeHangoverFrames ?? null,
              crepeMinNoteMs: config.crepeMinNoteMs ?? null,
              noteMinMs: config.noteMinMs ?? null,
              noteGapSec: config.noteGapSec ?? null,
              noteMinVelocity: config.noteMinVelocity ?? null,
              returnProcessedAudio: config.returnProcessedAudio ?? null,
              previewOnly: config.previewOnly ?? null,
            })
          );

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === "status") {
              setStatus(data.state);
              setProgress(data.progress ?? 0);
            }
            if (data.type === "error") {
              setStatus("error");
              setError(data.message || "Unknown error");
            }
            if (data.type === "final") {
              setStatus("done");
              setProgress(1);
              onFinal?.(data);
            }
          } catch {}
        };

        ws.onclose = () => {
          setStatus((prev) => (prev === "recording" ? "done" : prev));
        };

        if (config.audioBlob) {
          const { samples, sampleRate } = await decodeAudioBlob(config.audioBlob);
          sendStartPayload(sampleRate);
          await streamSamples(samples, frameSize, inputGainRef.current || 1);
          ws.send(JSON.stringify({ type: "stop" }));
          setStatus("processing");
          return;
        }

        const sampleRate = await setupAudio(frameSize);
        sendStartPayload(sampleRate);
        setStatus("recording");
      } catch (err) {
        setStatus("error");
        setError(err?.message || "Failed to start recording");
        await cleanupAudio();
        closeWs();
      }
    },
    [onFinal, setupAudio, cleanupAudio, closeWs, decodeAudioBlob, streamSamples]
  );

  const stop = useCallback(async () => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "stop" }));
    }
    await cleanupAudio();
  }, [cleanupAudio]);

  const cancel = useCallback(async () => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "cancel" }));
    }
    await cleanupAudio();
    closeWs();
    setStatus("idle");
  }, [cleanupAudio, closeWs]);

  const resetCalibration = useCallback(async () => {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(getWsUrl());
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: "reset_calibration" }));
      };
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "calibration" && data.status === "reset") {
            ws.close();
            resolve(data);
          }
        } catch {
          ws.close();
          resolve(null);
        }
      };
      ws.onerror = () => {
        ws.close();
        reject(new Error("Failed to reset calibration"));
      };
    });
  }, []);

  const trainDrumModel = useCallback(async () => {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(getWsUrl());
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          ws.close();
        } catch {}
        reject(new Error("Training timed out"));
      }, 120000);
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: "train_drum_model" }));
      };
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "drum_model") {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            ws.close();
            resolve(data);
          } else if (data.type === "error") {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            ws.close();
            reject(new Error(data.message || "Training failed"));
          }
        } catch {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          ws.close();
          resolve(null);
        }
      };
      ws.onclose = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(new Error("Training connection closed"));
      };
      ws.onerror = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        ws.close();
        reject(new Error("Failed to train drum model"));
      };
    });
  }, []);

  useEffect(() => {
    return () => {
      cleanupAudio();
      closeWs();
    };
  }, [cleanupAudio, closeWs]);

  return {
    status,
    progress,
    error,
    inputLevel,
    inputDb,
    inputClip,
    start,
    stop,
    cancel,
    resetCalibration,
    trainDrumModel,
    setInputGain,
  };
};
