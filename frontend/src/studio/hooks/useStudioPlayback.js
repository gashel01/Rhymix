import { useEffect, useRef } from 'react';
import {
  PLAYBACK_LOOKAHEAD_SEC,
  PLAYBACK_START_DELAY_SEC,
  PLAYBACK_TRANSPORT_UPDATE_MS,
  clamp,
  computeLaneGain,
  dbToGain,
  getLoopBounds,
  getSoloSet,
  makeDistortionCurve,
  midiNoteToName,
  midiToFreq,
  noteNameToMidi,
  resolveFxParams,
  resolveSoundfontName,
  resolveWindowEnd,
  semitonesToRate,
  ticksToSec,
} from "../audioMath";

export const useStudioPlayback = (state, actions) => {
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
  const playbackTokenRef = useRef(0);
  const scheduledUntilRef = useRef(0);
  const scheduledAudioRef = useRef(new Set());
  const scheduledMidiRef = useRef(new Set());
  const scheduleBusyRef = useRef(false);
  const lastTransportUpdateRef = useRef(0);
  const stateRef = useRef(state);

  const stopSources = () => {
    sourcesRef.current.forEach((src) => {
      try {
        src.stop();
      } catch {}
    });
    sourcesRef.current = [];
  };

  stateRef.current = state;

  const registerSource = (node) => {
    if (!node) return;
    sourcesRef.current.push(node);
    const cleanup = () => {
      sourcesRef.current = sourcesRef.current.filter((item) => item !== node);
    };
    if ("onended" in node) {
      node.onended = cleanup;
    }
  };

  const resetPlaybackScheduling = (startTimeSec = 0) => {
    playbackTokenRef.current += 1;
    scheduledUntilRef.current = Math.max(0, Number(startTimeSec) || 0);
    scheduledAudioRef.current = new Set();
    scheduledMidiRef.current = new Set();
    scheduleBusyRef.current = false;
    lastTransportUpdateRef.current = 0;
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

  const applyLaneSettings = (bus, lane, soloSet) => {
    const ctx = audioCtxRef.current;
    if (!ctx || !bus) return;
    const now = ctx.currentTime;
    const fx = resolveFxParams(lane.fx);

    // Every setTargetAtTime is wrapped: a node whose context has been closed
    // under us throws, and one lane failing to update must not stop the rest.
    try {
      bus.output.gain.setTargetAtTime(computeLaneGain(lane, soloSet), now, 0.02);
    } catch {}

    if (bus.nodes.lowpass) {
      try {
        bus.nodes.lowpass.frequency.setTargetAtTime(fx.lowpassCutoff, now, 0.02);
      } catch {}
    }

    // The curve is rebuilt only when the drive actually changed: it is 44,100
    // samples, and playback would stutter if it were rebuilt every render.
    if (bus.nodes.distortion && bus.nodes.distortionDrive !== fx.distortionDrive) {
      bus.nodes.distortion.curve = makeDistortionCurve(fx.distortionDrive);
      bus.nodes.distortionDrive = fx.distortionDrive;
    }

    if (bus.nodes.echo) {
      try {
        bus.nodes.echo.delay.delayTime.setTargetAtTime(fx.echoTime, now, 0.02);
        bus.nodes.echo.feedback.gain.setTargetAtTime(fx.echoFeedback, now, 0.02);
        if (bus.nodes.echo.wetGain) {
          bus.nodes.echo.wetGain.gain.setTargetAtTime(fx.echoMix, now, 0.02);
        }
        if (bus.nodes.dryGain) {
          bus.nodes.dryGain.gain.setTargetAtTime(1 - fx.echoMix, now, 0.02);
        }
      } catch {}
    }

    if (bus.nodes.reverb) {
      // Same reasoning as the distortion curve: generating an impulse response
      // is expensive, so only on a real change.
      if (bus.nodes.reverb.decay !== fx.reverbDecay) {
        bus.nodes.reverb.convolver.buffer = createReverbImpulse(ctx, fx.reverbDecay, fx.reverbDecay);
        bus.nodes.reverb.decay = fx.reverbDecay;
      }
      try {
        bus.nodes.reverb.wetGain.gain.setTargetAtTime(fx.reverbMix, now, 0.02);
      } catch {}
    }

    if (bus.nodes.chorus) {
      try {
        bus.nodes.chorus.delay.delayTime.setTargetAtTime(fx.chorusTime, now, 0.02);
        bus.nodes.chorus.lfo.frequency.setTargetAtTime(fx.chorusRate, now, 0.02);
        bus.nodes.chorus.lfoGain.gain.setTargetAtTime(fx.chorusDepth, now, 0.02);
        bus.nodes.chorus.wetGain.gain.setTargetAtTime(fx.chorusMix, now, 0.02);
      } catch {}
    }
  };

  const syncLaneBuses = (lanes) => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    const soloSet = getSoloSet(lanes);
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

  const getCurrentPlaybackTime = (ctx = audioCtxRef.current) => {
    if (!ctx) return Number(playOffsetRef.current || 0);
    return Math.max(
      Number(playOffsetRef.current || 0),
      ctx.currentTime - playStartRef.current + playOffsetRef.current
    );
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

  const preloadInstrumentsForWindow = async (runtimeState, lanesById, windowStart, windowEnd, audibleLaneIds) => {
    const midiClips = (runtimeState.clips || []).filter((clip) => clip.clipType === "midi" && clip.midi);
    if (!midiClips.length) return;
    const uniqueKeys = new Set();
    const preloadTargets = [];
    midiClips.forEach((clip) => {
      if (!audibleLaneIds.has(clip.laneId)) return;
      const lane = lanesById.get(clip.laneId);
      const bus = laneBusRef.current.get(clip.laneId);
      if (!lane || !bus) return;
      const midi = clip.midi || {};
      const notes = Array.isArray(midi.notes) ? midi.notes : [];
      if (!notes.length) return;
      const bpm = Number(midi.bpm) || runtimeState.project?.bpm || 120;
      const ppq = Number(midi.ppq) || 480;
      const clipStart = Number(clip.timelineStartSec || 0);
      const clipOffsetSec = Number(clip.srcStartSec || 0);
      const clipLen = Math.max(0, Number(clip.srcEndSec || 0) - clipOffsetSec);
      if (!clipLen) return;
      const overlapsWindow = notes.some((note) => {
        const noteStartSec = ticksToSec(note.startTick, bpm, ppq);
        const noteDurSec = Math.max(0.02, ticksToSec(note.durationTick, bpm, ppq));
        const relativeStart = noteStartSec - clipOffsetSec;
        const relativeEnd = relativeStart + noteDurSec;
        const absStart = clipStart + relativeStart;
        const absEnd = clipStart + relativeEnd;
        return absEnd > windowStart && absStart < windowEnd;
      });
      if (!overlapsWindow) return;
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
  };

  const scheduleWindow = async (token) => {
    if (token !== playbackTokenRef.current) return;
    const ctx = ensureContext();
    const runtimeState = stateRef.current;
    const lanes = runtimeState.lanes || [];
    const clips = runtimeState.clips || [];
    const assets = runtimeState.assets || {};
    const soloSet = new Set(lanes.filter((lane) => lane.solo).map((lane) => lane.id));
    const audibleLaneIds = new Set(
      lanes
        .filter((lane) => computeLaneGain(lane, soloSet) > 0)
        .map((lane) => lane.id)
    );

    syncLaneBuses(lanes);

    const currentTime = getCurrentPlaybackTime(ctx);
    const windowStart = Math.max(scheduledUntilRef.current, currentTime);
    const windowEnd = resolveWindowEnd(windowStart, runtimeState);
    if (windowEnd <= windowStart + 0.001) {
      scheduledUntilRef.current = windowEnd;
      return;
    }

    const lanesById = new Map(lanes.map((lane) => [lane.id, lane]));
    await preloadInstrumentsForWindow(runtimeState, lanesById, windowStart, windowEnd, audibleLaneIds);

    const pendingAudioLoads = [];
    const pendingAudioAssets = new Set();
    clips.forEach((clip) => {
      if (clip.clipType === "midi") return;
      if (!audibleLaneIds.has(clip.laneId)) return;
      if (scheduledAudioRef.current.has(clip.id)) return;
      const clipStart = Number(clip.timelineStartSec ?? 0);
      const clipOffset = Number(clip.srcStartSec ?? 0);
      const clipLen = Number(clip.srcEndSec ?? 0) - clipOffset;
      const clipEnd = clipStart + clipLen;
      if (clipLen <= 0 || clipEnd <= windowStart || clipStart >= windowEnd) return;
      const asset = assets[clip.sourceAssetId];
      if (!asset?.url || pendingAudioAssets.has(asset.url)) return;
      pendingAudioAssets.add(asset.url);
      pendingAudioLoads.push(loadBuffer(asset));
    });
    if (pendingAudioLoads.length) {
      await Promise.all(pendingAudioLoads);
    }
    if (token !== playbackTokenRef.current) return;

    clips.forEach((clip) => {
      if (clip.clipType === "midi") return;
      if (!audibleLaneIds.has(clip.laneId)) return;
      if (scheduledAudioRef.current.has(clip.id)) return;

      const lane = lanesById.get(clip.laneId);
      const asset = assets[clip.sourceAssetId];
      const buffer = asset?.url ? bufferCacheRef.current.get(asset.url) : null;
      if (!lane || !buffer) return;

      const clipStart = Number(clip.timelineStartSec ?? 0);
      const clipOffset = Number(clip.srcStartSec ?? 0);
      const clipLen = Number(clip.srcEndSec ?? 0) - clipOffset;
      const clipEnd = clipStart + clipLen;
      if (clipLen <= 0 || clipEnd <= windowStart || clipStart >= windowEnd) return;

      let effectiveStart = Math.max(clipStart, windowStart);
      let offset = clipOffset + (effectiveStart - clipStart);
      let duration = clipEnd - effectiveStart;
      let when = playStartRef.current + (effectiveStart - playOffsetRef.current);
      const minWhen = ctx.currentTime + 0.01;
      if (when < minWhen) {
        const lateBy = minWhen - when;
        effectiveStart += lateBy;
        offset += lateBy;
        duration -= lateBy;
        when = minWhen;
      }
      if (duration <= 0.01) return;

      const pitchShift = clamp(Number(lane.fx?.pitch?.semitones ?? 0), -24, 24);
      const playbackRate = semitonesToRate(pitchShift);
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
      registerSource(source);
      scheduledAudioRef.current.add(clip.id);
    });

    clips.forEach((clip) => {
      if (clip.clipType !== "midi" || !clip.midi) return;
      if (!audibleLaneIds.has(clip.laneId)) return;

      const lane = lanesById.get(clip.laneId);
      if (!lane) return;
      const preferred = clip.midi?.soundfont;
      const name = preferred || resolveSoundfontName(lane.instrument, lane.name);
      const cached = instrumentCacheRef.current.get(`${lane.id}:${name}`);
      const instrument = cached?.instrument;
      if (!instrument) return;

      const midi = clip.midi || {};
      const notes = Array.isArray(midi.notes) ? midi.notes : [];
      if (!notes.length) return;
      const bpm = Number(midi.bpm) || runtimeState.project?.bpm || 120;
      const ppq = Number(midi.ppq) || 480;
      const clipStart = Number(clip.timelineStartSec || 0);
      const clipOffsetSec = Number(clip.srcStartSec || 0);
      const clipLen = Math.max(0, Number(clip.srcEndSec || 0) - clipOffsetSec);
      if (!clipLen) return;
      const pitchShift = clamp(Number(lane.fx?.pitch?.semitones ?? 0), -24, 24);

      notes.forEach((note, noteIndex) => {
        const noteKey = `${clip.id}:${noteIndex}`;
        if (scheduledMidiRef.current.has(noteKey)) return;

        const noteStartSec = ticksToSec(note.startTick, bpm, ppq);
        const noteDurSec = Math.max(0.02, ticksToSec(note.durationTick, bpm, ppq));
        const relativeStart = noteStartSec - clipOffsetSec;
        const relativeEnd = relativeStart + noteDurSec;
        if (relativeEnd <= 0 || relativeStart >= clipLen) return;

        let absStart = clipStart + relativeStart;
        const absEnd = clipStart + relativeEnd;
        if (absEnd <= windowStart || absStart >= windowEnd) return;

        let duration = Math.max(0.02, absEnd - Math.max(windowStart, absStart));
        if (absStart < windowStart) {
          absStart = windowStart;
        }
        let when = playStartRef.current + (absStart - playOffsetRef.current);
        const minWhen = ctx.currentTime + 0.01;
        if (when < minWhen) {
          const lateBy = minWhen - when;
          absStart += lateBy;
          duration -= lateBy;
          when = minWhen;
        }
        if (duration <= 0.02) return;

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
          if (node?.stop) {
            registerSource(node);
          }
          scheduledMidiRef.current.add(noteKey);
        } catch (err) {
          console.warn("Failed to play MIDI note", err);
        }
      });
    });

    scheduledUntilRef.current = windowEnd;
  };

  const scheduleAhead = async (token = playbackTokenRef.current) => {
    if (token !== playbackTokenRef.current || scheduleBusyRef.current) return;
    scheduleBusyRef.current = true;
    try {
      const ctx = ensureContext();
      while (token === playbackTokenRef.current) {
        const currentTime = getCurrentPlaybackTime(ctx);
        if (scheduledUntilRef.current - currentTime >= PLAYBACK_LOOKAHEAD_SEC * 0.75) {
          break;
        }
        const previousEnd = scheduledUntilRef.current;
        await scheduleWindow(token);
        if (scheduledUntilRef.current <= previousEnd + 0.0001) {
          break;
        }
      }
    } finally {
      scheduleBusyRef.current = false;
    }
  };

  const startPlaybackSession = async (startTimeSec) => {
    const ctx = ensureContext();
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    stopSources();
    resetPlaybackScheduling(startTimeSec);
    playOffsetRef.current = Math.max(0, Number(startTimeSec) || 0);
    playStartRef.current = ctx.currentTime + PLAYBACK_START_DELAY_SEC;
    const token = playbackTokenRef.current;

    await scheduleAhead(token);
    if (token !== playbackTokenRef.current) return;

    const tick = () => {
      if (token !== playbackTokenRef.current) return;
      const runtimeState = stateRef.current;
      const current = getCurrentPlaybackTime(ctx);
      const loopBounds = getLoopBounds(runtimeState);
      if (loopBounds && current >= loopBounds.end && !loopRestartRef.current) {
        loopRestartRef.current = true;
        startPlaybackSession(loopBounds.start)
          .then(() => {
            loopRestartRef.current = false;
            actions.setTransport({ currentTime: loopBounds.start });
          })
          .catch(() => {
            loopRestartRef.current = false;
          });
        return;
      }
      if (
        !scheduleBusyRef.current &&
        scheduledUntilRef.current - current < PLAYBACK_LOOKAHEAD_SEC * 0.5
      ) {
        scheduleAhead(token);
      }
      const nowMs = performance.now();
      if (nowMs - lastTransportUpdateRef.current >= PLAYBACK_TRANSPORT_UPDATE_MS) {
        lastTransportUpdateRef.current = nowMs;
        actions.setTransport({ currentTime: current });
      }
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
    loopRestartRef.current = false;
    const runtimeState = stateRef.current;
    const loopEnabled = runtimeState.ui.loop && runtimeState.selection?.range;
    const loopStart = loopEnabled
      ? Math.min(runtimeState.selection.range.start, runtimeState.selection.range.end)
      : null;
    const loopEnd = loopEnabled
      ? Math.max(runtimeState.selection.range.start, runtimeState.selection.range.end)
      : null;
    let startTime = runtimeState.transport.currentTime || 0;
    if (loopEnabled && loopEnd > loopStart && (startTime < loopStart || startTime > loopEnd)) {
      startTime = loopStart;
    }
    const ctx = ensureContext();
    if (ctx.state === "suspended") {
      await ctx.resume();
    }
    syncLaneBuses(runtimeState.lanes || []);
    stopMetronome();
    startMetronome();
    await startPlaybackSession(startTime);
    actions.setTransport({ isPlaying: true });
  };

  const pause = () => {
    if (!audioCtxRef.current) return;
    loopRestartRef.current = false;
    const current = getCurrentPlaybackTime(audioCtxRef.current);
    resetPlaybackScheduling(current);
    stopSources();
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    stopMetronome();
    actions.setTransport({ isPlaying: false, currentTime: current });
  };

  const stop = () => {
    loopRestartRef.current = false;
    resetPlaybackScheduling(0);
    stopSources();
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
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
    if (stateRef.current.transport.isPlaying) {
      loopRestartRef.current = false;
      stopSources();
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      startPlaybackSession(time);
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
