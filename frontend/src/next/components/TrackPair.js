import React, { useEffect, useRef, useState } from "react";
import Waveform from "./Waveform";
import { usePlayer } from "../player";
import { gradientFor } from "../gradients";
import useScrub from "../useScrub";
import useIsMobile from "../useIsMobile";
import "./TrackPair.css";

/**
 * A track, shown as the two halves people actually think in: the music on the
 * left, the singing on the right, and one button between them that plays the
 * two together.
 *
 * Above the vocal sits the take switch, and it is always there. Every track has
 * an original — the audio an operation was performed *on* — and most have
 * exactly that and nothing else, in which case the switch is a single pill
 * saying so. A conversion adds the voice it was sung with, a cover adds the
 * cover, a rewrite adds the rewrite. Before this, a track with one take had no
 * switch at all, so there was no way to tell "nothing was done to this" from
 * "something was done and the control is elsewhere".
 *
 * A take is self-describing — it knows which library id its waveforms come from
 * — which is what lets the original of a conversion live in a different track's
 * directory and still draw here.
 *
 * Halves are only drawn when their audio exists. An empty box next to a full
 * one reads as a broken export, and an import that has never been split has no
 * vocal to show, not a silent one.
 *
 * On a phone there is one half, always: the mix. Two waveforms side by side is
 * a comparison, and a comparison needs width — stacked down a 390px screen they
 * stop being two halves of one performance and become a card three screens
 * tall. What a phone is for is playing the thing and switching takes, and both
 * of those fit on one row.
 */

const PLAY = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M8 5.2v13.6c0 .9 1 1.4 1.7.9l10.1-6.8a1.1 1.1 0 0 0 0-1.8L9.7 4.3A1.1 1.1 0 0 0 8 5.2z" />
  </svg>
);
/* A speaker, and a speaker with the sound struck out. */
const SOUND = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 4.2v15.6a.9.9 0 0 1-1.5.7L6.3 17H3.6A1.1 1.1 0 0 1 2.5 15.9v-7.8A1.1 1.1 0 0 1 3.6 7h2.7l4.2-3.5a.9.9 0 0 1 1.5.7zm3.6 2.4a7.2 7.2 0 0 1 0 10.8l-1.4-1.6a5.1 5.1 0 0 0 0-7.6zm2.6-3a11 11 0 0 1 0 16.8l-1.4-1.6a8.9 8.9 0 0 0 0-13.6z" />
  </svg>
);
const MUTED = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 4.2v15.6a.9.9 0 0 1-1.5.7L6.3 17H3.6A1.1 1.1 0 0 1 2.5 15.9v-7.8A1.1 1.1 0 0 1 3.6 7h2.7l4.2-3.5a.9.9 0 0 1 1.5.7zm7.9 5 1.5 1.5-2.1 2.1 2.1 2.1-1.5 1.5-2.1-2.1-2.1 2.1-1.5-1.5 2.1-2.1-2.1-2.1 1.5-1.5 2.1 2.1z" />
  </svg>
);

/* On a phone there is one waveform, so a speaker on its own would not say
   which half it silences. A note and a microphone do. */
const NOTE = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M20 3v11.6a3.6 3.6 0 1 1-2-3.2V7.4l-7 1.6v8.6a3.6 3.6 0 1 1-2-3.2V6.4z" />
  </svg>
);
const MIC = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 2.4a3 3 0 0 1 3 3v6.2a3 3 0 1 1-6 0V5.4a3 3 0 0 1 3-3zm-6.4 9h2a4.4 4.4 0 0 0 8.8 0h2a6.4 6.4 0 0 1-5.4 6.3v2.9h2.4v2H8.6v-2H11v-2.9a6.4 6.4 0 0 1-5.4-6.3z" />
  </svg>
);

const PAUSE = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <rect x="6" y="4.5" width="4.2" height="15" rx="1.5" />
    <rect x="13.8" y="4.5" width="4.2" height="15" rx="1.5" />
  </svg>
);

/** One labelled waveform, scrubbable only when it is the audio that is loaded. */
/** A speaker for one half, struck through when that half is silenced. */
function Mute({ name, icon, muted, onToggle }) {
  const verb = muted ? "Unmute" : "Mute";
  return (
    <button
      type="button"
      className="rx-mute"
      aria-pressed={muted ? "true" : "false"}
      onClick={onToggle}
      title={`${verb} the ${name}`}
      aria-label={`${verb} the ${name}`}
    >
      {icon}
    </button>
  );
}

