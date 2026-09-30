import { useEffect, useRef, useState } from 'react';
import {
  PLAYBACK_LOOKAHEAD_SEC,
  PLAYBACK_START_DELAY_SEC,
  PLAYBACK_TRANSPORT_UPDATE_MS,
  DRUM_KIT_NAME,
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
import { tileRecordedSpanIntoClips } from "../sessionRecording";
import { createDrumKit } from "../audio/drumKit";
import {
  getMasterAudioContext,
  getMasterInputNode,
  setMasterVolume,
  setMasterPan,
  subscribeMasterAudio,
} from "../../masterAudio";

/* Wraps a spessasynth WorkletSynthesizer channel behind the exact same
   `{ play(noteName, when, {duration, gain}) -> { stop(atTime) } }` shape
   soundfont-player's instruments already use — every existing preview/clip/
   transport call site keeps working unmodified against a custom-imported
   soundfont, it never needs to know which engine is actually playing. */
class SpessaInstrumentAdapter {
  constructor(synth, channel) {
    this.synth = synth;
    this.channel = channel;
  }

  play(noteName, when, opts = {}) {
    const midi = noteNameToMidi(noteName);
    const velocity = Math.max(1, Math.min(127, Math.round(clamp(Number(opts.gain ?? 0.8), 0, 1) * 127)));
    const duration = Math.max(0.02, Number(opts.duration) || 0.2);
    this.synth.noteOn(this.channel, midi, velocity, { time: when });
    this.synth.noteOff(this.channel, midi, { time: when + duration });
    return {
      stop: (atTime) => {
        try {
          this.synth.noteOff(this.channel, midi, typeof atTime === "number" ? { time: atTime } : undefined);
        } catch {}
      },
    };
  }
}

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
  // play() is async (ctx.resume(), startPlaybackSession()'s own awaits) but the transport
  // button has no disabled-while-pending state, and isPlaying in React state only flips once
  // play() finishes - so a rapid double-click fired a second play() (or a pause()) into the
  // middle of the first one's still-running async work. pause()'s stopSources() only stops
  // whatever startPlaybackSession had registered *so far*; anything that finished scheduling
  // after that (still legitimately from the first play() call) became an orphaned source that
  // never stops, invisible to sourcesRef from then on - repeated enough times, playback looked
  // permanently stuck since every new play()/pause() was really racing leftover ghosts.
  const playPauseBusyRef = useRef(false);
  const spessaModuleRef = useRef(null);
  const spessaWorkletReadyRef = useRef(null);
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

  /* The shared, app-wide AudioContext — the same one next/player.js's plain
     <audio> element routes through — not a private one. Every Studio node
     this hook creates below has to live on this exact context instance, or
     .connect()ing it to anything shared throws ("cannot connect nodes from
     different AudioContexts"). */
  const ensureContext = () => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = getMasterAudioContext();
    }
    return audioCtxRef.current;
  };

  /* Everything audible converges here before the shared master gain/pan —
     so the "Main" fader is one knob for the whole app, not one knob per lane
     bus times one knob per other sound source in the app. */
  const getMasterInput = () => {
    ensureContext();
    return getMasterInputNode();
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

  const loadSpessaSynthModule = async () => {
    if (spessaModuleRef.current) return spessaModuleRef.current;
    const mod = await import("spessasynth_lib");
    spessaModuleRef.current = mod;
    return mod;
  };

  const ensureSpessaWorklet = async (ctx) => {
    if (!spessaWorkletReadyRef.current) {
      const moduleUrl = new URL("../audio/spessasynthProcessor.js", import.meta.url);
      spessaWorkletReadyRef.current = ctx.audioWorklet.addModule(moduleUrl);
    }
    return spessaWorkletReadyRef.current;
  };

  /* A lane pointed at an imported .sf2/.sf3/.dls asset (lane.instrument ===
     "soundfont:<assetId>") gets its own WorkletSynthesizer loaded straight
     from that file's bytes, instead of the shared FluidR3_GM bank every
     other lane uses. One synth per lane (not shared/pooled) — simplest
     correct thing, and a lane's instrument changes rarely enough that the
     reload cost on switching doesn't matter. */
  const loadCustomSoundfontInstrument = async (lane, destination, assetId) => {
    const asset = stateRef.current.assets?.[assetId];
    if (!asset?.url) throw new Error(`Soundfont asset not found: ${assetId}`);
    const ctx = ensureContext();
    await ensureSpessaWorklet(ctx);
    const { WorkletSynthesizer } = await loadSpessaSynthModule();
    const synth = new WorkletSynthesizer(ctx);
    synth.connect(destination || getMasterInput());
    const response = await fetch(asset.url);
    if (!response.ok) throw new Error(`Failed to fetch soundfont: ${response.status}`);
    const buffer = await response.arrayBuffer();
    await synth.soundBankManager.addSoundBank(buffer, "main");
    await synth.isReady;
    synth.programChange(0, 0);
    return new SpessaInstrumentAdapter(synth, 0);
  };

  const loadInstrumentForLane = async (lane, destination, soundfontName) => {
    if (!lane) return null;
    if (typeof lane.instrument === "string" && lane.instrument.startsWith("soundfont:")) {
      const assetId = lane.instrument;
      const cacheKey = `${lane.id}:${assetId}`;
      const cached = instrumentCacheRef.current.get(cacheKey);
      if (cached && cached.name === assetId && cached.instrument) return cached.instrument;
      if (cached && cached.name === assetId && cached.promise) return cached.promise;
      const promise = loadCustomSoundfontInstrument(lane, destination, assetId).catch((err) => {
        console.warn("Custom soundfont load failed, falling back to default instrument.", err);
        return null;
      });
      instrumentCacheRef.current.set(cacheKey, { name: assetId, promise, laneId: lane.id });
      const instrument = await promise;
      if (instrument) {
        instrumentCacheRef.current.set(cacheKey, { name: assetId, instrument, laneId: lane.id });
        return instrument;
      }
      instrumentCacheRef.current.delete(cacheKey);
      // fall through to the default GM path below on failure, same as any
      // other lane, rather than leaving the lane silent.
    }
    const name = soundfontName || resolveSoundfontName(lane.instrument, lane.name);
    const cacheKey = `${lane.id}:${name}`;
    const cached = instrumentCacheRef.current.get(cacheKey);
    if (cached && cached.name === name && cached.instrument) return cached.instrument;
    if (cached && cached.name === name && cached.promise) return cached.promise;
    if (name === DRUM_KIT_NAME) {
      // Synthesized on the spot, nothing to fetch — no promise/loading state needed.
      const instrument = createDrumKit(audioCtxRef.current, destination);
      instrumentCacheRef.current.set(cacheKey, { name, instrument, laneId: lane.id });
      return instrument;
    }
    // MusyngKite over FluidR3_GM: same host, same instrument-name scheme (General MIDI), same
    // soundfont-player mp3 format — just multi-velocity-layered samples instead of FluidR3_GM's
    // single-layer ~20-year-old GM set, so it's a drop-in quality upgrade with zero architecture
    // change. Confirmed both banks are actually hosted at this CDN before switching (curl 200 on
    // MusyngKite's acoustic_grand_piano-mp3.js and violin-mp3.js).
    const soundfontUrl =
      process.env.REACT_APP_SOUNDFONT_URL || "https://gleitz.github.io/midi-js-soundfonts/MusyngKite/";
    const promise = (async () => {
      try {
        const Soundfont = await loadSoundfontModule();
        return await Soundfont.instrument(audioCtxRef.current, name, {
          soundfont: "MusyngKite",
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
              soundfont: "MusyngKite",
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

    output.connect(getMasterInput());
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
      // clip.tempoRate is the drag-drop "stretch to match project BPM" choice
      // (Timeline.js handleExternalDrop) — a plain speed change stacked onto the lane's own
      // pitch-shift rate the exact same way, so it shifts pitch too; that tradeoff is disclosed
      // to the user when they pick it, not silent.
      const tempoRate = Number(clip.tempoRate) > 0 ? Number(clip.tempoRate) : 1;
      const playbackRate = semitonesToRate(pitchShift) * tempoRate;
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
        source.connect(gainNode).connect(getMasterInput());
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
    osc.connect(gain).connect(getMasterInput());
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
    if (playPauseBusyRef.current) return;
    playPauseBusyRef.current = true;
    try {
      stopAllClipSlots();
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
    } finally {
      playPauseBusyRef.current = false;
    }
  };

  const pause = () => {
    // Ignore a pause that lands mid-startup rather than racing it: play() isn't done
    // registering its sources yet, so stopping "everything" now wouldn't actually stop
    // everything - see playPauseBusyRef's comment above the mask.
    if (playPauseBusyRef.current) return;
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

  /* Session/pattern view (speed-beatmaker backlog item #1): clip-slot playback is independent of
     the linear timeline transport, and deliberately MUTUALLY EXCLUSIVE with it — triggering a
     scene pauses the timeline if it was running, and starting the timeline (play()) stops every
     active clip-slot loop. A real Ableton-style simultaneous mix of Session + Arrangement
     playback needs two time bases reconciled against one shared lane-bus graph — a much bigger
     undertaking, deliberately out of scope here. */
  const activeClipSlotsRef = useRef(new Map()); // clipSlotId -> { stop(atTime), timer }
  const [activeClipSlotIds, setActiveClipSlotIds] = useState(() => new Set());

  /* "Record to Timeline" (Ableton-style "Record to Arrangement"): while active, every clip-slot
     actually triggered gets tracked as an open [start, now) span per lane (one at a time, same
     "one clip-slot playing per lane" rule triggerClipSlot already enforces) and materialized into
     real, non-looping Timeline clips — via sessionRecording.js's tiling — the moment that span
     closes (replaced by another clip-slot on the same lane, manually stopped, or recording itself
     turned off). recordingBaseRef anchors the conversion from the AudioContext's own clock (what
     triggerClipSlot's quantization already runs on) to Timeline seconds: captured once, when
     recording turns on, as {ctxTime: ctx.currentTime, transportSec: the playhead position it
     should be inserted at} — every later ctx.currentTime maps to transportSec + elapsed ctx time.
     Deliberately NOT tied to the linear transport's own play/pause (Session and Timeline playback
     are already mutually exclusive, see triggerScene) — recording is its own independent toggle. */
  const recordingBaseRef = useRef(null); // { ctxTime, transportSec } | null
  const recordingSpansRef = useRef(new Map()); // laneId -> { slot, startCtxTime }
  const [recordingToTimeline, setRecordingToTimeline] = useState(false);
  // Mirrors recordingToTimeline into a ref: triggerClipSlot/stopClipSlot read this inside plain
  // functions (not React effects), where a stale closure over the state value would otherwise
  // miss a toggle that happened after the function was created.
  const recordingToTimelineRef = useRef(false);
  recordingToTimelineRef.current = recordingToTimeline;

  const timelineSecFromCtxTime = (ctxTime) => {
    const base = recordingBaseRef.current;
    if (!base) return 0;
    return base.transportSec + Math.max(0, ctxTime - base.ctxTime);
  };

  const closeRecordingSpan = (laneId, endCtxTime) => {
    const open = recordingSpansRef.current.get(laneId);
    if (!open) return;
    recordingSpansRef.current.delete(laneId);
    const startTimelineSec = timelineSecFromCtxTime(open.startCtxTime);
    const endTimelineSec = timelineSecFromCtxTime(endCtxTime);
    const clips = tileRecordedSpanIntoClips({
      laneId,
      assetId: open.slot.assetId,
      srcStartSec: Number(open.slot.srcStartSec) || 0,
      srcEndSec: Number(open.slot.srcEndSec) || 0,
      clipType: open.slot.clipType,
      midi: open.slot.midi,
      gainDb: open.slot.gainDb,
      label: open.slot.label,
      startTimelineSec,
      endTimelineSec,
    });
    if (clips.length) actions.addTimelineClips(clips);
  };

  const openRecordingSpan = (slot, startCtxTime) => {
    if (!recordingToTimelineRef.current) return;
    closeRecordingSpan(slot.laneId, startCtxTime); // seamless back-to-back, no gap on the lane
    recordingSpansRef.current.set(slot.laneId, { slot, startCtxTime });
  };

  const toggleRecordToTimeline = () => {
    if (recordingToTimelineRef.current) {
      const ctx = audioCtxRef.current;
      const endCtxTime = ctx ? ctx.currentTime : recordingBaseRef.current?.ctxTime ?? 0;
      Array.from(recordingSpansRef.current.keys()).forEach((laneId) => closeRecordingSpan(laneId, endCtxTime));
      recordingBaseRef.current = null;
      setRecordingToTimeline(false);
      return;
    }
    const ctx = ensureContext();
    recordingBaseRef.current = { ctxTime: ctx.currentTime, transportSec: stateRef.current.transport.currentTime || 0 };
    recordingToTimelineRef.current = true;
    setRecordingToTimeline(true);
    // Capture whatever's already playing when the user hits record, same as a real DAW would.
    activeClipSlotsRef.current.forEach((entry, slotId) => {
      const slot = (stateRef.current.clipSlots || []).find((item) => item.id === slotId);
      if (slot) openRecordingSpan(slot, ctx.currentTime);
    });
  };

  const stopClipSlot = (slotId) => {
    const entry = activeClipSlotsRef.current.get(slotId);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    if (typeof entry.stop === "function") {
      try {
        entry.stop();
      } catch {}
    }
    activeClipSlotsRef.current.delete(slotId);
    setActiveClipSlotIds(new Set(activeClipSlotsRef.current.keys()));
    if (recordingToTimelineRef.current) {
      const slot = (stateRef.current.clipSlots || []).find((item) => item.id === slotId);
      if (slot) closeRecordingSpan(slot.laneId, audioCtxRef.current ? audioCtxRef.current.currentTime : 0);
    }
  };

  const stopAllClipSlots = () => {
    Array.from(activeClipSlotsRef.current.keys()).forEach(stopClipSlot);
  };

  /* Next bar boundary from the AudioContext's own clock (t=0 at context creation) — good enough
     quantization for a "speed" workflow (wait for the next downbeat before a loop actually
     starts), not a full musical-time engine with time-signature-aware subdivisions. Assumes 4/4,
     the same simple model the rest of Studio's playback already uses. */
  const nextBarTime = (ctx, bpm) => {
    const secPerBar = (60 / (Number(bpm) || 120)) * 4;
    const bars = Math.floor(ctx.currentTime / secPerBar) + 1;
    return bars * secPerBar;
  };

  const triggerClipSlot = async (slot, { quantize = true } = {}) => {
    if (!slot?.laneId) return;
    const ctx = ensureContext();
    if (ctx.state === "suspended") {
      try {
        await ctx.resume();
      } catch {}
    }
    const runtimeState = stateRef.current;
    const lane = (runtimeState.lanes || []).find((item) => item.id === slot.laneId);
    if (!lane) return;
    syncLaneBuses(runtimeState.lanes || []);
    let laneBus = laneBusRef.current.get(slot.laneId);
    if (!laneBus) {
      laneBus = buildLaneBus(ctx, lane);
      laneBusRef.current.set(slot.laneId, laneBus);
    }
    // One playing clip-slot per lane at a time — same "launching a clip stops whatever else was
    // playing on that track" rule every clip-launch DAW uses, not just per-scene exclusivity.
    Array.from(activeClipSlotsRef.current.keys())
      .filter((slotId) => runtimeState.clipSlots?.find((item) => item.id === slotId)?.laneId === slot.laneId)
      .forEach(stopClipSlot);
    stopClipSlot(slot.id);
    const bpm = Number(runtimeState.project?.bpm) || 120;
    const when = quantize ? nextBarTime(ctx, bpm) : ctx.currentTime;
    const pitchShift = clamp(Number(lane.fx?.pitch?.semitones ?? 0), -24, 24);
    openRecordingSpan(slot, when);

    if (slot.clipType === "midi" && slot.midi) {
      const notes = Array.isArray(slot.midi.notes) ? slot.midi.notes : [];
      if (!notes.length) return;
      const midiBpm = Number(slot.midi.bpm) || bpm;
      const ppq = Number(slot.midi.ppq) || 480;
      const clipOffsetSec = Number(slot.srcStartSec || 0);
      const clipLen = Math.max(0.02, Number(slot.srcEndSec || 0) - clipOffsetSec);
      const name = slot.midi.soundfont || resolveSoundfontName(lane.instrument, lane.name);
      const instrument = await loadInstrumentForLane(lane, laneBus.input, name);
      if (!instrument || !activeClipSlotsRef.current) return;

      const scheduleLoop = (startAt) => {
        const nodes = [];
        notes.forEach((note) => {
          const noteStartSec = ticksToSec(note.startTick, midiBpm, ppq);
          const noteDurSec = Math.max(0.02, ticksToSec(note.durationTick, midiBpm, ppq));
          const relativeStart = noteStartSec - clipOffsetSec;
          if (relativeStart < 0 || relativeStart >= clipLen) return;
          const noteWhen = startAt + relativeStart;
          const duration = Math.min(noteDurSec, clipLen - relativeStart);
          const velocity = clamp(Number(note.velocity ?? 100), 1, 127);
          const gain = clamp((velocity / 127) * dbToGain(slot.gainDb ?? 0), 0, 1);
          const noteNumber = clamp(Number(note.note ?? note.midi ?? 60) + pitchShift, 0, 127);
          try {
            const node = instrument.play(midiNoteToName(noteNumber), noteWhen, { duration, gain });
            if (node) nodes.push(node);
          } catch {}
        });
        const timer = setTimeout(() => {
          if (!activeClipSlotsRef.current.has(slot.id)) return;
          scheduleLoop(startAt + clipLen);
        }, Math.max(0, startAt + clipLen - ctx.currentTime) * 1000);
        activeClipSlotsRef.current.set(slot.id, {
          stop: () => nodes.forEach((node) => node.stop?.()),
          timer,
        });
        setActiveClipSlotIds(new Set(activeClipSlotsRef.current.keys()));
      };
      scheduleLoop(when);
      return;
    }

    const asset = runtimeState.assets?.[slot.assetId];
    if (!asset?.url) return;
    const buffer = await loadBuffer(asset);
    if (!buffer) return;
    const srcStart = Number(slot.srcStartSec || 0);
    const srcEnd = Number(slot.srcEndSec || buffer.duration);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.loopStart = srcStart;
    source.loopEnd = Math.max(srcStart + 0.02, srcEnd);
    try {
      source.playbackRate.setValueAtTime(semitonesToRate(pitchShift), when);
    } catch {}
    const gainNode = ctx.createGain();
    gainNode.gain.value = dbToGain(slot.gainDb ?? 0);
    source.connect(gainNode).connect(laneBus.input);
    source.start(when, srcStart);
    registerSource(source);
    activeClipSlotsRef.current.set(slot.id, {
      stop: (atTime) => {
        try {
          source.stop(atTime);
        } catch {}
      },
    });
    setActiveClipSlotIds(new Set(activeClipSlotsRef.current.keys()));
  };

  const triggerScene = async (sceneId) => {
    if (stateRef.current.transport.isPlaying) pause();
    const slots = (stateRef.current.clipSlots || []).filter((slot) => slot.sceneId === sceneId);
    await Promise.all(slots.map((slot) => triggerClipSlot(slot)));
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
    /* Keyed on the lanes alone, deliberately. syncLaneBuses and everything it
       calls take what they need as arguments or read it from refs — the chain
       closes over no reactive value, so there is no stale closure to catch
       here. Listing it unwrapped would rebuild the audio graph on every
       render, which is audible: buses torn down and rebuilt mid-playback. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.lanes]);

  /* Moving Studio's own "Main" fader only changes state.ui — this is what
     forwards that into the shared, app-wide master node (see masterAudio.js),
     which is what every sound in the app actually plays through. setMaster*
     no-ops when the value hasn't changed, so this being unconditional (no
     audioCtxRef guard) doesn't fight the reverse sync that seeds state.ui
     from the shared node in the first place (studio/store.js's initial
     state, and StudioView's project-load effect). */
  useEffect(() => {
    setMasterVolume(Number.isFinite(state.ui.masterVolume) ? state.ui.masterVolume : 1);
    setMasterPan(Number.isFinite(state.ui.masterPan) ? state.ui.masterPan : 0);
  }, [state.ui.masterVolume, state.ui.masterPan]);

  /* The other direction: Studio stays mounted in the background once opened
     (see NextApp's studioMounted), so the standalone fader outside Studio can
     move the shared node while this hook is still alive but not the active
     view. Without this, state.ui — and the per-project prefs it persists to
     — would go stale the moment you left Studio and adjusted volume from
     Library. setUi with the same numbers the effect above just pushed is a
     no-op re-render, not a loop: the dependency array above only reacts to
     state.ui actually changing. */
  useEffect(() => subscribeMasterAudio(({ volume, pan }) => {
    actions.setUi({ masterVolume: volume, masterPan: pan });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  return {
    play,
    pause,
    stop,
    seek,
    previewMidiNote,
    stopPreviewMidiNote,
    previewMidiClip,
    stopPreviewMidiClip,
    triggerClipSlot,
    triggerScene,
    stopClipSlot,
    stopAllClipSlots,
    activeClipSlotIds,
    recordingToTimeline,
    toggleRecordToTimeline,
  };
};
