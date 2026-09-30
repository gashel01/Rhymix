import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import TrackPair from "../components/TrackPair";
import Menu, { MenuItem, MenuSeparator, MenuLabel } from "../components/Menu";
import SongPanel from "../components/SongPanel";
import CreateView from "./CreateView";
import InferenceView from "./InferenceView";
import LineageTree from "../components/LineageTree";
import {
  mergeLibrary,
  trackKey,
  deleteRuns,
  deleteSongConversion,
  listSongs,
  listUploads,
  listInferenceRuns,
  listActiveInferenceJobs,
  uploadFiles,
  separateUpload,
  deleteSong,
  forgetPeaks,
  fetchPeaks,
  makeCover,
  isSongRunning,
  isSongFailed,
} from "../api";
import { gradientFor } from "../gradients";
import { usePlayer, formatTime } from "../player";
import { useToasts } from "../toasts";
import useVisible from "../useVisible";
import "./LibraryView.css";

/**
 * Everything Rhymix has generated.
 *
 * The list polls while anything is still running and stops as soon as it is
 * not: a finished library is static, and a timer that never stops is how a
 * background tab ends up making a request a second all night.
 */

const POLL_MS = 2500;

const FILTERS = [
  { id: "all", label: "All" },
  { id: "voice", label: "With my voice" },
  { id: "score", label: "With a score" },
  { id: "cover", label: "Covers" },
  { id: "upload", label: "Uploaded" },
  { id: "conversion", label: "Conversions" },
];

const SORTS = [
  { id: "newest", label: "Newest" },
  { id: "oldest", label: "Oldest" },
  { id: "name", label: "Name" },
];

const matchesFilter = (song, filter) => {
  if (filter === "upload") return song.kind === "upload";
  // A conversion now usually lives on its source's row, so the filter asks
  // what a row contains rather than what kind of thing it is.
  if (filter === "conversion")
    return (song.takes || []).some((take) => take.runId) || song.kind === "conversion";
  if (filter === "voice") return (song.takes || []).some((take) => take.kind === "voice");
  if (filter === "score") return Boolean(song.score);
  if (filter === "cover") return song.derivation === "cover" || song.derivation === "lyric_rewrite";
  return true;
};

const formatDate = (iso) => {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
};

/** The take a row's play button and duration refer to: the last one, which is
    the result of whatever was done — the conversion, the cover, the rewrite. */
const primaryTake = (song) =>
  Array.isArray(song.takes) && song.takes.length ? song.takes[song.takes.length - 1] : null;

/**
 * Save a file without asking the popup blocker's permission.
 *
 * window.open on a download URL is blocked often enough to look broken; a
 * synthetic anchor carrying `download` is not.
 */
const download = (url) => {
  if (!url) return;
  const link = document.createElement("a");
  link.href = url;
  link.download = "";
  document.body.appendChild(link);
  link.click();
  link.remove();
};

const PLAY = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M8 5.2v13.6c0 .9 1 1.4 1.7.9l10.1-6.8a1.1 1.1 0 0 0 0-1.8L9.7 4.3A1.1 1.1 0 0 0 8 5.2z" />
  </svg>
);
/** A head with sound waves — "this is a voice", read at a glance without
 * reaching for a microphone glyph that reads as "record" more than "hum". */
const HUM_MARK = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="8.4" cy="8.2" r="4.1" fill="currentColor" />
    <path
      d="M3.6 19.6c.4-3.7 2.4-5.7 4.8-5.7s4.4 2 4.8 5.7"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
    <path
      d="M15.3 8.4a3.9 3.9 0 0 1 0 5.4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    />
    <path
      d="M18 6.1a7.4 7.4 0 0 1 0 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    />
  </svg>
);
/** A branch splitting off a trunk — "this has a history". */
/* A branch point — two things made from one. Straight lines and plain
   circles only: the previous version used curved connectors that a couple of
   font/renderer combinations collapsed into a blob instead of a fork. */
const HISTORY = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <line x1="6" y1="6" x2="6" y2="18" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    <line x1="6" y1="12" x2="17" y2="12" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    <circle cx="6" cy="6" r="2.1" fill="currentColor" />
    <circle cx="6" cy="18" r="2.1" fill="currentColor" />
    <circle cx="18" cy="12" r="2.1" fill="currentColor" />
  </svg>
);
/**
 * Four bars that move while the track plays.
 *
 * A pause glyph says what the button does; this says what the track is doing,
 * which is the more useful thing to know when you are scanning a list for the
 * one you can hear. Pressing it still pauses.
 *
 * Only rendered while playing, so the animation never runs on a paused row.
 */
const Bars = () => (
  <span className="rx-bars" aria-hidden="true">
    <i />
    <i />
    <i />
    <i />
  </span>
);

/** Length, read off the cached peaks payload rather than by loading the audio.
 * `enabled` is the row's own on-screen state — see useVisible — so a library
 * of twenty tracks does not fire twenty of these the instant it renders. */
function useDuration(song, enabled) {
  const [duration, setDuration] = useState(0);
  const take = primaryTake(song);
  const songId = take?.songId;
  const asset = take?.mixAsset;
  useEffect(() => {
    let cancelled = false;
    if (!songId || !asset || !enabled) return undefined;
    fetchPeaks(songId, asset).then((result) => {
      if (!cancelled && result) setDuration(result.duration);
    });
    return () => {
      cancelled = true;
    };
  }, [songId, asset, enabled]);
  return duration;
}

