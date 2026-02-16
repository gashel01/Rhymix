import React, { useEffect, useMemo, useRef, useState } from "react";
import "./StudioPage.css";
import { StudioProvider, useStudioStore } from "./store";
import {
  getOrCreateProjectByAsset,
  getProjectById,
  startAiJob,
  startRender,
  subscribeJobEvents,
  updateProject,
} from "./api";
import Transport from "./components/Transport";
import TrackList from "./components/TrackList";
import Timeline from "./components/Timeline";
import Inspector from "./components/Inspector";
import JobToasts from "./components/JobToasts";

const dbToGain = (value) => Math.pow(10, (value || 0) / 20);
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

const useStudioPlayback = (state, actions) => {
  const audioCtxRef = useRef(null);
  const bufferCacheRef = useRef(new Map());
  const sourcesRef = useRef([]);
  const laneBusRef = useRef(new Map());
  const instrumentCacheRef = useRef(new Map());
  const soundfontModuleRef = useRef(null);
  const playStartRef = useRef(0);
  const playOffsetRef = useRef(0);
  const rafRef = useRef(null);
  const metronomeRef = useRef(null);
  const loopRestartRef = useRef(false);
  const previewRef = useRef({ token: 0, node: null });
  const previewClipRef = useRef({ token: 0, nodes: [], timer: null });

  const stopSources = () => {
    sourcesRef.current.forEach((src) => {
      try {
        src.stop();
      } catch {}
    });
    sourcesRef.current = [];
  };

  const stopPreviewMidiNote = () => {
    const node = previewRef.current.node;
    if (node && typeof node.stop === "function") {
      try {
        node.stop();
      } catch {}
    }
    previewRef.current.node = null;
  };

  const stopPreviewMidiClip = () => {
    previewClipRef.current.token += 1;
    if (previewClipRef.current.timer) {
      clearTimeout(previewClipRef.current.timer);
      previewClipRef.current.timer = null;
    }
    if (previewClipRef.current.nodes?.length) {
      previewClipRef.current.nodes.forEach((node) => {
        if (node && typeof node.stop === "function") {
          try {
            node.stop();
          } catch {}
        }
      });
    }
    previewClipRef.current.nodes = [];
  };

  const ensureContext = () => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }
    return audioCtxRef.current;
  };

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  const ticksToSec = (ticks, bpm, ppq) => {
    const safeBpm = Number(bpm) || 120;
    const safePpq = Number(ppq) || 480;
    return (Number(ticks) || 0) / ((safeBpm * safePpq) / 60);
  };

  const midiNoteToName = (noteNumber) => {
    const value = Math.round(Number(noteNumber) || 0);
    const octave = Math.floor(value / 12) - 1;
    const name = NOTE_NAMES[(value % 12 + 12) % 12];
    return `${name}${octave}`;
  };

  const noteNameToMidi = (noteName) => {
    if (!noteName || typeof noteName !== "string") return 60;
    const match = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(noteName.trim());
    if (!match) return 60;
    const letter = match[1].toUpperCase();
    const accidental = match[2];
    const octave = Number(match[3]);
    const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[letter] ?? 0;
    const offset = accidental === "#" ? 1 : accidental === "b" ? -1 : 0;
    return (octave + 1) * 12 + base + offset;
  };

  const midiToFreq = (noteNumber) => 440 * Math.pow(2, (Number(noteNumber || 60) - 69) / 12);
  const semitonesToRate = (semitones) => Math.pow(2, (Number(semitones) || 0) / 12);

  const createFallbackInstrument = (ctx, destination) => ({
    play: (noteName, when, opts = {}) => {
      const midi = noteNameToMidi(noteName);
      const freq = midiToFreq(midi);
      const duration = Math.max(0.02, Number(opts.duration) || 0.2);
      const gainValue = Math.max(0, Math.min(1, Number(opts.gain) || 0.5));
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, when);
      gain.gain.setValueAtTime(0, when);
      gain.gain.linearRampToValueAtTime(gainValue, when + 0.01);
      gain.gain.linearRampToValueAtTime(0, when + duration);
      osc.connect(gain).connect(destination || ctx.destination);
      osc.start(when);
      osc.stop(when + duration + 0.05);
      return osc;
    },
  });

  const resolveSoundfontName = (instrumentLabel, laneName) => {
    const key = `${instrumentLabel || ""} ${laneName || ""}`.toLowerCase();
    if (key.includes("piano")) return "acoustic_grand_piano";
    if (key.includes("guitar")) return "electric_guitar_clean";
    if (key.includes("bass")) return "acoustic_bass";
    if (key.includes("string")) return "string_ensemble_1";
    if (key.includes("synth")) return "synth_pad_1_new_age";
    if (key.includes("drum") || key.includes("beat")) return "synth_drum";
    return "acoustic_grand_piano";
  };

  const loadSoundfontModule = async () => {
    if (soundfontModuleRef.current) return soundfontModuleRef.current;
    const mod = await import("soundfont-player");
    soundfontModuleRef.current = mod.default || mod;
    return soundfontModuleRef.current;
  };

  const loadInstrumentForLane = async (lane, destination, soundfontName) => {
    if (!lane) return null;
    const name = soundfontName || resolveSoundfontName(lane.instrument, lane.name);
    const cacheKey = `${lane.id}:${name}`;
    const cached = instrumentCacheRef.current.get(cacheKey);
    if (cached && cached.name === name && cached.instrument) return cached.instrument;
    if (cached && cached.name === name && cached.promise) return cached.promise;
    const soundfontUrl =
      process.env.REACT_APP_SOUNDFONT_URL || "https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/";
    const promise = (async () => {
      try {
        const Soundfont = await loadSoundfontModule();
        return await Soundfont.instrument(audioCtxRef.current, name, {
          soundfont: "FluidR3_GM",
          format: "mp3",
          soundfontUrl,
          destination,
          gain: 0.8,
        });
      } catch (err) {
        try {
          const Soundfont = await loadSoundfontModule();
          if (name !== "acoustic_grand_piano") {
            return await Soundfont.instrument(audioCtxRef.current, "acoustic_grand_piano", {
              soundfont: "FluidR3_GM",
              format: "mp3",
              soundfontUrl,
              destination,
              gain: 0.8,
            });
          }
        } catch (fallbackErr) {
          console.warn("SoundFont load failed, using synth fallback.", fallbackErr);
        }
        return createFallbackInstrument(audioCtxRef.current, destination);
      }
    })();
    instrumentCacheRef.current.set(cacheKey, { name, promise, laneId: lane.id });
    const instrument = await promise;
    instrumentCacheRef.current.set(cacheKey, { name, instrument, laneId: lane.id });
    return instrument;
  };

  const makeDistortionCurve = (amount) => {
    const k = clamp(Number(amount) || 0, 0, 100);
    const n = 44100;
    const curve = new Float32Array(n);
    const deg = Math.PI / 180;
    for (let i = 0; i < n; i += 1) {
      const x = (i * 2) / n - 1;
      if (k <= 0) {
        curve[i] = x;
      } else {
        curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
      }
    }
    return curve;
  };

  const createReverbImpulse = (ctx, seconds, decay) => {
    const duration = clamp(Number(seconds) || 2.5, 0.5, 8);
    const decayFactor = clamp(Number(decay) || 2.5, 0.5, 8);
    const rate = ctx.sampleRate || 44100;
    const length = Math.floor(rate * duration);
    const impulse = ctx.createBuffer(2, length, rate);
    for (let channel = 0; channel < impulse.numberOfChannels; channel += 1) {
      const data = impulse.getChannelData(channel);
      for (let i = 0; i < length; i += 1) {
        const t = i / length;
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decayFactor);
      }
    }
    return impulse;
  };

  const buildLaneBus = (ctx, lane) => {
    const input = ctx.createGain();
    const output = ctx.createGain();
    const fx = lane.fx || {};
    const nodes = {};

    let base = input;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = fx.lowpass?.enabled
      ? clamp(Number(fx.lowpass?.cutoff ?? 12000), 200, 20000)
      : 20000;
    base.connect(filter);
    base = filter;
    nodes.lowpass = filter;

    const distortion = ctx.createWaveShaper();
    distortion.oversample = "4x";
    const initialDrive = fx.distortion?.enabled ? clamp(Number(fx.distortion?.drive ?? 20), 0, 100) : 0;
    distortion.curve = makeDistortionCurve(initialDrive);
    base.connect(distortion);
    base = distortion;
    nodes.distortion = distortion;
    nodes.distortionDrive = initialDrive;

    const dryGain = ctx.createGain();
    dryGain.gain.value = 1;
    nodes.dryGain = dryGain;
    base.connect(dryGain).connect(output);

    const delay = ctx.createDelay(5.0);
    delay.delayTime.value = clamp(Number(fx.echo?.time ?? 0.25), 0.05, 1.5);
    const feedback = ctx.createGain();
    feedback.gain.value = clamp(Number(fx.echo?.feedback ?? 0.3), 0, 0.85);
    delay.connect(feedback).connect(delay);
    const wetGain = ctx.createGain();
    const mix = fx.echo?.enabled ? clamp(Number(fx.echo?.mix ?? 0.25), 0, 1) : 0;
    wetGain.gain.value = mix;
    dryGain.gain.value = 1 - mix;
    base.connect(delay);
    delay.connect(wetGain).connect(output);
    nodes.echo = { delay, feedback, wetGain };

    const reverb = ctx.createConvolver();
    const reverbDecay = clamp(Number(fx.reverb?.decay ?? 2.5), 0.5, 8);
    reverb.buffer = createReverbImpulse(ctx, reverbDecay, reverbDecay);
    const reverbWet = ctx.createGain();
    const reverbMix = fx.reverb?.enabled ? clamp(Number(fx.reverb?.mix ?? 0.25), 0, 1) : 0;
    reverbWet.gain.value = reverbMix;
    base.connect(reverb);
    reverb.connect(reverbWet).connect(output);
    nodes.reverb = { convolver: reverb, wetGain: reverbWet, decay: reverbDecay, mix: reverbMix };

    const chorusDelay = ctx.createDelay(1.0);
    chorusDelay.delayTime.value = clamp(Number(fx.chorus?.time ?? 0.02), 0.005, 0.05);
    const chorusLfo = ctx.createOscillator();
    const chorusLfoGain = ctx.createGain();
    chorusLfo.type = "sine";
    chorusLfo.frequency.value = clamp(Number(fx.chorus?.rate ?? 0.8), 0.1, 5);
    chorusLfoGain.gain.value = clamp(Number(fx.chorus?.depth ?? 0.012), 0, 0.03);
    chorusLfo.connect(chorusLfoGain).connect(chorusDelay.delayTime);
    try {
      chorusLfo.start();
    } catch {}
    const chorusWet = ctx.createGain();
    const chorusMix = fx.chorus?.enabled ? clamp(Number(fx.chorus?.mix ?? 0.3), 0, 1) : 0;
    chorusWet.gain.value = chorusMix;
    base.connect(chorusDelay);
    chorusDelay.connect(chorusWet).connect(output);
    nodes.chorus = {
      delay: chorusDelay,
      lfo: chorusLfo,
      lfoGain: chorusLfoGain,
      wetGain: chorusWet,
      mix: chorusMix,
    };

    output.connect(ctx.destination);
    return { input, output, nodes };
  };

  const disconnectLaneBus = (bus) => {
    if (!bus) return;
    if (bus.nodes?.chorus?.lfo) {
      try {
        bus.nodes.chorus.lfo.stop();
      } catch {}
    }
    try {
      bus.input.disconnect();
    } catch {}
    try {
      bus.output.disconnect();
    } catch {}
  };

  const computeLaneGain = (lane, soloSet) => {
    if (soloSet.size && !soloSet.has(lane.id)) return 0;
    if (lane.mute) return 0;
    return dbToGain(lane.gainDb ?? 0);
  };

  const applyLaneSettings = (bus, lane, soloSet) => {
    const ctx = audioCtxRef.current;
    if (!ctx || !bus) return;
    const now = ctx.currentTime;
    const targetGain = computeLaneGain(lane, soloSet);
    try {
      bus.output.gain.setTargetAtTime(targetGain, now, 0.02);
    } catch {}

    const fx = lane.fx || {};
    if (bus.nodes.lowpass) {
      try {
        bus.nodes.lowpass.frequency.setTargetAtTime(
          fx.lowpass?.enabled
            ? clamp(Number(fx.lowpass?.cutoff ?? 12000), 200, 20000)
            : 20000,
          now,
          0.02
        );
      } catch {}
    }
    if (bus.nodes.distortion) {
      const drive = fx.distortion?.enabled ? clamp(Number(fx.distortion?.drive ?? 20), 0, 100) : 0;
      if (bus.nodes.distortionDrive !== drive) {
        bus.nodes.distortion.curve = makeDistortionCurve(drive);
        bus.nodes.distortionDrive = drive;
      }
    }
    if (bus.nodes.echo) {
      const mix = fx.echo?.enabled ? clamp(Number(fx.echo?.mix ?? 0.25), 0, 1) : 0;
      try {
        bus.nodes.echo.delay.delayTime.setTargetAtTime(
          clamp(Number(fx.echo?.time ?? 0.25), 0.05, 1.5),
          now,
          0.02
        );
        bus.nodes.echo.feedback.gain.setTargetAtTime(
          clamp(Number(fx.echo?.feedback ?? 0.3), 0, 0.85),
          now,
          0.02
        );
        if (bus.nodes.echo.wetGain) {
          bus.nodes.echo.wetGain.gain.setTargetAtTime(mix, now, 0.02);
        }
        if (bus.nodes.dryGain) {
          bus.nodes.dryGain.gain.setTargetAtTime(1 - mix, now, 0.02);
        }
      } catch {}
    }
    if (bus.nodes.reverb) {
      const decay = clamp(Number(fx.reverb?.decay ?? 2.5), 0.5, 8);
      if (bus.nodes.reverb.decay !== decay) {
        bus.nodes.reverb.convolver.buffer = createReverbImpulse(ctx, decay, decay);
        bus.nodes.reverb.decay = decay;
      }
      const mix = fx.reverb?.enabled ? clamp(Number(fx.reverb?.mix ?? 0.25), 0, 1) : 0;
      try {
        bus.nodes.reverb.wetGain.gain.setTargetAtTime(mix, now, 0.02);
      } catch {}
    }
    if (bus.nodes.chorus) {
      const rate = clamp(Number(fx.chorus?.rate ?? 0.8), 0.1, 5);
      const depth = clamp(Number(fx.chorus?.depth ?? 0.012), 0, 0.03);
      const baseTime = clamp(Number(fx.chorus?.time ?? 0.02), 0.005, 0.05);
      const mix = fx.chorus?.enabled ? clamp(Number(fx.chorus?.mix ?? 0.3), 0, 1) : 0;
      try {
        bus.nodes.chorus.delay.delayTime.setTargetAtTime(baseTime, now, 0.02);
        bus.nodes.chorus.lfo.frequency.setTargetAtTime(rate, now, 0.02);
        bus.nodes.chorus.lfoGain.gain.setTargetAtTime(depth, now, 0.02);
        bus.nodes.chorus.wetGain.gain.setTargetAtTime(mix, now, 0.02);
      } catch {}
    }
  };

  const syncLaneBuses = (lanes) => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    const soloSet = new Set(lanes.filter((lane) => lane.solo).map((lane) => lane.id));
    const seen = new Set();

    lanes.forEach((lane) => {
      let bus = laneBusRef.current.get(lane.id);
      if (!bus) {
        bus = buildLaneBus(ctx, lane);
        laneBusRef.current.set(lane.id, bus);
      }
      applyLaneSettings(bus, lane, soloSet);
      seen.add(lane.id);
    });

    laneBusRef.current.forEach((bus, laneId) => {
      if (!seen.has(laneId)) {
        disconnectLaneBus(bus);
        laneBusRef.current.delete(laneId);
        instrumentCacheRef.current.forEach((_value, key) => {
          if (key.startsWith(`${laneId}:`)) {
            instrumentCacheRef.current.delete(key);
          }
        });
      }
    });
  };

  const loadBuffer = async (asset) => {
    if (!asset?.url) return null;
    if (bufferCacheRef.current.has(asset.url)) {
      return bufferCacheRef.current.get(asset.url);
    }
    const response = await fetch(asset.url);
    const arrayBuffer = await response.arrayBuffer();
    const ctx = ensureContext();
    const buffer = await ctx.decodeAudioData(arrayBuffer);
    bufferCacheRef.current.set(asset.url, buffer);
    return buffer;
  };

  const schedulePlayback = async (startTimeSec) => {
    const ctx = ensureContext();
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    stopSources();

    const lanes = state.lanes || [];
    const clips = state.clips || [];
    const assets = state.assets || {};

    syncLaneBuses(lanes);

    const lanesById = new Map(lanes.map((lane) => [lane.id, lane]));
    const midiClips = clips.filter((clip) => clip.clipType === "midi" && clip.midi);
    if (midiClips.length) {
      const uniqueKeys = new Set();
      const preloadTargets = [];
      midiClips.forEach((clip) => {
        const lane = lanesById.get(clip.laneId);
        const bus = laneBusRef.current.get(clip.laneId);
        if (!lane || !bus) return;
        const preferred = clip.midi?.soundfont;
        const name = preferred || resolveSoundfontName(lane.instrument, lane.name);
        const key = `${lane.id}:${name}`;
        if (uniqueKeys.has(key)) return;
        uniqueKeys.add(key);
        preloadTargets.push({ lane, bus, name });
      });
      await Promise.all(
        preloadTargets.map((item) => loadInstrumentForLane(item.lane, item.bus.input, item.name))
      );
    }

    for (const clip of clips) {
      if (clip.clipType === "midi") continue;
      const lane = lanesById.get(clip.laneId);
      const pitchShift = clamp(Number(lane?.fx?.pitch?.semitones ?? 0), -24, 24);
      const playbackRate = semitonesToRate(pitchShift);
      const asset = assets[clip.sourceAssetId];
      if (!asset?.url) continue;
      const buffer = await loadBuffer(asset);
      if (!buffer) continue;
      const clipStart = clip.timelineStartSec ?? 0;
      const clipOffset = clip.srcStartSec ?? 0;
      const clipLen = (clip.srcEndSec ?? 0) - (clip.srcStartSec ?? 0);
      if (clipLen <= 0) continue;

      const elapsed = Math.max(0, startTimeSec - clipStart);
      if (elapsed >= clipLen) continue;

      const when = ctx.currentTime + Math.max(0, clipStart - startTimeSec);
      const offset = clipOffset + elapsed;
      const duration = clipLen - elapsed;

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const gainNode = ctx.createGain();
      const clipGain = clip.gainDb ?? 0;
      const targetGain = dbToGain(clipGain);

      gainNode.gain.setValueAtTime(targetGain, when);
      if (clip.fadeInSec) {
        gainNode.gain.setValueAtTime(0, when);
        gainNode.gain.linearRampToValueAtTime(targetGain, when + clip.fadeInSec);
      }
      if (clip.fadeOutSec && duration > clip.fadeOutSec) {
        gainNode.gain.setValueAtTime(targetGain, when + duration - clip.fadeOutSec);
        gainNode.gain.linearRampToValueAtTime(0, when + duration);
      }

      const laneBus = laneBusRef.current.get(clip.laneId);
      if (laneBus) {
        source.connect(gainNode).connect(laneBus.input);
      } else {
        source.connect(gainNode).connect(ctx.destination);
      }
      try {
        source.playbackRate.setValueAtTime(playbackRate, when);
      } catch {}
      source.start(when, offset, duration);
      sourcesRef.current.push(source);
    }

    if (midiClips.length) {
      for (const clip of midiClips) {
        const lane = lanesById.get(clip.laneId);
        if (!lane) continue;
        const preferred = clip.midi?.soundfont;
        const name = preferred || resolveSoundfontName(lane.instrument, lane.name);
        const cached = instrumentCacheRef.current.get(`${lane.id}:${name}`);
        const instrument = cached?.instrument;
        if (!instrument) continue;
        const midi = clip.midi || {};
        const notes = Array.isArray(midi.notes) ? midi.notes : [];
        if (!notes.length) continue;
        const bpm = Number(midi.bpm) || state.project?.bpm || 120;
        const ppq = Number(midi.ppq) || 480;
        const clipStart = Number(clip.timelineStartSec || 0);
        const clipOffsetSec = Number(clip.srcStartSec || 0);
        const clipLen = Math.max(0, Number(clip.srcEndSec || 0) - clipOffsetSec);
        if (!clipLen) continue;
        const pitchShift = clamp(Number(lane.fx?.pitch?.semitones ?? 0), -24, 24);
        const elapsed = Math.max(0, startTimeSec - clipStart);
        if (elapsed >= clipLen) continue;

        for (const note of notes) {
          const noteStartSec = ticksToSec(note.startTick, bpm, ppq);
          const noteDurSec = Math.max(0.02, ticksToSec(note.durationTick, bpm, ppq));
          const relativeStart = noteStartSec - clipOffsetSec;
          const relativeEnd = noteStartSec + noteDurSec - clipOffsetSec;
          if (relativeEnd <= 0 || relativeStart >= clipLen) continue;
          const absStart = clipStart + relativeStart;
          const absEnd = clipStart + relativeEnd;
          if (absEnd <= startTimeSec) continue;
          const when = ctx.currentTime + Math.max(0, absStart - startTimeSec);
          const duration = Math.max(0.02, absEnd - Math.max(startTimeSec, absStart));
          const velocity = clamp(Number(note.velocity ?? 100), 1, 127);
          const gain = clamp((velocity / 127) * dbToGain(clip.gainDb ?? 0), 0, 1);
          const baseNote = Number(note.note ?? note.midi ?? 60);
          const noteNumber = clamp(baseNote + pitchShift, 0, 127);
          const noteName = Number.isFinite(noteNumber) ? midiNoteToName(noteNumber) : String(note.note || "C4");
          try {
            const node = instrument.play(noteName, when, {
              duration,
              gain,
            });
            if (node?.stop) sourcesRef.current.push(node);
          } catch (err) {
            console.warn("Failed to play MIDI note", err);
          }
        }
      }
    }

    playStartRef.current = ctx.currentTime;
    playOffsetRef.current = startTimeSec;

    const tick = () => {
      const current = ctx.currentTime - playStartRef.current + playOffsetRef.current;
      const loopEnabled = state.ui.loop && state.selection?.range;
      if (loopEnabled) {
        const loopStart = Math.min(state.selection.range.start, state.selection.range.end);
        const loopEnd = Math.max(state.selection.range.start, state.selection.range.end);
        if (loopEnd > loopStart && current >= loopEnd && !loopRestartRef.current) {
          loopRestartRef.current = true;
          schedulePlayback(loopStart).then(() => {
            loopRestartRef.current = false;
          });
          return;
        }
      }
      actions.setTransport({ currentTime: current });
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  const playClick = () => {
    const ctx = ensureContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(1000, ctx.currentTime);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.08);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.1);
  };

  const startMetronome = () => {
    if (!state.ui.metronome) return;
    const bpm = state.project?.bpm || 120;
    const beatMs = Math.max(100, (60 / bpm) * 1000);
    playClick();
    metronomeRef.current = setInterval(playClick, beatMs);
  };

  const stopMetronome = () => {
    if (metronomeRef.current) {
      clearInterval(metronomeRef.current);
      metronomeRef.current = null;
    }
  };

  const play = async () => {
    const loopEnabled = state.ui.loop && state.selection?.range;
    const loopStart = loopEnabled
      ? Math.min(state.selection.range.start, state.selection.range.end)
      : null;
    const loopEnd = loopEnabled
      ? Math.max(state.selection.range.start, state.selection.range.end)
      : null;
    let startTime = state.transport.currentTime || 0;
    if (loopEnabled && loopEnd > loopStart && (startTime < loopStart || startTime > loopEnd)) {
      startTime = loopStart;
    }
    const ctx = ensureContext();
    if (ctx.state === "suspended") {
      await ctx.resume();
    }
    syncLaneBuses(state.lanes || []);
    stopMetronome();
    startMetronome();
    await schedulePlayback(startTime);
    actions.setTransport({ isPlaying: true });
  };

  const pause = () => {
    if (!audioCtxRef.current) return;
    const current = audioCtxRef.current.currentTime - playStartRef.current + playOffsetRef.current;
    stopSources();
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    stopMetronome();
    actions.setTransport({ isPlaying: false, currentTime: current });
  };

  const stop = () => {
    stopSources();
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    stopMetronome();
    actions.setTransport({ isPlaying: false, currentTime: 0 });
  };

  const previewMidiNote = async ({
    laneId,
    noteNumber,
    velocity = 100,
    durationSec = 0.12,
    soundfontName,
    clipGainDb,
  }) => {
    if (!laneId || !Number.isFinite(Number(noteNumber))) return;
    const ctx = ensureContext();
    if (ctx.state === "suspended") {
      try {
        await ctx.resume();
      } catch {}
    }
    const lanes = state.lanes || [];
    const lane = lanes.find((item) => item.id === laneId);
    if (!lane) return;
    const pitchShift = clamp(Number(lane.fx?.pitch?.semitones ?? 0), -24, 24);
    syncLaneBuses(lanes);
    let laneBus = laneBusRef.current.get(laneId);
    if (!laneBus) {
      laneBus = buildLaneBus(ctx, lane);
      laneBusRef.current.set(laneId, laneBus);
    }
    const name = soundfontName || resolveSoundfontName(lane.instrument, lane.name);
    const key = `${lane.id}:${name}`;
    const token = previewRef.current.token + 1;
    previewRef.current.token = token;

    const playWith = (instrument) => {
      if (!instrument || previewRef.current.token !== token) return;
      stopPreviewMidiNote();
      const safeVelocity = clamp(Number(velocity) || 100, 1, 127);
      const gainScale = dbToGain(clipGainDb ?? lane.gainDb ?? 0);
      const gain = clamp((safeVelocity / 127) * gainScale, 0, 1);
      const when = ctx.currentTime;
      const duration = clamp(Number(durationSec) || 0.12, 0.05, 6);
      const shifted = clamp(Number(noteNumber) + pitchShift, 0, 127);
      const noteName = midiNoteToName(shifted);
      try {
        const node = instrument.play(noteName, when, { duration, gain });
        previewRef.current.node = node;
        if (node && typeof node.stop === "function") {
          try {
            node.stop(when + duration + 0.05);
          } catch {}
        }
      } catch (err) {
        console.warn("Failed to preview MIDI note", err);
      }
    };

    const cached = instrumentCacheRef.current.get(key);
    if (cached?.instrument) {
      playWith(cached.instrument);
      return;
    }
    if (cached?.promise) {
      try {
        const instrument = await cached.promise;
        playWith(instrument);
      } catch {}
      return;
    }
    try {
      const instrument = await loadInstrumentForLane(lane, laneBus.input, name);
      playWith(instrument);
    } catch {}
  };

  const previewMidiClip = async (
    clip,
    {
      loop = false,
      startSec = 0,
      loopStartSec,
      loopEndSec,
    } = {}
  ) => {
    if (!clip?.midi || clip.clipType !== "midi") return;
    const ctx = ensureContext();
    if (ctx.state === "suspended") {
      try {
        await ctx.resume();
      } catch {}
    }
    stopPreviewMidiClip();
    const token = previewClipRef.current.token + 1;
    previewClipRef.current.token = token;

    const lane = (state.lanes || []).find((item) => item.id === clip.laneId);
    if (!lane) return;
    const pitchShift = clamp(Number(lane.fx?.pitch?.semitones ?? 0), -24, 24);
    syncLaneBuses(state.lanes || []);
    let laneBus = laneBusRef.current.get(clip.laneId);
    if (!laneBus) {
      laneBus = buildLaneBus(ctx, lane);
      laneBusRef.current.set(clip.laneId, laneBus);
    }

    const midi = clip.midi || {};
    const notes = Array.isArray(midi.notes) ? midi.notes : [];
    if (!notes.length) return;
    const bpm = Number(midi.bpm) || state.project?.bpm || 120;
    const ppq = Number(midi.ppq) || 480;
    const clipOffsetSec = Number(clip.srcStartSec || 0);
    const clipLen = Math.max(0.01, Number(clip.srcEndSec || 0) - clipOffsetSec);
    const name = midi.soundfont || resolveSoundfontName(lane.instrument, lane.name);

    const cached = instrumentCacheRef.current.get(`${lane.id}:${name}`);
    const instrument = cached?.instrument
      ? cached.instrument
      : await loadInstrumentForLane(lane, laneBus.input, name);
    if (!instrument || previewClipRef.current.token !== token) return;

    const loopStart = clamp(
      Number.isFinite(loopStartSec) ? Number(loopStartSec) : 0,
      0,
      clipLen
    );
    const loopEnd = clamp(
      Number.isFinite(loopEndSec) ? Number(loopEndSec) : clipLen,
      0,
      clipLen
    );
    const boundedLoopEnd = loopEnd > loopStart ? loopEnd : clipLen;
    const boundedLoopStart = loopEnd > loopStart ? loopStart : 0;
    const startOffset = clamp(Number(startSec) || 0, boundedLoopStart, boundedLoopEnd);
    const windowEnd = loop ? boundedLoopEnd : clipLen;

    const nodes = [];
    notes.forEach((note) => {
      const noteStartSec = ticksToSec(note.startTick, bpm, ppq);
      const noteDurSec = Math.max(0.02, ticksToSec(note.durationTick, bpm, ppq));
      const relativeStart = noteStartSec - clipOffsetSec;
      const relativeEnd = relativeStart + noteDurSec;
      if (relativeEnd <= startOffset || relativeStart >= windowEnd) return;
      const when = ctx.currentTime + Math.max(0, relativeStart - startOffset);
      const duration = Math.max(
        0.02,
        Math.min(noteDurSec, windowEnd - relativeStart)
      );
      const velocity = clamp(Number(note.velocity ?? 100), 1, 127);
      const gain = clamp((velocity / 127) * dbToGain(clip.gainDb ?? 0), 0, 1);
      const baseNote = Number(note.note ?? note.midi ?? 60);
      const noteNumber = clamp(baseNote + pitchShift, 0, 127);
      const noteName = midiNoteToName(noteNumber);
      try {
        const node = instrument.play(noteName, when, { duration, gain });
        if (node) nodes.push(node);
      } catch {}
    });
    previewClipRef.current.nodes = nodes;

    const loopLen = boundedLoopEnd - boundedLoopStart;
    if (loop && loopLen > 0.01) {
      previewClipRef.current.timer = setTimeout(() => {
        if (previewClipRef.current.token !== token) return;
        previewMidiClip(clip, {
          loop: true,
          startSec: boundedLoopStart,
          loopStartSec: boundedLoopStart,
          loopEndSec: boundedLoopEnd,
        });
      }, loopLen * 1000);
    }
  };

  const seek = (time) => {
    actions.setTransport({ currentTime: time });
    if (state.transport.isPlaying) {
      stopSources();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      schedulePlayback(time);
    }
  };

  useEffect(() => {
    if (!audioCtxRef.current) return;
    syncLaneBuses(state.lanes || []);
  }, [state.lanes]);

  return {
    play,
    pause,
    stop,
    seek,
    previewMidiNote,
    stopPreviewMidiNote,
    previewMidiClip,
    stopPreviewMidiClip,
  };
};

