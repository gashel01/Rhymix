import React, { useEffect, useMemo, useState } from "react";

import { getSong, rewriteLyrics, MODE_LABELS } from "../api";
import { gradientFor } from "../gradients";
import { parseLyrics } from "../lyrics";
import { useToasts } from "../toasts";
import useIsMobile from "../useIsMobile";
import "./SongPanel.css";

/**
 * The selected track, in a panel beside the list.
 *
 * A panel rather than the modal this replaced: reading the words while the song
 * plays and clicking through to the next one are the same session, and a dialog
 * makes each of those an interruption. The list stays live behind it.
 *
 * Lyrics are laid out by section because that is how they were written — a wall
 * of lines loses the shape of the song, and the shape is half of what you are
 * checking when you read them back.
 */

const MODE_NOTE = {
  0: "the fullest arrangement",
  1: "sparser, more room for the voice",
  2: "fastest, but exports no score",
};

/** Only a generated song has a job on the server to ask about. */
const isGenerated = (song) => song && song.kind !== "upload" && song.kind !== "conversion";

/** How a conversion was sung, in the words the form used. */
const PARAM_LABELS = {
  pitch: "Pitch",
  indexRate: "Voice character",
  protectVoiced: "Protect consonants",
  f0Method: "Pitch tracking",
  formantShifting: "Shift formants",
  formantQfrency: "Throat",
  formantTimbre: "Timbre",
};

const formatDate = (iso) => {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
};