/** The bar + hint a card shows while something is happening to it — shared so
 * a job still waiting for its own row (`pending` below) looks exactly like
 * one that already has one, instead of a second, slightly different spinner. */
function RunningStatusline({ progress, message }) {
  return (
    <div className="rx-statusline">
      <span className="bar">
        <i style={{ width: `${progress || 0}%` }} />
      </span>
      <span className="hint">{message}</span>
    </div>
  );
}

/** Where the hum this song was built from is now — one hop away, but a hop
 * with nothing on the other end of it once its own upload row is hidden.
 * The take switcher already carries the same audio as an "original" pill
 * once a track has one, but a running row shows a status line instead of
 * the switcher, which had no way to reach it at all until the song landed.
 * This is the one thing that works the same whether the row is still
 * generating or long finished, because the take that backs it — the source
 * a hum-built song's "original" pill also points at — exists from the
 * moment the job itself does, not from the moment it finishes. */
function HumSource({ song, onHum }) {
  const player = usePlayer();
  if (song.derivation !== "hum") return null;
  const take = song.sourceRef;
  if (!take || !take.mixUrl) return null;
  const sourceId = `${take.songId}:${take.mixAsset}`;
  const isCurrent = player.sourceId === sourceId;
  const isPlaying = isCurrent && player.playing;
  return (
    <div className="rx-humpill">
      <button
        type="button"
        className="rx-humplay"
        title="Your hum"
        aria-label={isPlaying ? "Pause your hum" : "Play your hum"}
        onClick={(event) => {
          event.stopPropagation();
          player.play({
            sourceId,
            url: take.mixUrl,
            title: song.sourceTitle || "Your hum",
            subtitle: "Your hum",
            tint: gradientFor(song.sourceSongId || song.id),
          });
        }}
      >
        <span className="pl" data-on={isCurrent ? "true" : undefined}>
          {isPlaying ? <Bars /> : PLAY}
        </span>
      </button>
      {/* The mark alone says "this is the hum", the same icon HumRecorder
          uses to record one — no label needed a second time. */}
      <span className="rx-humicon" aria-hidden="true" title="Your hum">
        {HUM_MARK}
      </span>
      {/* Reusing the hum lives on its own menu, not the track's — the two
          verbs act on different things (this recording vs. the song it
          became), and the track menu was where "make another song from
          this hum" kept getting lost among actions about the song itself. */}
      {song.sourceSongId && (
        <Menu className="iconbtn rx-humact" label="Hum options">
          {(close) => (
            <MenuItem
              onSelect={() => {
                onHum(song);
                close();
              }}
            >
              Make another song from this hum
            </MenuItem>
          )}
        </Menu>
      )}
    </div>
  );
}

