import { noteNameToMidi } from "../audioMath";

/* A built-in General MIDI drum kit, synthesized with plain Web Audio nodes.

   The soundfont CDN this app plays melodic instruments from has no GM percussion channel — its
   "synth_drum" is a pitched synth, so a Kick pad (note 36) played it as a low synth blip, not a
   kick. This answers the same `play(noteName, when, {gain})` shape soundfont-player instruments
   do, mapped by the standard GM drum note numbers DrumPads.js already sends, so any drum lane or
   MIDI clip gets real kick/snare/hat sounds without downloading or shipping samples. */

const noiseBuffers = new WeakMap();
const getNoise = (ctx) => {
  let buffer = noiseBuffers.get(ctx);
  if (!buffer) {
    const length = Math.floor(ctx.sampleRate * 1.5);
    buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    noiseBuffers.set(ctx, buffer);
  }
  return buffer;
};

const TOM_HZ = { 41: 80, 43: 100, 45: 120, 47: 150, 48: 175, 50: 200 };

export const createDrumKit = (ctx, destination) => {
  const noise = (t, { type, freq, q = 1, attack = 0.001, decay, level, out }) => {
    const src = ctx.createBufferSource();
    src.buffer = getNoise(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(level, t + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    src.connect(filter).connect(env).connect(out);
    src.start(t);
    src.stop(t + attack + decay + 0.05);
    return src;
  };

  const tone = (t, { type = "sine", from, to, sweep = 0.1, decay, level, out }) => {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + sweep);
    const env = ctx.createGain();
    env.gain.setValueAtTime(level, t);
    env.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    osc.connect(env).connect(out);
    osc.start(t);
    osc.stop(t + decay + 0.05);
    return osc;
  };

  const voice = (midi, t, out) => {
    if (midi === 35 || midi === 36) {
      return [
        tone(t, { from: 160, to: 45, sweep: 0.12, decay: 0.45, level: 1, out }),
        tone(t, { type: "triangle", from: 900, to: 120, sweep: 0.02, decay: 0.03, level: 0.5, out }),
      ];
    }
    if (midi === 38 || midi === 40) {
      return [
        noise(t, { type: "highpass", freq: 1500, decay: 0.2, level: 0.8, out }),
        tone(t, { type: "triangle", from: 220, to: 160, sweep: 0.08, decay: 0.12, level: 0.7, out }),
      ];
    }
    if (midi === 37) {
      return [
        tone(t, { type: "square", from: 900, to: 700, sweep: 0.02, decay: 0.04, level: 0.35, out }),
        noise(t, { type: "bandpass", freq: 3000, decay: 0.03, level: 0.4, out }),
      ];
    }
    if (midi === 39) {
      return [0, 0.012, 0.024].map((offset) =>
        noise(t + offset, { type: "bandpass", freq: 1500, q: 1.2, decay: offset === 0.024 ? 0.18 : 0.02, level: 0.8, out })
      );
    }
    if (midi === 42 || midi === 44) {
      return [noise(t, { type: "highpass", freq: 7000, decay: 0.05, level: 0.55, out })];
    }
    if (midi === 46) {
      return [noise(t, { type: "highpass", freq: 7000, decay: 0.35, level: 0.5, out })];
    }
    if (TOM_HZ[midi]) {
      const hz = TOM_HZ[midi];
      return [tone(t, { from: hz * 1.5, to: hz, sweep: 0.15, decay: 0.4, level: 0.9, out })];
    }
    if (midi === 49 || midi === 57) {
      return [noise(t, { type: "highpass", freq: 5000, decay: 1.2, level: 0.5, out })];
    }
    if (midi === 51 || midi === 59 || midi === 52 || midi === 55) {
      return [noise(t, { type: "highpass", freq: 6000, q: 2, decay: 0.6, level: 0.4, out })];
    }
    return [noise(t, { type: "bandpass", freq: 2500, decay: 0.08, level: 0.5, out })];
  };

  return {
    play(noteName, when, opts = {}) {
      const midi = noteNameToMidi(noteName);
      const t = Math.max(Number(when) || 0, ctx.currentTime);
      const master = ctx.createGain();
      master.gain.value = Math.max(0, Math.min(1, Number(opts.gain ?? 0.8)));
      master.connect(destination);
      const nodes = voice(midi, t, master);
      return {
        stop: (atTime) => {
          nodes.forEach((node) => {
            try {
              node.stop(atTime);
            } catch {}
          });
        },
      };
    },
  };
};