export default function SongPanel({
  song,
  onClose,
  onChanged,
  onRedraw,
  redrawing = false,
  closing = false,
  startEditing = false,
}) {
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [title, setTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const toasts = useToasts();
  const compact = useIsMobile();

  useEffect(() => {
    setDetail(null);
    setError(null);
    setEditing(false);
    setShowSettings(false);
    // Only a generated song has a job behind it. Asking the song endpoint about
    // a conversion or an import returned "Job not found" and left the panel
    // showing an error for a track that is perfectly fine.
    if (!isGenerated(song)) {
      setDetail(song);
      return undefined;
    }
    const controller = new AbortController();
    getSong(song.id, controller.signal)
      .then((full) => {
        setDetail(full);
        setDraft(full.recipe?.lyrics ?? "");
        // "Rewrite the lyrics" opens straight into the editor, but only once
        // the words are there to edit — and only if there is a score to keep.
        if (startEditing && (full.score || song.score)) setEditing(true);
      })
      .catch((loadError) => {
        if (loadError.name !== "AbortError") setError(loadError.message);
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [song.id, startEditing]);

  const recipe = isGenerated(song) ? detail?.recipe || null : null;
  const sections = useMemo(() => parseLyrics(recipe?.lyrics), [recipe]);
  const hasScore = Boolean(detail?.score || song.score);
  const changed = recipe ? draft.trim() !== (recipe.lyrics || "").trim() : false;

  const blocker = !hasScore
    ? "No saved score, so there is no music to keep."
    : !draft.trim()
    ? "Write some lyrics first."
    : !changed
    ? "Change the words to get a different take."
    : null;

  const submit = async () => {
    if (blocker || submitting) return;
    setSubmitting(true);
    try {
      const result = await rewriteLyrics(song.id, draft, title.trim() || undefined);
      (result?.notices || []).forEach((notice) => toasts.notify(notice));
      toasts.notify("Rewriting over the same music");
      setEditing(false);
      if (onChanged) onChanged();
    } catch (rewriteError) {
      toasts.fail(rewriteError.message);
    } finally {
      setSubmitting(false);
    }
  };

  // Title, date and tags. On a phone they sit beside the cover so the scroll
  // underneath is only what you opened this for — the words — instead of
  // starting with three lines you can already see.
  const identity = (
    <div className="rx-panel-idn">
      <div className="rx-panel-title">
        <h2>{song.title}</h2>
        <span className="hint">
          {formatDate(song.createdAt)}
          {song.voice && ` · sung by ${song.voice}`}
        </span>
      </div>

      <div className="rx-panel-tags">
          {song.score && (
            <span className="tag" style={{ "--c": "var(--score)" }}>
              Score
            </span>
          )}
          {song.converted && (
            <span className="tag" style={{ "--c": "var(--conv)" }}>
              {song.voice}
            </span>
          )}
          {song.derivation !== "original" && song.derivation !== "conversion" && (
            <span className="tag" style={{ "--c": "var(--inst)" }}>
              {song.derivation === "lyric_rewrite" ? "Rewrite" : "Cover"}
            </span>
          )}
          {song.kind === "conversion" && (
            <span className="tag" style={{ "--c": "var(--conv)" }}>
              Converted
            </span>
          )}
          {song.kind === "upload" && (
            <span className="tag" style={{ "--c": "var(--spk)" }}>
              Imported
            </span>
          )}
      </div>
    </div>
  );

  // The style prompt, wherever it lands: on a phone it sits in the fixed head
  // beside the identity, below the cover-and-title row, because it is still
  // "what this track is" rather than something you scroll to. On the desktop
  // it stays where it always has, at the top of the scroll.
  const styleCard = recipe?.style && (
    <div className="rx-panel-card">
      <span className="rx-panel-label">Styles</span>
      <p>{recipe.style}</p>
    </div>
  );

  return (
    <aside
      className="rx-panel"
      data-closing={closing ? "" : undefined}
      aria-label={`Details for ${song.title}`}
    >
      {/* --art feeds the glow behind the cover: the artwork's own colours when
          there is one, the track's gradient before it has been drawn. */}
      <div className="rx-panel-head" style={{ "--art": gradientFor(song.id) }}>
        <div className="rx-panel-toprow">
        <button
          type="button"
          className="rx-panel-art"
          data-redrawing={redrawing ? "" : undefined}
          onClick={() => onRedraw?.(song)}
          // A conversion borrows the cover of the track it re-sang while
          // that exists; once there's genuinely nothing to inherit (that
          // source deleted, say) it can draw its own instead of staying
          // blank forever.
          disabled={(song.kind === "conversion" && Boolean(song.cover)) || redrawing}
          title={
            song.kind === "conversion" && song.cover
              ? "It shows the cover of the track it re-sang"
              : "Draw a new cover"
          }
          style={{
            background: song.cover
              ? `url(${song.cover}) center / cover, ${gradientFor(song.id)}`
              : gradientFor(song.id),
          }}
        >
          {redrawing && <span className="rx-panel-art-redraw" aria-hidden="true" />}
          <span className="rx-panel-art-hint">{redrawing ? "Drawing…" : "Redraw"}</span>
        </button>
        {compact && identity}
        <button type="button" className="iconbtn rx-panel-close" onClick={onClose} aria-label="Close">
          ✕
        </button>
        </div>
        {compact && styleCard}
      </div>

      <div className="rx-panel-body">
        {!compact && identity}
        {/* What was asked of the model. A conversion you liked is worth being
            able to repeat, and that means seeing the numbers it ran with. */}
        {song.kind === "conversion" && song.params && (
          <div className="rx-panel-card">
            <span className="rx-panel-label">How it was sung</span>
            <dl className="rx-panel-params">
              {Object.entries(PARAM_LABELS).map(([key, label]) =>
                song.params[key] === undefined || song.params[key] === null ? null : (
                  <React.Fragment key={key}>
                    <dt>{label}</dt>
                    <dd>
                      {typeof song.params[key] === "boolean"
                        ? song.params[key]
                          ? "on"
                          : "off"
                        : String(song.params[key])}
                    </dd>
                  </React.Fragment>
                )
              )}
            </dl>
          </div>
        )}

        {!compact && styleCard}

        {error && <div className="hint rx-panel-error">{error}</div>}
        {isGenerated(song) && !detail && !error && <div className="hint">Loading the words…</div>}

        {recipe && !editing && (
          <div className="rx-lyrics">
            <div className="rx-panel-label rx-lyrics-head">
              Lyrics
              {hasScore && (
                <button type="button" className="btn sm ghost" onClick={() => setEditing(true)}>
                  Rewrite
                </button>
              )}
            </div>
            {sections.length ? (
              sections.map((section, index) => (
                // Sections repeat by design — two choruses are two entries, and
                // the index is what tells them apart.
                <section className="rx-lyric-section" key={`${section.name}-${index}`}>
                  {section.name && <h3>{section.name}</h3>}
                  {section.lines.map((line, lineIndex) => (
                    <p key={`${line}-${lineIndex}`}>{line}</p>
                  ))}
                </section>
              ))
            ) : (
              <span className="hint">No lyrics were saved for this track.</span>
            )}
          </div>
        )}

        {recipe && editing && (
          <div className="rx-lyrics">
            <div className="f">
              <label htmlFor="rx-panel-lyrics">Lyrics</label>
              <textarea
                id="rx-panel-lyrics"
                className="in rx-panel-edit"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
              />
            </div>
            {changed && (
              <div className="f">
                <label htmlFor="rx-panel-newtitle">Title for the new take</label>
                <input
                  id="rx-panel-newtitle"
                  className="in"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder={`${song.title} (rewrite)`}
                />
              </div>
            )}
            <span className="hint">{blocker || "The melody, chords and arrangement stay."}</span>
            <div className="rx-panel-actions">
              <button
                type="button"
                className="btn sm ghost"
                onClick={() => {
                  setEditing(false);
                  setDraft(recipe.lyrics || "");
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn sm fill"
                onClick={submit}
                disabled={Boolean(blocker) || submitting}
              >
                {submitting && <span className="spinner" />}
                {submitting ? "Starting…" : "Rewrite"}
              </button>
            </div>
          </div>
        )}

        {recipe && (
          <div className="rx-panel-card">
            <button
              type="button"
              className="rx-panel-more"
              onClick={() => setShowSettings((value) => !value)}
              aria-expanded={showSettings}
            >
              {showSettings ? "Show less" : "Show more"}
            </button>
            {showSettings && (
              <div className="kv">
                <div className="r">
                  <span>Composition</span>
                  <b>
                    {MODE_LABELS[recipe.model_mode] || "—"}
                    {MODE_NOTE[recipe.model_mode] ? ` — ${MODE_NOTE[recipe.model_mode]}` : ""}
                  </b>
                </div>
                <div className="r">
                  <span>Length asked for</span>
                  <b>{recipe.duration_seconds ? `${recipe.duration_seconds}s` : "—"}</b>
                </div>
                <div className="r">
                  <span>Seed</span>
                  <b>{recipe.seed === -1 || recipe.seed == null ? "random" : recipe.seed}</b>
                </div>
                <div className="r">
                  <span>Temperature</span>
                  <b>{recipe.temperature ?? "—"}</b>
                </div>
                <div className="r">
                  <span>Top-k / Top-p</span>
                  <b>
                    {recipe.top_k ?? "—"} / {recipe.top_p ?? "—"}
                  </b>
                </div>
                {song.score && (
                  <div className="r">
                    <span>Score</span>
                    <b>
                      <a href={song.score.midi} download>
                        MIDI
                      </a>
                      {" · "}
                      <a href={song.score.abc} download>
                        ABC
                      </a>
                    </b>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