function TrackRow({
  song,
  onDelete,
  onOpen,
  onRedraw,
  redrawing,
  onSeparate,
  onConvert,
  onCover,
  onHum,
  onNavigate,
  selected,
  registerRef,
  onJumpParent,
  onShowHistory,
  hasFamily,
}) {
  const isUpload = song.kind === "upload";
  // The pipeline writes a state per file; anything that is not "ready" or
  // "error" means it is still working on this one.
  const state = song.processing?.state;
  const separating = Boolean(state) && !["ready", "error"].includes(state);
  const player = usePlayer();
  const rowRef = useRef(null);
  const visible = useVisible(rowRef);
  const duration = useDuration(song, visible);
  const take = primaryTake(song);
  const sourceId = take ? `${take.songId}:${take.mixAsset}` : `${song.id}:none`;
  // The menu offers to delete the version you are looking at, so the row is
  // where the selection lives; TrackPair draws it.
  const [takeKey, setTakeKey] = useState(null);
  const takes = song.takes || [];
  const activeKey = takes.some((item) => item.key === takeKey)
    ? takeKey
    : takes.length
    ? takes[takes.length - 1].key
    : null;
  const activeTake = takes.find((item) => item.key === activeKey) || null;
  // Any voice take can be deleted on its own. A run is a run; the take a song
  // was generated with lives in the song's own directory and takes a different
  // request, but either way what survives is the original and the versions you
  // did not delete.
  const deletableTake = activeTake && activeTake.kind === "voice" ? activeTake : null;
  const versionCount = takes.filter((item) => item.kind === "voice").length;

  const voices = useMemo(
    () => [
      ...new Set(
        (song.takes || []).filter((item) => item.kind === "voice").map((item) => item.voice)
      ),
    ],
    [song.takes]
  );
  const isCurrent = player.sourceId === sourceId;
  const isPlaying = isCurrent && player.playing;
  const running = isSongRunning(song);

  const playPrimary = () =>
    player.play({
      sourceId,
      url: take?.mixUrl || song.mix,
      title: song.title,
      subtitle: song.voice ? `Sung by ${song.voice}` : "As generated",
      cover: song.cover,
      tint: gradientFor(song.id),
    });

  return (
    <article
      className="rx-track"
      ref={(el) => {
        registerRef(song.rowId || song.id, el);
        rowRef.current = el;
      }}
      data-playing={isCurrent ? "true" : undefined}
      data-selected={selected ? "true" : undefined}
      data-running={running ? "" : undefined}
      // The whole card selects. Anything that is its own control — the artwork,
      // the menu, the waveforms, the take switch — is excluded, otherwise
      // pressing play would also open the panel.
      onClick={(event) => {
        if (isUpload) return;
        if (event.target.closest("button, a, input, [data-scrub]")) return;
        onOpen(song);
      }}
    >
      <div className="rx-trow">
        <button
          type="button"
          className="rx-tile"
          data-redrawing={redrawing ? "" : undefined}
          // The gradient stays underneath: cover art is drawn on the CPU after
          // the song lands, so a fresh track wears its colours for a few
          // seconds, and a failed drawing simply never replaces them. A CSS
          // background-image has no native lazy-load the way an <img> does,
          // so it is withheld the same way peaks are — only once the row has
          // actually scrolled into view — rather than every cover in the
          // library loading in the same instant the list renders.
          style={{
            background:
              song.cover && visible
                ? `url(${song.cover}) center / cover, ${gradientFor(song.id)}`
                : gradientFor(song.id),
          }}
          onClick={playPrimary}
          disabled={!(take?.mixUrl || song.mix)}
          aria-label={isPlaying ? `Pause ${song.title}` : `Play ${song.title}`}
        >
          {redrawing && <span className="rx-tile-redraw" aria-hidden="true" />}
          <span className="pl" data-on={isCurrent ? "true" : undefined}>
            {isPlaying ? <Bars /> : PLAY}
          </span>
        </button>

        <div className="rx-tinfo">
          {isUpload ? (
            <span className="rx-tname" data-plain="">
              {song.title}
            </span>
          ) : (
            <button type="button" className="rx-tname" onClick={() => onOpen(song)}>
              {song.title}
            </button>
          )}
          <span className="rx-tmeta">
            <span>{formatDate(song.createdAt)}</span>
            {/* A text node between flex children gets no gap, which ran the date
                straight into the next word. */}
            {song.sourceTitle && song.derivation !== "original" && song.derivation !== "hum" && (
              <button type="button" className="rx-lineage-link" onClick={() => onJumpParent(song)}>
                {song.kind === "conversion" ? "from" : "cover of"} {song.sourceTitle}
              </button>
            )}
            {hasFamily(song) && (
              <button
                type="button"
                className="iconbtn rx-lineage-open"
                title="See the full history"
                aria-label="See the full history"
                onClick={() => onShowHistory(song)}
              >
                {HISTORY}
              </button>
            )}
            {/* Where the audio came from, said once and in the same place on
                every row: this machine made it, or you brought it in, or it
                came out of a voice model. Without it a generated track and an
                imported one were indistinguishable at a glance. */}
            {isUpload ? (
              <span className="tag" style={{ "--c": "var(--spk)" }}>
                Imported
              </span>
            ) : song.kind === "conversion" ? (
              <span className="tag" style={{ "--c": "var(--conv)" }}>
                Converted
              </span>
            ) : (
              <span className="tag" style={{ "--c": "var(--accent)" }}>
                Created
              </span>
            )}
            {song.score && (
              <span className="tag" style={{ "--c": "var(--score)" }}>
                Score
              </span>
            )}
            {song.instrumentalOnly && (
              <span className="tag" style={{ "--c": "var(--inst)" }}>
                Instrumental
              </span>
            )}
            {/* Every voice this track has been sung in, named once each —
                a row can now hold several, and two runs with the same model
                are two takes of one voice, not two voices. */}
            {voices.map((name) => (
              <span className="tag" key={name} style={{ "--c": "var(--conv)" }}>
                {name}
              </span>
            ))}
            {/* A voice was asked for and never arrived. Saying nothing here is
                what made this look like the feature quietly not working. */}
            {!voices.length && song.voice && !running && (
              <span
                className="tag"
                style={{ "--c": "var(--hot)" }}
                title={
                  song.voiceError ||
                  `${song.voice} was selected but the conversion did not run for this track.`
                }
              >
                {song.voice} not applied
              </span>
            )}
            {isSongFailed(song) && (
              <span className="tag" style={{ "--c": "var(--hot)" }} title={song.error || ""}>
                Failed
              </span>
            )}
          </span>
        </div>

        {running && (
          <span className="rx-progress" title={song.statusMessage}>
            <span className="spinner" />
            {song.progress}%
          </span>
        )}
        {separating && (
          <span className="rx-progress" title={song.processing?.message || "Separating"}>
            <span className="spinner" />
            {song.processing?.progress ?? 0}%
          </span>
        )}
        {!running && duration > 0 && <span className="rx-tdur">{formatTime(duration)}</span>}

        <Menu className="iconbtn rx-tmenu" label={`Actions for ${song.title}`}>
          {(close) => (
            <>
              <MenuItem onSelect={playPrimary} close={close} disabled={!song.mix}>
                {isPlaying ? "Pause" : "Play"}
              </MenuItem>
              <MenuItem
                onSelect={() => onConvert(song)}
                close={close}
                disabled={!song.vocals}
                title={song.vocals ? undefined : "Split it into stems first"}
              >
                Convert with one of my voices
              </MenuItem>
              {/* A real cover — the melody and chords transcribed out of this
                  track and re-performed with new lyrics you write — not the
                  voice-only swap above. Any track with audio can seed one, so
                  this is not confined to imports the way separating is. */}
              <MenuItem
                onSelect={() => onCover(song)}
                close={close}
                disabled={!song.mix}
                title={song.mix ? undefined : "Nothing to cover yet"}
              >
                Make a cover of it
              </MenuItem>
              {/* `trackKey` already produces the exact id shape Studio's
                  resolver expects (songgen:/upload: prefixed) — it becomes
                  the assetId segment of the studio route. */}
              <MenuItem
                onSelect={() => {
                  if (onNavigate) onNavigate(`studio/${encodeURIComponent(trackKey(song))}`);
                }}
                close={close}
                disabled={!song.mix}
                title={song.mix ? undefined : "Nothing to open yet"}
              >
                Open in Studio
              </MenuItem>
              {!isUpload && (
                <MenuItem onSelect={() => onOpen(song)} close={close}>
                  Lyrics and settings
                </MenuItem>
              )}
              {/* An upload has just as much of a cover to draw as anything
                  generated - a conversion only borrows the one belonging to
                  what it re-sang while that exists, and draws its own the
                  moment there's genuinely nothing left to inherit (that
                  source deleted, say) rather than staying blank forever. */}
              <MenuItem
                onSelect={() => onRedraw(song)}
                close={close}
                disabled={song.kind === "conversion" && Boolean(song.cover)}
                title={
                  song.kind === "conversion" && song.cover
                    ? "It shows the cover of the track it re-sang"
                    : undefined
                }
              >
                {song.cover ? "Draw a new cover" : "Draw a cover"}
              </MenuItem>
              {isUpload && (
                <MenuItem
                  onSelect={() => onSeparate(song)}
                  close={close}
                  disabled={separating || Boolean(song.vocals)}
                >
                  {song.vocals ? "Already split into stems" : "Split into vocals and music"}
                </MenuItem>
              )}
              {!isUpload && (
                <MenuItem
                  onSelect={() => onOpen(song, { edit: true })}
                  close={close}
                  disabled={!song.score}
                >
                  Rewrite the lyrics
                </MenuItem>
              )}
              {song.score && (
                <>
                  <MenuSeparator />
                  <MenuLabel>Download the score</MenuLabel>
                  <MenuItem onSelect={() => download(song.score.midi)} close={close} shortcut=".mid">
                    MIDI
                  </MenuItem>
                  <MenuItem onSelect={() => download(song.score.abc)} close={close} shortcut=".abc">
                    ABC notation
                  </MenuItem>
                </>
              )}
              <MenuSeparator />
              {/* With several versions on the row, "Delete" is ambiguous:
                  the one you are listening to, or all of it. Both, named. */}
              {deletableTake && versionCount > 1 && (
                <MenuItem danger onSelect={() => onDelete(song, deletableTake)} close={close}>
                  Delete “{deletableTake.label}”
                </MenuItem>
              )}
              <MenuItem danger onSelect={() => onDelete(song)} close={close}>
                {deletableTake && versionCount > 1
                  ? song.ownsSong === false
                    ? `Delete all ${versionCount} versions`
                    : "Delete the whole track"
                  : "Delete"}
              </MenuItem>
            </>
          )}
        </Menu>
      </div>

      <HumSource song={song} onHum={onHum} />
      {running ? (
        <RunningStatusline progress={song.progress} message={song.statusMessage || "Working…"} />
      ) : (
        <TrackPair song={song} takeKey={activeKey} onTakeChange={setTakeKey} />
      )}
    </article>
  );
}