const StudioPageInner = ({ assetId }) => {
  const { state, actions } = useStudioStore();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [jobs, setJobs] = useState([]);
  const jobSubscriptionsRef = useRef(new Map());
  const [createMode, setCreateMode] = useState("custom");
  const [lyrics, setLyrics] = useState("");
  const [style, setStyle] = useState("");
  const [model, setModel] = useState("v4");
  const [libraryQuery, setLibraryQuery] = useState("");
  const [timelineScrollTop, setTimelineScrollTop] = useState(0);
  const trackScrollRef = useRef(null);

  const playback = useStudioPlayback(state, actions);

  useEffect(() => {
    let mounted = true;
    const loadProject = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await getOrCreateProjectByAsset(assetId);
        if (!mounted) return;
        actions.setProject(data);
      } catch (err) {
        if (!mounted) return;
        setError(err.message || "Failed to load project");
      } finally {
        if (mounted) setLoading(false);
      }
    };
    if (assetId) loadProject();
    return () => {
      mounted = false;
    };
  }, [assetId, actions]);

  useEffect(() => {
    return () => {
      jobSubscriptionsRef.current.forEach((unsubscribe) => unsubscribe());
      jobSubscriptionsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!trackScrollRef.current) return;
    if (Math.abs(trackScrollRef.current.scrollTop - timelineScrollTop) < 1) return;
    trackScrollRef.current.scrollTop = timelineScrollTop;
  }, [timelineScrollTop]);

  useEffect(() => {
    if (!state.project?.id) return;
    const timeout = setTimeout(() => {
      updateProject(state.project.id, {
        project: state.project,
        lanes: state.lanes,
        clips: state.clips,
        metadata: state.metadata,
      }).catch((err) => console.error("Failed to save project", err));
    }, 800);
    return () => clearTimeout(timeout);
  }, [state.project, state.lanes, state.clips, state.metadata]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.defaultPrevented) return;
      const tag = event.target?.tagName;
      if (tag && ["INPUT", "TEXTAREA", "SELECT"].includes(tag)) return;
      if (event.target?.isContentEditable) return;
      const key = event.key.toLowerCase();
      if (event.code === "Space") {
        if (state.ui.midiEditorOpen) return;
        event.preventDefault();
        if (state.transport.isPlaying) {
          playback.pause();
        } else {
          playback.play();
        }
        return;
      }
      if (key === "1") {
        actions.setUi({ showCreatePanel: !state.ui.showCreatePanel });
        return;
      }
      if (key === "2") {
        actions.setUi({ showLibraryPanel: !state.ui.showLibraryPanel });
        return;
      }
      if (key === "3") {
        actions.setUi({ showDetailsPanel: !state.ui.showDetailsPanel });
        return;
      }
      if (key === "escape") {
        actions.setSelection({ range: null, laneIds: null, clipIds: [] });
        return;
      }
      if (key === "s") {
        const clipId = state.selection?.clipIds?.[0];
        if (clipId) {
          actions.splitClip(clipId, state.transport.currentTime || 0);
        }
        return;
      }
      if (key === "d") {
        if (state.selection?.range) {
          actions.duplicateSelection(
            state.selection.range,
            state.selection.laneIds,
            state.selection.range.end
          );
          return;
        }
        if (state.selection?.clipIds?.length) {
          const selected = state.clips.filter((clip) => state.selection.clipIds.includes(clip.id));
          if (selected.length) {
            let start = Infinity;
            let end = 0;
            selected.forEach((clip) => {
              const clipStart = clip.timelineStartSec ?? 0;
              const clipEnd =
                (clip.timelineStartSec ?? 0) + (clip.srcEndSec ?? 0) - (clip.srcStartSec ?? 0);
              start = Math.min(start, clipStart);
              end = Math.max(end, clipEnd);
            });
            actions.duplicateSelection({ start, end }, null, end);
          }
          return;
        }
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        if (state.selection?.clipIds?.length) {
          actions.deleteSelection(null, null, state.selection.clipIds);
          return;
        }
        if (state.selection?.range) {
          actions.deleteSelection(state.selection.range, state.selection.laneIds, null);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    state.selection,
    state.transport.currentTime,
    state.transport.isPlaying,
    state.clips,
    state.ui.showCreatePanel,
    state.ui.showLibraryPanel,
    state.ui.showDetailsPanel,
    actions,
    playback,
  ]);

  const assetList = useMemo(
    () =>
      Object.entries(state.assets || {}).map(([id, asset]) => ({
        id: asset.id || id,
        ...asset,
      })),
    [state.assets]
  );

  const filteredAssets = useMemo(() => {
    const query = libraryQuery.trim().toLowerCase();
    if (!query) return assetList;
    return assetList.filter((asset) => {
      const label = `${asset.label || ""} ${asset.id || ""}`.toLowerCase();
      return label.includes(query);
    });
  }, [assetList, libraryQuery]);

  const createPrompt = useMemo(
    () => [style, lyrics].filter(Boolean).join("\n").trim(),
    [style, lyrics]
  );

  const selectedClip = useMemo(
    () => state.clips.find((clip) => state.selection?.clipIds?.[0] === clip.id),
    [state.clips, state.selection]
  );

  const subscribeJob = (jobId) => {
    if (jobSubscriptionsRef.current.has(jobId)) return;
    const projectId = state.project?.id;
    const unsubscribe = subscribeJobEvents(jobId, (event) => {
      setJobs((prev) => {
        const existing = prev.find((job) => job.id === jobId);
        const next = existing
          ? prev.map((job) =>
              job.id === jobId ? { ...job, ...event, status: event.status || job.status } : job
            )
          : [...prev, { id: jobId, ...event }];
        return next;
      });
      if (event?.status === "completed" && projectId) {
        getProjectById(projectId)
          .then((data) => actions.setProject(data))
          .catch((err) => console.error("Failed to refresh project", err));
      }
    });
    jobSubscriptionsRef.current.set(jobId, unsubscribe);
  };

  const refreshProject = async (projectId) => {
    if (!projectId) return;
    try {
      const data = await getProjectById(projectId);
      actions.setProject(data);
    } catch (err) {
      console.error("Failed to refresh project", err);
    }
  };

  const handleStartJob = async (jobType, payload) => {
    if (!state.project?.id) return;
    const selectedClip = state.clips.find((clip) => state.selection?.clipIds?.[0] === clip.id);
    let sourceAssetId = selectedClip?.sourceAssetId;
    if (!sourceAssetId && (jobType === "stem_extract" || jobType === "stem_extract_uvr")) {
      const instrumentalLane = state.lanes.find((lane) => lane.type === "instrumental");
      const instrumentalClip = state.clips.find((clip) => clip.laneId === instrumentalLane?.id);
      sourceAssetId = instrumentalClip?.sourceAssetId;
    }
    const response = await startAiJob(state.project.id, jobType, {
      sourceAssetId,
      ...payload,
    });
    setJobs((prev) => [...prev, { id: response.jobId, type: jobType, status: "queued", progress: 0 }]);
    subscribeJob(response.jobId);
  };

  const handleRender = async () => {
    if (!state.project?.id) return;
    const response = await startRender(state.project.id);
    setJobs((prev) => [...prev, { id: response.jobId, type: "render", status: "queued", progress: 0 }]);
    subscribeJob(response.jobId);
  };

  const handleProjectUpdate = (patch) => {
    actions.updateProject(patch);
    if (patch?.bpm != null) {
      const bpm = Math.max(40, Math.min(240, Number(patch.bpm) || 120));
      const gridDiv = state.ui.gridDiv || 1;
      actions.setUi({ gridSec: 60 / bpm / gridDiv });
    }
  };

  const transportActions = useMemo(() => {
    const list = [];
    if (!state.clips.length) {
      list.push({
        id: "open-library",
        label: "Open Library",
        variant: "ghost",
        onClick: () => actions.setUi({ showLibraryPanel: true }),
      });
      list.push({
        id: "create-song",
        label: "Create Song",
        variant: "accent",
        onClick: () => actions.setUi({ showCreatePanel: true }),
      });
      return list;
    }
    if (selectedClip?.sourceAssetId) {
      list.push({
        id: "extract-stems",
        label: "Extract Stems",
        variant: "ghost",
        onClick: () =>
          handleStartJob("stem_extract_uvr", {
            sourceAssetId: selectedClip.sourceAssetId,
          }),
      });
    }
    if (state.selection?.range) {
      list.push({
        id: "duplicate-range",
        label: "Duplicate",
        variant: "ghost",
        onClick: () =>
          actions.duplicateSelection(
            state.selection.range,
            state.selection.laneIds,
            state.selection.range.end
          ),
      });
    }
    return list;
  }, [state.clips, state.selection, selectedClip, actions, handleStartJob]);

  const jobStatus = jobs.length ? `${jobs[jobs.length - 1].type}: ${jobs[jobs.length - 1].status}` : "Idle";

  if (loading) {
    return <div className="studio-page">Loading Studio...</div>;
  }

  if (error) {
    return <div className="studio-page">Error: {error}</div>;
  }

  return (
    <div className="studio-page">
      <div className="studio-shell">
        <div className={`studio-rail ${state.ui.railCollapsed ? "collapsed" : ""}`}>
          <button
            className="studio-rail-toggle"
            onClick={() => actions.setUi({ railCollapsed: !state.ui.railCollapsed })}
          >
            ☰
          </button>
          <button
            className={`studio-rail-btn ${state.ui.showCreatePanel ? "active" : ""}`}
            onClick={() => actions.setUi({ showCreatePanel: !state.ui.showCreatePanel })}
          >
            Create
          </button>
          <button className="studio-rail-btn active">Studio</button>
          <button
            className={`studio-rail-btn ${state.ui.showLibraryPanel ? "active" : ""}`}
            onClick={() => actions.setUi({ showLibraryPanel: !state.ui.showLibraryPanel })}
          >
            Library
          </button>
        </div>

        <div className="studio-workspace">
          {(state.ui.showCreatePanel || state.ui.showLibraryPanel) && (
            <div className="studio-left-column">
              {state.ui.showCreatePanel && (
                <div className="studio-panel studio-create-panel">
                  <div className="studio-panel-title">Creation Dashboard</div>
                  <div className="studio-toggle-group">
                    <button
                      className={`studio-mini ${createMode === "custom" ? "active" : ""}`}
                      onClick={() => setCreateMode("custom")}
                    >
                      Custom Mode
                    </button>
                    <button
                      className={`studio-mini ${createMode === "simple" ? "active" : ""}`}
                      onClick={() => setCreateMode("simple")}
                    >
                      Simple Mode
                    </button>
                  </div>
                  {createMode === "custom" && (
                    <div className="studio-field">
                      <label>Lyrics</label>
                      <textarea value={lyrics} onChange={(e) => setLyrics(e.target.value)} rows={4} />
                    </div>
                  )}
                  <div className="studio-field">
                    <label>Style of Music</label>
                    <input value={style} onChange={(e) => setStyle(e.target.value)} />
                  </div>
                  <div className="studio-field">
                    <label>Model</label>
                    <select value={model} onChange={(e) => setModel(e.target.value)}>
                      <option value="v3.5">v3.5</option>
                      <option value="v4">v4</option>
                      <option value="v5">v5</option>
                    </select>
                  </div>
                  <div className="studio-actions-row">
                    <button
                      className="studio-btn accent"
                      disabled={!createPrompt}
                      onClick={() =>
                        handleStartJob("add_layer", {
                          prompt: createPrompt,
                          durationSec: 30,
                          model,
                        })
                      }
                    >
                      Generate
                    </button>
                  </div>
                  <div className="studio-actions-grid">
                    <button className="studio-btn ghost" disabled>
                      Upload Audio
                    </button>
                    <button className="studio-btn ghost" disabled>
                      Record
                    </button>
                    <button className="studio-btn ghost" disabled>
                      Add Persona
                    </button>
                  </div>
                </div>
              )}

              {state.ui.showLibraryPanel && (
                <div className="studio-panel studio-library-panel">
                  <div className="studio-panel-title">Library & Workspace</div>
                  <div className="studio-field">
                    <input
                      placeholder="Search assets..."
                      value={libraryQuery}
                      onChange={(e) => setLibraryQuery(e.target.value)}
                    />
                  </div>
                  <div className="studio-library-list">
                    {filteredAssets.length ? (
                      filteredAssets.map((asset) => (
                        <div
                          key={asset.id}
                          className="studio-library-item"
                          draggable
                          onDragStart={(event) => {
                            event.dataTransfer.setData("application/x-rhymix-asset", asset.id);
                            event.dataTransfer.effectAllowed = "copy";
                          }}
                          onDoubleClick={() => {
                            const laneId = state.lanes[0]?.id;
                            if (!laneId) return;
                            actions.addClip(
                              laneId,
                              asset.id,
                              state.transport.currentTime || 0,
                              asset.durationSec
                            );
                          }}
                        >
                          <div className="studio-library-title">{asset.label || asset.id}</div>
                          <div className="studio-library-meta">
                            {asset.durationSec != null
                              ? `${Number(asset.durationSec).toFixed(2)}s`
                              : "Unknown"}
                          </div>
                          <button
                            className="studio-mini"
                            onClick={() => {
                              const laneId = state.lanes[0]?.id;
                              if (!laneId) return;
                              actions.addClip(
                                laneId,
                                asset.id,
                                state.transport.currentTime || 0,
                                asset.durationSec
                              );
                            }}
                          >
                            Add
                          </button>
                        </div>
                      ))
                    ) : (
                      <div className="studio-empty">No assets yet.</div>
                    )}
                  </div>
                  <div className="studio-actions-row">
                    <button className="studio-btn ghost">Project Switcher</button>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="studio-center-column">
            <div className="studio-panel studio-timeline-panel">
              <div className="studio-timeline-toolbar">
                <div className="studio-toolbar-left">
                  <div className="studio-panel-title">Multitrack Timeline</div>
                  <div className="studio-subtext">
                    Bars & Beats · {state.project?.bpm || 120} BPM
                  </div>
                </div>
                <div className="studio-toolbar-right">
                  <div className="studio-field-inline">
                    <label>Grid</label>
                    <select
                      value={state.ui.gridDiv || 1}
                      onChange={(e) => {
                        const gridDiv = Math.max(1, Number(e.target.value) || 1);
                        const bpm = state.project?.bpm || 120;
                        actions.setUi({ gridDiv, gridSec: 60 / bpm / gridDiv });
                      }}
                    >
                      <option value={1}>1/4</option>
                      <option value={2}>1/8</option>
                      <option value={4}>1/16</option>
                      <option value={8}>1/32</option>
                    </select>
                  </div>
                  <label className="studio-toggle">
                    <input type="checkbox" checked={state.ui.snap} onChange={() => actions.setUi({ snap: !state.ui.snap })} />
                    Snap
                  </label>
                  <label className="studio-toggle">
                    <input
                      type="checkbox"
                      checked={state.ui.metronome}
                      onChange={() => actions.setUi({ metronome: !state.ui.metronome })}
                    />
                    Metronome
                  </label>
                  <label className="studio-toggle">
                    <input type="checkbox" checked={state.ui.loop} onChange={() => actions.setUi({ loop: !state.ui.loop })} />
                    Loop
                  </label>
                  <div className="studio-zoom">
                    <span>Zoom</span>
                    <input
                      type="range"
                      min="0.5"
                      max="2.5"
                      step="0.1"
                      value={state.ui.zoom}
                      onChange={(e) => actions.setUi({ zoom: Number(e.target.value) })}
                    />
                  </div>
                </div>
              </div>

              <div className="studio-timeline-shell">
                <div
                  className="studio-track-headers"
                  ref={trackScrollRef}
                  onScroll={() => setTimelineScrollTop(trackScrollRef.current?.scrollTop || 0)}
                >
                  <TrackList
                    lanes={state.lanes}
                    onUpdateLane={actions.updateLane}
                    onAddLane={actions.addLane}
                    onRemoveLane={actions.removeLane}
                    onDuplicateLane={actions.duplicateLane}
                    onReorderLanes={actions.reorderLanes}
                    onDeleteAllLanes={actions.deleteAllLanes}
                    compact
                    onSelectLane={(laneId) => {
                      const laneClips = state.clips.filter((clip) => clip.laneId === laneId);
                      if (!laneClips.length) {
                        actions.setSelection({ range: null, laneIds: [laneId], clipIds: [] });
                        return;
                      }
                      let start = Infinity;
                      let end = 0;
                      laneClips.forEach((clip) => {
                        const clipStart = clip.timelineStartSec ?? 0;
                        const clipEnd =
                          (clip.timelineStartSec ?? 0) + (clip.srcEndSec ?? 0) - (clip.srcStartSec ?? 0);
                        start = Math.min(start, clipStart);
                        end = Math.max(end, clipEnd);
                      });
                      actions.setSelection({ range: { start, end }, laneIds: [laneId], clipIds: [] });
                    }}
                  />
                </div>

                <div className="studio-timeline-canvas">
                  <Timeline
                    project={state.project}
                    lanes={state.lanes}
                    clips={state.clips}
                    assets={state.assets}
                    selection={state.selection}
                    currentTime={state.transport.currentTime}
                    zoom={state.ui.zoom}
                    snap={state.ui.snap}
                    gridSec={state.ui.gridSec}
                    bpm={state.project?.bpm || 120}
                    onAddClip={actions.addClip}
                    onScrollY={setTimelineScrollTop}
                    scrollTopSync={timelineScrollTop}
                    onSelectClip={(clipId) =>
                      actions.setSelection({ clipIds: clipId ? [clipId] : [], range: null, laneIds: null })
                    }
                    onSelectRange={(payload) => {
                      if (!payload) {
                        actions.setSelection({ range: null, laneIds: null, clipIds: [] });
                        return;
                      }
                      const range = payload.range ?? payload;
                      const laneIds = payload.laneIds ?? null;
                      actions.setSelection({ range, laneIds, clipIds: [] });
                    }}
                    onSeek={(time) => playback.seek(time)}
                    onMoveClip={actions.moveClipToLane}
                    onUpdateClip={actions.updateClip}
                    onSplitClip={actions.splitClip}
                    onPreviewMidiNote={playback.previewMidiNote}
                    onStopPreviewMidiNote={playback.stopPreviewMidiNote}
                    onPlayMidiClipPreview={playback.previewMidiClip}
                    onStopMidiClipPreview={playback.stopPreviewMidiClip}
                    onSetMidiEditorOpen={(open) => actions.setUi({ midiEditorOpen: Boolean(open) })}
                    onUndo={actions.undo}
                    onRedo={actions.redo}
                    onDeleteClip={actions.deleteSelection}
                    onTrimClip={actions.trimClipLeft}
                    onTrimClipRight={actions.trimClipRight}
                  />
                </div>
              </div>
            </div>
          </div>

          {state.ui.showDetailsPanel && (
            <div className="studio-right-column">
              <div className="studio-panel studio-details-panel">
        <Inspector
          project={state.project}
          lanes={state.lanes}
          clips={state.clips}
          selection={state.selection}
          metadata={state.metadata}
          playheadTime={state.transport.currentTime}
          transport={state.transport}
          onSplit={actions.splitClip}
          onTrimLeft={actions.trimClipLeft}
          onTrimRight={actions.trimClipRight}
          onMoveClip={actions.moveClip}
          onDeleteSelection={actions.deleteSelection}
          onDuplicateSelection={actions.duplicateSelection}
          onStartAiJob={handleStartJob}
          onUpdateLane={actions.updateLane}
          onUpdateClip={actions.updateClip}
          onUpdateProject={handleProjectUpdate}
          studioActions={actions}
          onRefreshProject={refreshProject}
        />
              </div>
            </div>
          )}
        </div>
      </div>

      <Transport
        isPlaying={state.transport.isPlaying}
        currentTime={state.transport.currentTime}
        onPlay={playback.play}
        onPause={playback.pause}
        onStop={playback.stop}
        onUndo={actions.undo}
        onRedo={actions.redo}
        onRender={handleRender}
        jobStatus={jobStatus}
        contextActions={transportActions}
      />

      <JobToasts
        jobs={jobs}
        onDismiss={(jobId) => {
          const unsubscribe = jobSubscriptionsRef.current.get(jobId);
          if (unsubscribe) unsubscribe();
          jobSubscriptionsRef.current.delete(jobId);
          setJobs((prev) => prev.filter((job) => job.id !== jobId));
        }}
      />
    </div>
  );
};

const StudioPage = ({ assetId }) => (
  <StudioProvider>
    <StudioPageInner assetId={assetId} />
  </StudioProvider>
);

export default StudioPage;
