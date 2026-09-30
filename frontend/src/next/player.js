import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { getMasterAudioContext, getMasterInputNode, resumeMasterAudio } from "../masterAudio";

/**
 * One audio element for the whole app.
 *
 * Every waveform, every row and every card plays through this, which is the
 * only way "press play here, it stops playing over there" works without each
 * component knowing about the others. It also means the player bar at the
 * bottom is never out of step with what you actually hear.
 *
 * A `sourceId` identifies what is loaded — usually `${songId}:${assetKey}` —
 * so switching between a song's original and converted take is a source swap
 * that keeps the position, not a new track.
 */

const PlayerContext = createContext(null);

export function PlayerProvider({ children }) {
  const audioRef = useRef(null);
  if (!audioRef.current && typeof Audio !== "undefined") {
    audioRef.current = new Audio();
    audioRef.current.preload = "metadata";
  }

  const [state, setState] = useState({
    sourceId: null,
    url: null,
    title: "",
    subtitle: "",
    // Artwork for the player bar. Carried on the play call rather than looked
    // up there, because the bar has no idea which song a sourceId belongs to.
    cover: null,
    tint: null,
    playing: false,
    position: 0,
    duration: 0,
  });

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;

    const onTime = () => setState((s) => ({ ...s, position: audio.currentTime || 0 }));
    const onMeta = () =>
      setState((s) => ({ ...s, duration: Number.isFinite(audio.duration) ? audio.duration : 0 }));
    const onPlay = () => setState((s) => ({ ...s, playing: true }));
    const onPause = () => setState((s) => ({ ...s, playing: false }));
    const onEnd = () => setState((s) => ({ ...s, playing: false, position: 0 }));

    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("durationchange", onMeta);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnd);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("durationchange", onMeta);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnd);
      audio.pause();
    };
  }, []);

  /* Routes this element's output through the shared master gain/pan node
     instead of straight to the speakers, so the one app-wide volume/pan
     control also covers every preview played from here. createMediaElement-
     Source can only be called once per element — that's the whole reason
     there is exactly one <audio> for the app (see the module comment above)
     rather than one per player instance. */
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;
    const context = getMasterAudioContext();
    const source = context.createMediaElementSource(audio);
    source.connect(getMasterInputNode());
    return undefined;
  }, []);

  /**
   * Load and play a source, or toggle it if it is the one already loaded.
   *
   * `keepPosition` is what makes the original/converted switch feel like one
   * take in two voices rather than two files: the same performance, so landing
   * back at 0:00 on every switch would be wrong.
   */
  const play = useCallback(({ sourceId, url, title, subtitle, cover, tint, keepPosition = false }) => {
    const audio = audioRef.current;
    if (!audio || !url) return;
    resumeMasterAudio();

    if (state.sourceId === sourceId) {
      if (audio.paused) audio.play().catch(() => {});
      else audio.pause();
      return;
    }

    const resumeAt = keepPosition ? audio.currentTime || 0 : 0;
    const wasPlaying = keepPosition ? !audio.paused : true;

    // Reassigning .src is supposed to reset currentTime on its own (the media element
    // load algorithm), but if a seek from the *previous* track was still in flight - the
    // scrub bar's onClick just set currentTime and the browser hadn't finished acting on
    // it yet - interrupting that with an immediate src swap can leave Chromium's media
    // pipeline holding onto the old seek target instead of cleanly restarting at 0.
    // Clearing it explicitly, before the swap, means there's nothing left mid-flight for
    // the new source to inherit.
    if (!keepPosition) {
      try {
        audio.currentTime = 0;
      } catch {}
    }
    audio.src = url;
    setState((s) => ({
      ...s,
      sourceId,
      url,
      title: title ?? s.title,
      subtitle: subtitle ?? s.subtitle,
      cover: cover !== undefined ? cover : s.cover,
      tint: tint !== undefined ? tint : s.tint,
      position: resumeAt,
      duration: 0,
    }));

    audio.load();

    // play() has to be called synchronously here, still inside the click that
    // led to it. Deferring it to a loadedmetadata handler — which is what this
    // used to do, so the seek could happen first — leaves the user-activation
    // stack, and Chrome refuses the call outright: the track loads, the button
    // stays on "play", and nothing tells you why.
    if (wasPlaying) audio.play().catch(() => {});

    // Seeking, on the other hand, genuinely cannot happen before the duration
    // is known, so it stays deferred.
    if (resumeAt > 0) {
      const seekOnce = () => {
        audio.removeEventListener("loadedmetadata", seekOnce);
        if (!Number.isFinite(audio.duration)) return;
        audio.currentTime = Math.min(resumeAt, Math.max(0, audio.duration - 0.05));
      };
      audio.addEventListener("loadedmetadata", seekOnce);
    }
  }, [state.sourceId]);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !audio.src) return;
    resumeMasterAudio();
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
  }, []);

  const seek = useCallback((ratio) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration)) return;
    audio.currentTime = Math.min(Math.max(0, ratio), 1) * audio.duration;
  }, []);

  const stop = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    setState((s) => ({ ...s, sourceId: null, url: null, cover: null, tint: null, playing: false, position: 0, duration: 0 }));
  }, []);

  const value = useMemo(
    () => ({ ...state, play, toggle, seek, stop, progress: state.duration ? state.position / state.duration : 0 }),
    [state, play, toggle, seek, stop]
  );

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

export const usePlayer = () => {
  const context = useContext(PlayerContext);
  if (!context) throw new Error("usePlayer must be used inside a PlayerProvider");
  return context;
};

export const formatTime = (seconds) => {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};
