import { useCallback, useEffect, useRef, useState } from "react";

const DEFAULT_FRAME_SIZE = 2048;
const OUTPUT_SAMPLE_RATE = 48000;

const getWsUrl = () => {
  const envUrl = process.env.REACT_APP_STUDIO_LIVE_INFER_WS;
  if (envUrl) return envUrl;
  const host = window.location.hostname || "localhost";
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${host}:8002/ws/studio_live_infer`;
};

export const useStudioLiveInferenceWs = ({ onCommitted } = {}) => {
  const wsRef = useRef(null);
  const dryCaptureRef = useRef({
    chunks: [],
    sampleRate: 0,
  });
  const mediaRef = useRef({
    stream: null,
    ctx: null,
    node: null,
    captureNode: null,
    captureMute: null,
    source: null,
    mute: null,
    gain: null,
    analyser: null,
    levelData: null,
    monitorGain: null,
    playbackTime: 0,
  });
  const [status, setStatus] = useState("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);
  const [latencyMs, setLatencyMs] = useState(0);
  const [inputLevel, setInputLevel] = useState(0);
  const [inputDb, setInputDb] = useState(-60);
  const [inputClip, setInputClip] = useState(false);
  const [micMonitor, setMicMonitor] = useState(false);
  const inputGainRef = useRef(1);
  const monitorGainRef = useRef(1);
  const micMonitorGainRef = useRef(1);
  /* Mirrored into a ref so setupAudio reads the value at the moment it runs
     rather than the one captured when the callback was built. Listing the
     state directly would rebuild setupAudio — and the connect callback that
     depends on it — every time the monitor is toggled. */
  const micMonitorRef = useRef(false);
  const levelRafRef = useRef(null);
  const levelUpdateRef = useRef(0);

  const closeWs = useCallback(() => {
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {}
      wsRef.current = null;
    }
  }, []);

  const cleanupInput = useCallback(async () => {
    const { stream, node, captureNode, captureMute, source, mute, gain } = mediaRef.current;
    try {
      if (node && node.disconnect) node.disconnect();
    } catch {}
    try {
      if (captureNode && captureNode.disconnect) captureNode.disconnect();
    } catch {}
    try {
      if (captureMute && captureMute.disconnect) captureMute.disconnect();
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
    mediaRef.current.stream = null;
    mediaRef.current.node = null;
    mediaRef.current.captureNode = null;
    mediaRef.current.captureMute = null;
    mediaRef.current.source = null;
    mediaRef.current.mute = null;
    mediaRef.current.gain = null;
    mediaRef.current.analyser = null;
    mediaRef.current.levelData = null;
    if (levelRafRef.current) {
      cancelAnimationFrame(levelRafRef.current);
      levelRafRef.current = null;
    }
    setInputLevel(0);
    setInputDb(-60);
    setInputClip(false);
  }, []);

  const cleanupAll = useCallback(async () => {
    const { ctx, monitorGain } = mediaRef.current;
    await cleanupInput();
    try {
      if (monitorGain && monitorGain.disconnect) monitorGain.disconnect();
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
      captureNode: null,
      captureMute: null,
      source: null,
      mute: null,
      gain: null,
      analyser: null,
      levelData: null,
      monitorGain: null,
      playbackTime: 0,
    };
    closeWs();
  }, [cleanupInput, closeWs]);

  const sendBinary = useCallback((buffer) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(buffer);
  }, []);

  const appendDryCapture = useCallback((samples) => {
    if (!samples?.length) return;
    const copy = new Float32Array(samples.length);
    copy.set(samples);
    dryCaptureRef.current.chunks.push(copy);
  }, []);

  const encodeWav = useCallback((chunks, sampleRate) => {
    const totalSamples = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    if (!totalSamples || !sampleRate) return null;
    const buffer = new ArrayBuffer(44 + totalSamples * 2);
    const view = new DataView(buffer);
    const writeString = (offset, value) => {
      for (let i = 0; i < value.length; i += 1) {
        view.setUint8(offset + i, value.charCodeAt(i));
      }
    };
    writeString(0, "RIFF");
    view.setUint32(4, 36 + totalSamples * 2, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, "data");
    view.setUint32(40, totalSamples * 2, true);
    let offset = 44;
    chunks.forEach((chunk) => {
      for (let i = 0; i < chunk.length; i += 1) {
        const sample = Math.max(-1, Math.min(1, chunk[i]));
        view.setInt16(offset, sample < 0 ? sample * 32768 : sample * 32767, true);
        offset += 2;
      }
    });
    return buffer;
  }, []);

  const uploadDryRecording = useCallback(async () => {
    const ws = wsRef.current;
    const { chunks, sampleRate } = dryCaptureRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || !chunks.length || !sampleRate) return;
    const wavBuffer = encodeWav(chunks, sampleRate);
    dryCaptureRef.current = { chunks: [], sampleRate: 0 };
    if (!wavBuffer) return;
    ws.send(JSON.stringify({ type: "full_dry_audio_begin", sampleRate, format: "wav" }));
    ws.send(wavBuffer);
    await new Promise((resolve) => {
      const poll = () => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN || wsRef.current.bufferedAmount < 65536) {
          resolve();
          return;
        }
        setTimeout(poll, 20);
      };
      poll();
    });
  }, [encodeWav]);

  const schedulePlayback = useCallback((arrayBuffer) => {
    const ctx = mediaRef.current.ctx;
    const monitorGain = mediaRef.current.monitorGain;
    if (!ctx || !monitorGain) return;
    const pcm = new Int16Array(arrayBuffer);
    if (!pcm.length) return;
    const samples = new Float32Array(pcm.length);
    for (let i = 0; i < pcm.length; i += 1) {
      samples[i] = pcm[i] / 32768;
    }
    const audioBuffer = ctx.createBuffer(1, samples.length, OUTPUT_SAMPLE_RATE);
    audioBuffer.copyToChannel(samples, 0);
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(monitorGain);
    const safetyLead = 0.035;
    const now = ctx.currentTime + safetyLead;
    const queued = mediaRef.current.playbackTime || now;
    const startAt = Math.max(now, queued);
    if (startAt - ctx.currentTime > 0.18) {
      mediaRef.current.playbackTime = now;
    }
    const effectiveStart = Math.max(now, mediaRef.current.playbackTime || now);
    source.start(effectiveStart);
    mediaRef.current.playbackTime = effectiveStart + audioBuffer.duration;
  }, []);

  const setupAudio = useCallback(async (frameSize) => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: OUTPUT_SAMPLE_RATE,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    const ctx = new (window.AudioContext || window.webkitAudioContext)({
      latencyHint: "interactive",
      sampleRate: OUTPUT_SAMPLE_RATE,
    });
    if (ctx.state === "suspended") {
      await ctx.resume();
    }
    const source = ctx.createMediaStreamSource(stream);
    const gain = ctx.createGain();
    gain.gain.value = inputGainRef.current || 1;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    const levelData = new Float32Array(analyser.fftSize);
    const monitorGain = ctx.createGain();
    monitorGain.gain.value = monitorGainRef.current || 1;
    monitorGain.connect(ctx.destination);
    let node = null;
    let captureNode = null;
    let captureMute = null;
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

    captureNode = ctx.createScriptProcessor(4096, 1, 1);
    captureNode.onaudioprocess = (event) => {
      appendDryCapture(event.inputBuffer.getChannelData(0));
    };
    captureMute = ctx.createGain();
    captureMute.gain.value = micMonitorRef.current ? (micMonitorGainRef.current || 1) : 0;
    gain.connect(captureNode);
    captureNode.connect(captureMute).connect(ctx.destination);

    const updateLevel = () => {
      if (!mediaRef.current.analyser || !mediaRef.current.levelData) return;
      mediaRef.current.analyser.getFloatTimeDomainData(mediaRef.current.levelData);
      const data = mediaRef.current.levelData;
      let sum = 0;
      let peak = 0;
      for (let i = 0; i < data.length; i += 1) {
        const value = data[i];
        sum += value * value;
        const abs = Math.abs(value);
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

    mediaRef.current = {
      stream,
      ctx,
      node,
      captureNode,
      captureMute,
      source,
      mute,
      gain,
      analyser,
      levelData,
      monitorGain,
      playbackTime: ctx.currentTime + 0.04,
    };
    updateLevel();
    dryCaptureRef.current = {
      chunks: [],
      sampleRate: ctx.sampleRate,
    };
    return ctx.sampleRate;
  }, [appendDryCapture, sendBinary]);

  useEffect(() => {
    micMonitorRef.current = micMonitor;
  }, [micMonitor]);

  const setInputGain = useCallback((value) => {
    const next = Number(value);
    if (!Number.isFinite(next)) return;
    inputGainRef.current = next;
    if (mediaRef.current.gain) {
      mediaRef.current.gain.gain.value = next;
    }
  }, []);

  const setMonitorGain = useCallback((value) => {
    const next = Number(value);
    if (!Number.isFinite(next)) return;
    monitorGainRef.current = next;
    if (mediaRef.current.monitorGain) {
      mediaRef.current.monitorGain.gain.value = next;
    }
  }, []);

  const toggleMicMonitor = useCallback((enabled, gainValue = 1) => {
    setMicMonitor(enabled);
    micMonitorGainRef.current = gainValue;
    if (mediaRef.current.captureMute) {
      mediaRef.current.captureMute.gain.value = enabled ? gainValue : 0;
    }
  }, []);

  const start = useCallback(async (config) => {
    setError(null);
    setProgress(0);
    setLatencyMs(0);
    setStatus("connecting");
    try {
      const wsUrl = getWsUrl();
      const ws = new WebSocket(wsUrl);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      await new Promise((resolve, reject) => {
        ws.onopen = resolve;
        ws.onerror = () => reject(new Error(`WebSocket connection failed: ${wsUrl}`));
      });

      ws.onmessage = async (event) => {
        if (typeof event.data === "string") {
          try {
            const data = JSON.parse(event.data);
            if (data.type === "status") {
              setStatus(data.state || "processing");
              setProgress(data.progress ?? 0);
            } else if (data.type === "metrics") {
              setLatencyMs(Number(data.latencyMs) || 0);
            } else if (data.type === "error") {
              setStatus("error");
              setError(data.message || "Unknown error");
              await cleanupAll();
            } else if (data.type === "final") {
              setStatus("done");
              setProgress(1);
              onCommitted?.(data.commit || null);
              await cleanupAll();
            }
          } catch {}
          return;
        }
        const arrayBuffer = event.data instanceof Blob ? await event.data.arrayBuffer() : event.data;
        if (arrayBuffer) {
          schedulePlayback(arrayBuffer);
        }
      };

      ws.onclose = () => {
        setStatus((prev) => (prev === "recording" || prev === "processing" ? "done" : prev));
      };

      const frameSize = config.frameSize || DEFAULT_FRAME_SIZE;
      const sampleRate = await setupAudio(frameSize);
      ws.send(
        JSON.stringify({
          type: "start",
          projectId: config.projectId || null,
          laneId: config.laneId || null,
          insertAtSec: config.insertAtSec ?? 0,
          frameSize,
          sampleRate,
          lowLatencyMonitor: config.lowLatencyMonitor ?? true,
          maxQueueChunks: config.maxQueueChunks ?? 6,
          monitorChunkSamples: config.monitorChunkSamples ?? frameSize,
          crossFadeOverlapSec: config.crossFadeOverlapSec ?? 0.035,
          extraConvertSec: config.extraConvertSec ?? 0.14,
          model: config.model || null,
          selectedCheckpoint: config.selectedCheckpoint || null,
          pitch: config.pitch ?? 0,
          indexRate: config.indexRate ?? 0.5,
          protect: config.protect ?? 0.5,
          f0Method: config.f0Method || "rmvpe",
          volumeEnvelope: config.volumeEnvelope ?? 1,
          formantShifting: config.formantShifting ?? false,
          formantQfrency: config.formantQfrency ?? 1.0,
          formantTimbre: config.formantTimbre ?? 1.0,
          monitor: config.monitor ?? true,
        })
      );
      setStatus("recording");
    } catch (err) {
      setStatus("error");
      setError(err?.message || "Failed to start live inference");
      await cleanupAll();
    }
  }, [cleanupAll, onCommitted, schedulePlayback, setupAudio]);

  const stop = useCallback(async () => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      await uploadDryRecording();
      ws.send(JSON.stringify({ type: "stop" }));
      setStatus("processing");
      setProgress(0.8);
    }
    await cleanupInput();
  }, [cleanupInput, uploadDryRecording]);

  const cancel = useCallback(async () => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "cancel" }));
    }
    dryCaptureRef.current = { chunks: [], sampleRate: 0 };
    await cleanupAll();
    setStatus("idle");
    setProgress(0);
  }, [cleanupAll]);

  useEffect(() => () => {
    cleanupAll();
  }, [cleanupAll]);

  return {
    status,
    progress,
    error,
    latencyMs,
    inputLevel,
    inputDb,
    inputClip,
    start,
    stop,
    cancel,
    setInputGain,
    setMonitorGain,
    micMonitor,
    toggleMicMonitor,
  };
};