/**
 * The workspace: what you are writing, what you have made, and what you have
 * selected — side by side.
 *
 * Create is a column here rather than a separate page because the loop is
 * write → generate → hear it, and a page change in the middle of that loses
 * both the form and your place in the list.
 */
export default function LibraryView({
  search = "",
  onNavigate,
  showCreate = false,
  playingJump,
  onPlayingJumped,
  pendingAction,
  onPendingActionHandled,
}) {
  const [songs, setSongs] = useState(null);
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("newest");
  const [openSong, setOpenSong] = useState(null);
  // Kept separate from `openSong` so the panel can play its exit before it
  // unmounts. Closing sets this, the timeout clears the selection.
  const [closing, setClosing] = useState(false);
  const [editOnOpen, setEditOnOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  // A separation the list has to keep watching, since it has no job of its own.
  const [pollUntil, setPollUntil] = useState(0);
  // The left column hosts one thing at a time: writing, or converting.
  const [converting, setConverting] = useState(null);
  // What Create opens pre-loaded with — a cover's source or a hum to reuse.
  // Named for what it does, not for the first thing it was built for.
  const [startPreset, setStartPreset] = useState(null);
  const startSeq = useRef(0);
  // The voice Convert opens pre-loaded with, same idea as startPreset but for
  // the other column — set alongside `converting`, read by InferenceView.
  const [convertVoice, setConvertVoice] = useState(null);
  // Which family's history sheet is open, by the row that opened it — null
  // when closed. A key, not a row, so it survives the next refresh's rows
  // being new objects.
  const [historyKey, setHistoryKey] = useState(null);
  const rowRefs = useRef(new Map());
  const [pending, setPending] = useState(null);
  const [error, setError] = useState(null);
  // Song ids currently redrawing a cover — the tile animates for exactly
  // these, and nothing else needs to know.
  const [redrawingIds, setRedrawingIds] = useState(() => new Set());
  const toasts = useToasts();

  // Generated and imported tracks are one library. They come from two
  // endpoints, so an import failing to list must not cost you the songs.
  // One column, one job. Opening Create closes a conversion in progress the
  // same way starting a conversion leaves Create — they are alternatives, and
  // without this the inference panel simply outranked Create forever.
  useEffect(() => {
    if (showCreate) setConverting(null);
  }, [showCreate]);

  // Voices hands off a choice already made ("write with this voice", "convert
  // this track with it") rather than acting on it itself — this is where that
  // lands. A convert action needs the real song object, not just its id, so
  // it waits for the library's own list rather than fetching a second copy.
  useEffect(() => {
    if (!pendingAction) return;
    if (pendingAction.type === "createVoice") {
      startSeq.current += 1;
      setStartPreset({ mode: "song", sourceId: "", voice: pendingAction.voice, seq: startSeq.current });
      onPendingActionHandled?.();
    } else if (pendingAction.type === "convert") {
      if (!songs) return;
      const target = songs.find((song) => song.id === pendingAction.songId);
      if (target) {
        setConverting(target);
        setConvertVoice(pendingAction.voice);
      }
      onPendingActionHandled?.();
    }
  }, [pendingAction, songs, onPendingActionHandled]);

  const load = useCallback(async (signal) => {
    const [generated, imported, converted] = await Promise.allSettled([
      listSongs(signal),
      listUploads(signal),
      listInferenceRuns(signal),
    ]);
    if (generated.status === "rejected") {
      if (generated.reason?.name !== "AbortError") setError(generated.reason.message);
      return null;
    }
    const merged = mergeLibrary(
      generated.value,
      imported.status === "fulfilled" ? imported.value : [],
      converted.status === "fulfilled" ? converted.value : []
    );
    setSongs(merged);
    setError(null);
    return merged;
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let timer = null;
    let stopped = false;

    const tick = async () => {
      // Issued before either awaits below settle, so a pending set locally
      // (starting a conversion) after this line but before the response comes
      // back is never mistaken for one this tick's stale "nothing running"
      // snapshot should clear — see the setPending updater.
      const requestedAt = Date.now();
      const [result, activeConversions] = await Promise.all([
        load(controller.signal),
        listActiveInferenceJobs(controller.signal).catch(() => []),
      ]);
      if (stopped) return;

      // A conversion has no row of its own until it lands, so the placeholder
      // is the only trace of it — rebuilt here from the server's own job list
      // rather than only ever set locally, which is what let it vanish on a
      // refresh: reloading the page throws away every bit of component state
      // a running job had, but the job itself kept running on the server the
      // whole time.
      const activeConversion = activeConversions[0] || null;
      setPending((current) => {
        if (activeConversion) {
          if (current && current.jobId === activeConversion.id) return current;
          return {
            song: {
              id: activeConversion.trackId,
              title: activeConversion.trackTitle || "a track",
            },
            voice: activeConversion.modelName || "a voice",
            at: Date.now(),
            jobId: activeConversion.id,
          };
        }
        if (current && current.jobId && current.at <= requestedAt) return null;
        return current;
      });

      // Keep polling only while something can still change: a generation in
      // flight, a conversion in flight, or a separation this session started.
      // Separation has no job of its own to watch, hence the deadline.
      const busy =
        (result && result.some(isSongRunning)) ||
        (result &&
          result.some((song) => {
            const state = song.processing?.state;
            return state && !["ready", "error"].includes(state);
          })) ||
        activeConversions.length > 0 ||
        Date.now() < pollUntil;
      if (busy) timer = setTimeout(tick, POLL_MS);
    };
    tick();

    // Polling stops when nothing is running, which leaves the list stale if a
    // job was started somewhere else — another tab or the Electron shell.
    // Coming back to the window is the moment you expect to see it.
    const refresh = () => {
      if (document.visibilityState === "visible") load(controller.signal);
    };
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);

    return () => {
      stopped = true;
      controller.abort();
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, pollUntil]);

  const remove = async (song, take) => {
    try {
      // One version: it goes, the row stays and loses a pill. A run and a
      // generation's own take are removed by different means — the first is a
      // run directory, the second is two files inside the song.
      if (take) {
        if (take.runId) {
          await deleteRuns([take.runId]);
          forgetPeaks(`run:${take.runId}`);
        } else {
          await deleteSongConversion(song.id);
          forgetPeaks(song.id);
        }
        toasts.notify(`“${take.label}” deleted`);
        await load();
        return;
      }
      await deleteSong(song);
      forgetPeaks(song.id);
      setSongs((list) =>
        (list || []).filter((item) =>
          // Deleting one voice removes that row only; deleting the track
          // removes every row it appears on.
          song.ownsSong === false ? item.rowId !== song.rowId : item.id !== song.id
        )
      );
      toasts.notify(`“${song.title}” deleted`);
    } catch (deleteError) {
      toasts.fail(deleteError.message);
    }
  };

  // Importing lands you in the same library as everything you generate, and
  // the "Uploaded" filter is how you find it again.
  // Separation is what turns an import into something the rest of the app can
  // work with: a vocal to convert with one of your voices, or to train on.
  // Converting takes the writing column: they are alternatives, not a stack,
  // and two forms competing for one column is how you lose track of which one
  // the button at the bottom belongs to.
  const startConvert = (song) => {
    setConverting(song);
    if (showCreate && onNavigate) onNavigate("library");
  };

  const coverSourceId = trackKey;

  // Where a row's parent lives, if it has one — songs and uploads carry it as
  // `sourceSongId`, an orphaned conversion as `sourceId`. One accessor because
  // nothing downstream should need to know which kind of row it is looking at.
  const parentKeyOf = (song) => song.sourceSongId || song.sourceId || null;

  // Every key that is SOMEONE's parent — computed once per render of the full
  // list, not per row, since a row's "does this have a history?" question is
  // otherwise an O(n) scan repeated for every row on screen.
  const parentKeys = useMemo(() => {
    const set = new Set();
    (songs || []).forEach((row) => {
      const key = parentKeyOf(row);
      if (key) set.add(key);
    });
    return set;
  }, [songs]);

  // How many rows the same underlying track was split into. A cover chain is
  // one shape of family; two voices tried on one song with no cover in sight
  // is another — same track id, two rows, no `sourceSongId` anywhere in
  // either direction. `hasFamily` missed that shape entirely: a song sung by
  // "anne" and, separately, by "dualipaimported" showed no history at all,
  // when the whole reason those are two rows is that there is history.
  const siblingCounts = useMemo(() => {
    const counts = new Map();
    (songs || []).forEach((row) => counts.set(row.id, (counts.get(row.id) || 0) + 1));
    return counts;
  }, [songs]);

  // Every key a currently-present row answers to — what a parent reference
  // has to match to be worth a click. A run's `sourceId` survives its source
  // being deleted; the string is still there, pointing at an upload or a song
  // that is simply gone. That used to be enough to earn the icon: a click
  // opened a tree with exactly one node, the row you were already looking at,
  // and nothing the breadcrumb text had not already said.
  const existingKeys = useMemo(() => {
    const set = new Set();
    (songs || []).forEach((row) => set.add(coverSourceId(row)));
    return set;
  }, [songs, coverSourceId]);

  const hasFamily = (song) =>
    existingKeys.has(parentKeyOf(song)) ||
    parentKeys.has(coverSourceId(song)) ||
    (siblingCounts.get(song.id) || 0) > 1;

  // Finds the row by id, brings it on screen if a filter is hiding it, then
  // scrolls to it and gives it a brief highlight — the "jump to it" the
  // breadcrumb and the history sheet both resolve to.
  const jumpToRow = (rowId) => {
    if (!rowId) return;
    const target = (songs || []).find((row) => (row.rowId || row.id) === rowId);
    if (!target) return;
    if (filter !== "all" && !matchesFilter(target, filter)) setFilter("all");
    // Selects it, not just scrolls to it — landing beside a row you still have
    // to click yourself is only half a jump. Imports are the one exception:
    // nothing else in this list opens a panel for one either, since there is
    // no score or lyrics behind it to show.
    if (target.kind !== "upload") openPanel(target);
    requestAnimationFrame(() => {
      setTimeout(() => {
        const el = rowRefs.current.get(rowId);
        if (!el) return;
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("rx-flash");
        setTimeout(() => el.classList.remove("rx-flash"), 1100);
      }, 60);
    });
  };

  const jumpToParent = (song) => {
    const parentKey = parentKeyOf(song);
    if (!parentKey) return;
    const target = (songs || []).find((row) => coverSourceId(row) === parentKey);
    if (target) jumpToRow(target.rowId || target.id);
  };

  // The player bar's "find it" button hands over what is loaded, not a row —
  // it has no idea which row produced that sourceId, only this list does. A
  // take can belong to a row without being its primary one (you switched to
  // "cover" mid-listen), so every take is checked, not just each row's own.
  useEffect(() => {
    if (!playingJump || !songs) return;
    const target = songs.find((row) =>
      (row.takes || []).some((take) => `${take.songId}:${take.mixAsset}` === playingJump)
    );
    if (target) jumpToRow(target.rowId || target.id);
    if (onPlayingJumped) onPlayingJumped();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playingJump, songs]);

  // Opens Create pre-loaded with this track as the thing to cover. `seq`
  // changes on every click, even a second click on the same track, which is
  // what tells CreateView's effect to re-apply the preset instead of no-op-ing
  // on an unchanged dependency.
  const startCover = (song) => {
    startSeq.current += 1;
    setStartPreset({ sourceId: coverSourceId(song), title: song.title, seq: startSeq.current });
    setConverting(null);
    if (onNavigate) onNavigate("create");
  };

  // The hum a song was built from is worth arranging again — a second
  // attempt at the same melody, or the same idea sung by a different voice.
  // `sourceSongId` is already the upload id `hum_source_id` expects, the same
  // shape Create's own hum-file picker produces.
  const startHum = (song) => {
    if (!song.sourceSongId) return;
    startSeq.current += 1;
    setStartPreset({
      sourceId: song.sourceSongId,
      title: song.sourceTitle,
      mode: "hum",
      seq: startSeq.current,
    });
    setConverting(null);
    if (onNavigate) onNavigate("create");
  };

  // A conversion in flight has nowhere to appear until it finishes, so the list
  // carries a placeholder row for it — otherwise pressing Convert looks like
  // nothing happened for however long the model takes.
  const onConversionStarted = (song, voiceName, jobId) => {
    setPending({ song, voice: voiceName, at: Date.now(), jobId });
    setPollUntil(Date.now() + 20 * 60 * 1000);
  };

  // A generation, a cover and a rewrite all land the same way: the job exists
  // on the server the moment this fires, so an immediate load() is what makes
  // it show up as a running row this tick rather than whenever polling next
  // happened to be awake — bumping pollUntil is what keeps it awake instead of
  // stopping again after that one look, since nothing else here is watching
  // this specific job the way the create form itself already is.
  const onSongStarted = () => {
    setPollUntil(Date.now() + 20 * 60 * 1000);
    load();
  };

  const separate = async (song) => {
    try {
      await separateUpload(song.fileId);
      toasts.notify("Splitting into vocals and music…");
      // The pipeline writes its state per file, and the list is what reads it.
      setPollUntil(Date.now() + 10 * 60 * 1000);
    } catch (separateError) {
      toasts.fail(separateError.message);
    }
  };

  const importFiles = async (event) => {
    const picked = event.target.files;
    if (!picked || !picked.length || importing) return;
    setImporting(true);
    try {
      const added = await uploadFiles(picked);
      await load();
      setFilter("upload");
      toasts.notify(added.length === 1 ? "Track imported" : `${added.length} tracks imported`);
    } catch (importError) {
      toasts.fail(importError.message);
    } finally {
      setImporting(false);
      event.target.value = "";
    }
  };

  const openPanel = (song, options) => {
    setClosing(false);
    setEditOnOpen(Boolean(options && options.edit));
    setOpenSong(song);
  };

  const closePanel = () => {
    setClosing(true);
    // Matches rx-panel-out; shorter and the panel is cut off mid-animation.
    setTimeout(() => {
      setOpenSong(null);
      setClosing(false);
    }, 220);
  };

  // Drawing a cover is fire-and-forget on the backend - the POST returns the
  // moment the job is queued, not when the picture actually lands on disk.
  // The tile animates from the click until a poll confirms a new file is
  // there, compared by Last-Modified rather than just a 200: the old picture
  // sits at that same URL for the entire time it's being replaced, so a bare
  // "does this respond" check would pass on the very first try. Once it
  // lands, the song's cover becomes a cache-busted URL so the new art shows
  // immediately, in this row alone, with no library-wide reload.
  const redraw = async (song) => {
    const id = song.id;
    // Matches makeCover's own routing.
    const fallbackUrl = id.startsWith("upload:")
      ? `/api/uploads/${id.slice(7)}/cover`
      : id.startsWith("run:")
      ? `/api/inference/${id.slice(4)}/cover`
      : `/api/song-generation/${id}/cover`;
    const coverUrl = song.cover ? song.cover.split("?")[0] : fallbackUrl;
    setRedrawingIds((prev) => new Set(prev).add(id));

    // GET, not HEAD: the dev proxy (and some setups in general) don't handle
    // HEAD reliably, and these images are small enough that fetching the body
    // every poll is not worth trading away for a method that isn't dependable.
    let previousModified = null;
    try {
      const head = await fetch(coverUrl, { cache: "no-store" });
      if (head.ok) previousModified = head.headers.get("last-modified") || head.headers.get("etag");
    } catch {
      // No existing cover to compare against - the first 200 below is the new one.
    }

    try {
      // A random seed, because asking again plainly means "not that one".
      await makeCover(id, Math.floor(Math.random() * 2 ** 31));
      toasts.notify("Drawing a cover…");

      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        try {
          const check = await fetch(coverUrl, { cache: "no-store" });
          if (check.ok) {
            const modified = check.headers.get("last-modified") || check.headers.get("etag");
            if (!previousModified || modified !== previousModified) break;
          }
        } catch {
          // A transient failure mid-poll isn't the end of the wait — try again.
        }
      }

      setSongs((list) =>
        (list || []).map((item) => (item.id === id ? { ...item, cover: `${coverUrl}?v=${Date.now()}` } : item))
      );
    } catch (error) {
      toasts.fail(error.message);
    } finally {
      setRedrawingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const list = (songs || []).filter((song) => {
      if (!matchesFilter(song, filter)) return false;
      if (!needle) return true;
      return (
        song.title.toLowerCase().includes(needle) ||
        String(song.voice || "").toLowerCase().includes(needle)
      );
    });
    // listSongs already returns newest first, so only the other two sort.
    if (sort === "oldest") return [...list].reverse();
    if (sort === "name") return [...list].sort((a, b) => a.title.localeCompare(b.title));
    return list;
  }, [songs, filter, search, sort]);

  const runningCount = (songs || []).filter(isSongRunning).length;
  const sortLabel = (SORTS.find((item) => item.id === sort) || SORTS[0]).label;

  return (
    <div
      className="rx-view"
      data-split={openSong ? "" : undefined}
      data-create={showCreate || converting ? "" : undefined}
    >
      {/* The header names what you are doing, not which component is mounted —
          and "New track" is not an offer worth making while the form that makes
          one is open beside it. */}
      <div className="rx-head">
        {/* No "Library"/"Create" word here — the rail beside it already says
            which one you're in. This is the one thing that word wasn't:
            what's actually in it right now. */}
        <div>
          <h1>
            {showCreate
              ? "Write it here — it lands in the list beside you."
              : error
              ? "Unavailable"
              : songs === null
              ? "Loading…"
              : `${songs.length} track${songs.length === 1 ? "" : "s"}${
                  runningCount ? ` · ${runningCount} still generating` : ""
                }`}
          </h1>
        </div>
        {!showCreate && (
          <button
            type="button"
            className="btn fill"
            onClick={() => onNavigate && onNavigate("create")}
          >
            New track
          </button>
        )}
      </div>

      <div className="rx-toolbar">
        <div className="pills">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              className="pill"
              aria-pressed={filter === item.id}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <span style={{ flex: 1 }} />
        <label className="btn ghost sm rx-import" htmlFor="rx-library-import">
          {importing && <span className="spinner" />}
          {importing ? "Importing…" : "Import…"}
        </label>
        <input
          id="rx-library-import"
          type="file"
          accept="audio/*"
          multiple
          hidden
          disabled={importing}
          onChange={importFiles}
        />
        <Menu className="btn ghost sm" trigger={<>{sortLabel} <span className="ch">▾</span></>} label="Sort">
          {(close) =>
            SORTS.map((item) => (
              <MenuItem
                key={item.id}
                checked={sort === item.id}
                onSelect={() => setSort(item.id)}
                close={close}
              >
                {item.label}
              </MenuItem>
            ))
          }
        </Menu>
      </div>

      <div className={showCreate || converting || openSong ? "rx-split" : undefined}>
        {(showCreate || converting) && (
          <aside className="rx-createcol">
            {converting ? (
              <InferenceView
                song={converting}
                initialVoice={convertVoice}
                onClose={() => {
                  setConverting(null);
                  setConvertVoice(null);
                }}
                onStarted={onConversionStarted}
                onChanged={() => {
                  setPending(null);
                  load();
                }}
              />
            ) : (
              <CreateView onNavigate={onNavigate} preset={startPreset} onStarted={onSongStarted} />
            )}
          </aside>
        )}

        {/* The empty and error cards belong to the list, not to the page: as
            siblings of the column row they spilled behind the writing column. */}
        <div className="rx-listcol">
      {error && (
        <div className="card rx-problem">
          <b>Could not load your library</b>
          <span className="hint">{error}</span>
          <button type="button" className="btn sm" onClick={() => load()}>
            Try again
          </button>
        </div>
      )}

      {songs !== null && !visible.length && !error && (
        <div className="card rx-empty">
          <b>{songs.length ? "Nothing matches that" : "No tracks yet"}</b>
          <span className="hint">
            {songs.length
              ? "Try a different filter, or clear the search."
              : "Write a few lines, pick a vibe, and Rhymix will sing them. You can also pick one of your own voices and it will sing them twice."}
          </span>
          {!songs.length && (
            <button type="button" className="btn fill" onClick={() => onNavigate && onNavigate("create")}>
              Write your first track
            </button>
          )}
        </div>
      )}

          <div className="rx-tracks">
            {pending && (
              <article className="rx-track" data-pending="" data-running="">
                <div className="rx-trow">
                  <span className="rx-tile" style={{ background: gradientFor(pending.song.id) }} />
                  <div className="rx-tinfo">
                    <span className="rx-tname" data-plain="">
                      {pending.song.title} — {pending.voice}
                    </span>
                    <span className="rx-tmeta">
                      <span className="tag" style={{ "--c": "var(--conv)" }}>
                        Converting
                      </span>
                    </span>
                  </div>
                  <span className="rx-progress">
                    <span className="spinner" />
                  </span>
                </div>
                <RunningStatusline
                  message={`Re-singing with ${pending.voice}. It lands here when it is done.`}
                />
              </article>
            )}
            {visible.map((song) => (
              <TrackRow
                key={song.rowId || song.id}
                song={song}
                onDelete={remove}
                onOpen={openPanel}
                onRedraw={redraw}
                redrawing={redrawingIds.has(song.id)}
                onSeparate={separate}
                onConvert={startConvert}
                onCover={startCover}
                onHum={startHum}
                onNavigate={onNavigate}
                selected={(openSong?.rowId || openSong?.id) === (song.rowId || song.id)}
                registerRef={(rowId, el) => {
                  if (el) rowRefs.current.set(rowId, el);
                  else rowRefs.current.delete(rowId);
                }}
                onJumpParent={jumpToParent}
                onShowHistory={(row) => setHistoryKey(coverSourceId(row))}
                hasFamily={hasFamily}
              />
            ))}
          </div>
        </div>

        {openSong && (
          <SongPanel
            song={
              visible.find((item) => (item.rowId || item.id) === (openSong.rowId || openSong.id)) ||
              openSong
            }
            closing={closing}
            startEditing={editOnOpen}
            onClose={closePanel}
            // A rewrite is a new job; the list is what shows it arriving. A
            // redraw is handled by the same `redraw` the row menu uses, which
            // updates this song's cover directly — no reload needed for it.
            onChanged={() => load()}
            onRedraw={redraw}
            redrawing={redrawingIds.has(openSong.id)}
          />
        )}
      </div>

      {historyKey && (
        <LineageTree
          rows={songs || []}
          rootKey={historyKey}
          onJump={jumpToRow}
          onClose={() => setHistoryKey(null)}
        />
      )}
    </div>
  );
}