function Half({ label, songId, assetKey, tint, isCurrent, progress, badge, scrub, muted, mutes, children }) {
  return (
    <div className="rx-half" style={{ "--c": `var(${tint})` }} data-muted={muted ? "" : undefined}>
      <div className="rx-half-top">
        {mutes}
        <span className="rx-half-lab">{label}</span>
        <span className="rx-sp" />
        {children}
      </div>
      <div className="rx-bigwave" data-scrub={isCurrent ? "" : undefined} {...(isCurrent ? scrub : null)}>
        <Waveform jobId={songId} assetKey={assetKey} tint={tint} progress={progress} />
        {isCurrent && <span className="rx-playhead" style={{ left: `${progress * 100}%` }} />}
        {badge && <span className="rx-wbadge">{badge}</span>}
      </div>
    </div>
  );
}

export default function TrackPair({ song, takeKey: controlledKey, onTakeChange }) {
  const takes = Array.isArray(song.takes) && song.takes.length ? song.takes : null;
  // The result, not the input: you asked for the conversion, so that is the one
  // playing when you press the row.
  const [ownKey, setOwnKey] = useState(takes ? takes[takes.length - 1].key : "original");
  // The row above needs to know which version is showing — its menu offers to
  // delete that one — so the selection is lifted when a parent asks for it.
  const takeKey = controlledKey ?? ownKey;
  const setTakeKey = onTakeChange || setOwnKey;
  const player = usePlayer();
  const vtoggleRef = useRef(null);

  // The version row scrolls horizontally, but most mice only have a vertical
  // wheel — without this, anything past the visible pills is reachable only
  // by dragging or on a trackpad. React's own onWheel is passive by default
  // (preventDefault silently does nothing there since React 17), so this
  // attaches a real listener instead of one via the JSX prop.
  useEffect(() => {
    const el = vtoggleRef.current;
    if (!el) return undefined;
    const onWheel = (event) => {
      // A vertical wheel gesture has more deltaY than deltaX; a trackpad's
      // native horizontal swipe already arrives as deltaX and should keep
      // scrolling the element itself rather than being redirected.
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      if (el.scrollWidth <= el.clientWidth) return;
      event.preventDefault();
      el.scrollLeft += event.deltaY;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // A track whose takes change under it — a conversion finishing, a cover
  // landing — must not keep pointing at a key that no longer exists.
  useEffect(() => {
    if (takes && !takes.some((item) => item.key === takeKey)) {
      setTakeKey(takes[takes.length - 1].key);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [takes, takeKey]);

  // Both halves scrub the same mix — they are two views of one performance, so
  // pressing the instrumental at 40% is the same request as pressing the vocal
  // at 40%. Seeking only, and only on the loaded track: a waveform that starts
  // playing on contact makes every misclick a track change.
  const scrub = useScrub((ratio) => player.seek(ratio));
  const compact = useIsMobile();
  // Which halves are silenced. Not a gain control: the stems exist as files, so
  // muting the voice is simply playing the instrumental, which is exactly what
  // that file is. No second element to keep in sync, and no mix to subtract a
  // voice from that was never subtractable.
  const [muted, setMuted] = useState({ instrumental: false, vocals: false });

  if (!takes) return null;
  const take = takes.find((item) => item.key === takeKey) || takes[takes.length - 1];

  const bothStems = Boolean(take.instrumentalUrl && take.vocalsUrl);
  const silent = bothStems && muted.instrumental && muted.vocals;
  const heard = !bothStems
    ? { url: take.mixUrl, asset: take.mixAsset }
    : muted.vocals
    ? { url: take.instrumentalUrl, asset: take.instrumentalAsset }
    : muted.instrumental
    ? { url: take.vocalsUrl, asset: take.vocalsAsset }
    : { url: take.mixUrl, asset: take.mixAsset };

  const sourceId = `${take.songId}:${heard.asset}`;
  const isCurrent = player.sourceId === sourceId;
  const isPlaying = isCurrent && player.playing;
  const progress = isCurrent ? player.progress : 0;
  const isOriginal = take.kind === "original";

  const subtitleFor = (item) =>
    item.kind === "voice" ? `Sung by ${item.label}` : item.kind === "original" ? "Original" : item.label;

  const playTake = (item, keepPosition, override) =>
    player.play({
      sourceId: `${item.songId}:${(override || heard).asset}`,
      url: (override || heard).url,
      title: song.title,
      subtitle: subtitleFor(item),
      cover: song.cover,
      tint: gradientFor(song.id),
      ...(keepPosition ? { keepPosition: true } : null),
    });

  const switchTake = (key) => {
    setTakeKey(key);
    // Only follow the switch in the player if this song is what is playing —
    // otherwise flipping a switch in a list would hijack whatever you were
    // listening to.
    if (!isCurrent) return;
    const next = takes.find((item) => item.key === key);
    if (next && next.mixUrl) playTake(next, true);
  };

  // Silencing a half swaps the file under the playhead without moving it, the
  // same way switching takes does — you are still listening to the same
  // moment of the same track.
  const toggleMute = (half) => {
    const next = { ...muted, [half]: !muted[half] };
    setMuted(next);
    if (!isCurrent) return;
    const url = next.instrumental && next.vocals
      ? null
      : next.vocals
      ? take.instrumentalUrl
      : next.instrumental
      ? take.vocalsUrl
      : take.mixUrl;
    const asset = next.instrumental && next.vocals
      ? null
      : next.vocals
      ? take.instrumentalAsset
      : next.instrumental
      ? take.vocalsAsset
      : take.mixAsset;
    if (!url) {
      // Nothing left to hear. Pause rather than play silence.
      if (player.playing) player.toggle();
    } else {
      playTake(take, true, { url, asset });
    }
  };

  const toggle = (
    <span ref={vtoggleRef} className="rx-vtoggle" data-single={takes.length === 1 ? "" : undefined}>
      {takes.map((item) => (
        <button
          key={item.key}
          type="button"
          aria-pressed={item.key === take.key}
          disabled={takes.length === 1}
          onClick={() => switchTake(item.key)}
        >
          {item.label}
        </button>
      ))}
    </span>
  );

  const playButton = (
    <div className="rx-mixcol">
      <span className="rx-sp0" />
      <span className="rx-mixbox">
        <button
          type="button"
          className="rx-mixbtn"
          onClick={() => playTake(take)}
          disabled={!heard.url || silent}
          aria-label={isPlaying ? `Pause ${song.title}` : `Play ${song.title}`}
        >
          {isPlaying ? PAUSE : PLAY}
        </button>
      </span>
    </div>
  );

  // Only what exists gets a half. Nothing split out at all means one waveform
  // of the whole thing, rather than two boxes promising stems that were never
  // produced. The switch rides on the last half drawn, whichever that is.
  const halves = [];
  if (take.instrumentalUrl && !compact) {
    halves.push({
      key: "instrumental",
      label: "Instrumental",
      assetKey: take.instrumentalAsset,
      tint: "--inst",
      muted: muted.instrumental,
      mutes: bothStems ? (
        <Mute
          name="instrumental"
          icon={muted.instrumental ? MUTED : SOUND}
          muted={muted.instrumental}
          onToggle={() => toggleMute("instrumental")}
        />
      ) : null,
    });
  }
  if (take.vocalsUrl && !compact) {
    halves.push({
      key: "vocals",
      label: "Vocals",
      assetKey: take.vocalsAsset,
      tint: take.tint,
      badge: take.kind === "voice" ? "converted" : null,
      muted: muted.vocals,
      mutes: bothStems ? (
        <Mute
          name="vocal"
          icon={muted.vocals ? MUTED : SOUND}
          muted={muted.vocals}
          onToggle={() => toggleMute("vocals")}
        />
      ) : null,
    });
  }
  if (!halves.length) {
    if (!take.mixUrl) return null;
    halves.push({
      key: "mix",
      // On a phone this is the whole track, not a fallback for a track that
      // was never split, so it says which take you are hearing rather than
      // repeating "full mix" under every row.
      label: compact && !isOriginal ? take.label : "Full mix",
      assetKey: take.mixAsset,
      tint: isOriginal ? "--accent" : take.tint,
      badge: compact && take.kind === "voice" ? "converted" : null,
      // One waveform, two things to silence — so both toggles ride on it.
      mutes: bothStems ? (
        <>
          <Mute
            name="instrumental"
            icon={NOTE}
            muted={muted.instrumental}
            onToggle={() => toggleMute("instrumental")}
          />
          <Mute
            name="vocal"
            icon={MIC}
            muted={muted.vocals}
            onToggle={() => toggleMute("vocals")}
          />
        </>
      ) : null,
    });
  }

  const drawHalf = (half, index) => (
    <Half
      key={half.key}
      label={half.label}
      songId={take.songId}
      assetKey={half.assetKey}
      tint={half.tint}
      isCurrent={isCurrent}
      progress={progress}
      badge={half.badge}
      scrub={scrub}
      muted={half.muted}
      mutes={half.mutes}
    >
      {index === halves.length - 1 ? toggle : null}
    </Half>
  );

  // One half means the button leads, as it does for an unsplit mix; two means
  // it sits between them, which is what the 1fr auto 1fr grid is for.
  if (halves.length === 1) {
    return (
      <div className="rx-pair rx-pair-single">
        {playButton}
        {drawHalf(halves[0], 0)}
      </div>
    );
  }

  return (
    <div className="rx-pair">
      {drawHalf(halves[0], 0)}
      {playButton}
      {drawHalf(halves[1], 1)}
    </div>
  );
}
