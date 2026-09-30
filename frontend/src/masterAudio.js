import { useEffect, useState } from "react";

/**
 * One AudioContext, one master gain + pan node, shared by every sound the
 * app plays — the simple track-preview <audio> element (next/player.js) and
 * Studio's own mix bus (studio/hooks/useStudioPlayback.js) both route
 * through this on their way to the speakers, instead of each keeping its
 * own private volume. One fader anywhere in the app is then really one
 * fader, not two that happen to look alike.
 *
 * Deliberately a plain module, not a React context: Studio's audio engine
 * needs the live AudioContext/node instances themselves (to .connect()
 * buffers and oscillators to), not just the numbers a component could read
 * from context. `useMasterAudio` below is the React-facing view onto the
 * same state, for the fader UI.
 */

const STORAGE_KEY = "rx-master-audio";
const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));

let ctx = null;
let gainNode = null;
let panNode = null;
let volume = 1;
let pan = 0;
const listeners = new Set();

const loadStored = () => {
  try {
    const raw = window.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (Number.isFinite(parsed.volume)) volume = clamp(parsed.volume, 0, 1.25);
    if (Number.isFinite(parsed.pan)) pan = clamp(parsed.pan, -1, 1);
  } catch {}
};
if (typeof window !== "undefined") loadStored();

const persist = () => {
  try {
    window.localStorage?.setItem(STORAGE_KEY, JSON.stringify({ volume, pan }));
  } catch {}
};

const notify = () => listeners.forEach((fn) => fn({ volume, pan }));

export const getMasterAudioContext = () => {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    gainNode = ctx.createGain();
    panNode = ctx.createStereoPanner();
    gainNode.gain.value = volume;
    panNode.pan.value = pan;
    gainNode.connect(panNode).connect(ctx.destination);
  }
  return ctx;
};

/** What anything producing sound should .connect() its output into. */
export const getMasterInputNode = () => {
  getMasterAudioContext();
  return gainNode;
};

/** AudioContexts start suspended until a user gesture resumes them; call this
 *  from inside the click/keydown handler that starts playback. */
export const resumeMasterAudio = () => {
  const context = getMasterAudioContext();
  if (context.state === "suspended") context.resume().catch(() => {});
  return context;
};

export const getMasterVolume = () => volume;
export const getMasterPan = () => pan;

export const setMasterVolume = (value) => {
  const next = clamp(Number(value), 0, 1.25);
  if (next === volume) return;
  volume = next;
  if (gainNode) gainNode.gain.value = volume;
  persist();
  notify();
};

export const setMasterPan = (value) => {
  const next = clamp(Number(value), -1, 1);
  if (next === pan) return;
  pan = next;
  if (panNode) panNode.pan.value = pan;
  persist();
  notify();
};

export const subscribeMasterAudio = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/** The fader UI's hook — live volume/pan plus setters, kept in sync with
 *  changes made from anywhere else (Studio's own fader, another component). */
export const useMasterAudio = () => {
  const [state, setState] = useState({ volume, pan });
  useEffect(() => subscribeMasterAudio(setState), []);
  return { volume: state.volume, pan: state.pan, setVolume: setMasterVolume, setPan: setMasterPan };
};
