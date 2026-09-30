import React, { useEffect, useMemo, useState } from "react";

import {
  startSong,
  getSong,
  listVoices,
  listUploads,
  listSongs,
  uploadFiles,
  isSongRunning,
  isSongFailed,
  isSongDone,
} from "../api";
import Section from "../components/Section";
import Select from "../components/Select";
import HumRecorder from "../components/HumRecorder";
import { useToasts } from "../toasts";
import "./CreateView.css";

const POLL_MS = 2500;

/**
 * Writing a track.
 *
 * Three modes, because the engine takes three different kinds of starting
 * point and pretending otherwise produces forms that validate wrong:
 *
 *   song   — words and a vibe, nothing else
 *   cover  — an existing track, whose melody and chords are transcribed and
 *            kept while the words change
 *   hum    — a recorded hum, which the engine continues into an arrangement
 *
 * The field set changes with the mode rather than greying out: a disabled
 * control still reads as something you failed to earn.
 *
 * Every parameter name here matches backend/app/yue2_params.py exactly. That
 * module is the contract — it clamps, validates and explains — so the form's
 * job is to not lie about what it will accept, not to re-implement it.
 */

const MODES = [
  { id: "song", label: "Words", hint: "Lyrics and a vibe" },
  { id: "cover", label: "A track", hint: "Keep the music, change the words" },
  { id: "hum", label: "A hum", hint: "Sing the idea, Rhymix arranges it" },
];

// Starting points, not a taxonomy. Pressing one appends it to whatever is
// already in the field, because a vibe is usually two or three of these.
const STYLE_CHIPS = [
  "lo-fi hip hop",
  "dream pop",
  "trap",
  "acoustic folk",
  "synthwave",
  "soul ballad",
  "drum and bass",
  "ambient",
];

const COMPOSITION = [
  { value: 0, label: "Melody and chords — the fullest arrangement" },
  { value: 1, label: "Melody only — sparser, more room for the voice" },
  { value: 2, label: "Direct — fastest, but exports no score" },
];

const DURATION_MIN = 1;
const DURATION_MAX = 600;

export default function CreateView({ onNavigate, preset, onStarted }) {
  const [mode, setMode] = useState("song");
  const [title, setTitle] = useState("");
  const [lyrics, setLyrics] = useState("");
  const [style, setStyle] = useState("");
  const [duration, setDuration] = useState(120);
  const [composition, setComposition] = useState(0);
  const [saveScore, setSaveScore] = useState(true);
  // Words mode only — a cover or a hum already comes with its own melody to
  // arrange, so "no lyrics" there would mean something else entirely.
  const [instrumentalOnly, setInstrumentalOnly] = useState(false);
  const [voice, setVoice] = useState("");
  const [sourceId, setSourceId] = useState("");
  // Recording is the pitch for a hum, not the only way in — this is the
  // escape hatch for a hum already sitting in a file somewhere.
  const [showHumPicker, setShowHumPicker] = useState(false);
  const [seed, setSeed] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [voices, setVoices] = useState([]);
  const [uploads, setUploads] = useState([]);
  const [songs, setSongs] = useState([]);
  const [startedId, setStartedId] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [started, setStarted] = useState(null);
  const toasts = useToasts();

  useEffect(() => {
    const controller = new AbortController();
    listVoices(controller.signal).then(setVoices).catch(() => {});
    listUploads(controller.signal).then(setUploads).catch(() => {});
    // Finished tracks only — offering one still generating would send the
    // engine chasing audio that does not exist yet.
    listSongs(controller.signal)
      .then((list) => setSongs(list.filter(isSongDone)))
      .catch(() => {});
    return () => controller.abort();
  }, []);

  // A track picked from the library — "Make a cover of it", "Make another
  // song from this hum" — arrives here rather than through the pickers below.
  // `preset.seq` changes on every click, even a repeat one on the same
  // source, which is what makes the effect fire again instead of no-op-ing
  // on an unchanged dependency.
  useEffect(() => {
    if (!preset) return;
    const presetMode = preset.mode || "cover";
    setMode(presetMode);
    setSourceId(preset.sourceId || "");
    if (preset.voice) setVoice(preset.voice);
    if (preset.title) {
      setTitle(presetMode === "cover" ? `${preset.title} (cover)` : preset.title);
    }
    // The hum section defaults to the recorder — right for a fresh idea, but
    // this arrived with a file already chosen, so show the picker that
    // actually reflects that instead of a blank invitation to record again.
    if (presetMode === "hum") setShowHumPicker(true);

    // Lyrics only carry over for a cover of one of your own songs — a hum
    // has none of its own to bring along, and its source id would not
    // resolve as a song job anyway. Starting from the ones already written
    // beats retyping a song you already know the words to — changing a few
    // lines over the same melody is usually the whole reason to ask for a
    // cover rather than a fresh song.
    if (presetMode !== "cover") return undefined;
    const jobId = preset.sourceId.startsWith("songgen:") ? preset.sourceId.slice(8) : null;
    if (!jobId) return undefined;
    let cancelled = false;
    getSong(jobId)
      .then((song) => {
        if (!cancelled && song?.recipe?.lyrics) setLyrics(song.recipe.lyrics);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset?.seq]);

  // Follow the run that was just started, here, rather than sending the user
  // somewhere else to watch it.
  useEffect(() => {
    if (!startedId) return undefined;
    const controller = new AbortController();
    let stopped = false;
    let timer = null;
    const tick = async () => {
      try {
        const song = await getSong(startedId, controller.signal);
        if (stopped) return;
        setStarted(song);
        if (isSongRunning(song)) timer = setTimeout(tick, POLL_MS);
        else if (isSongFailed(song)) toasts.fail(song.error || "Generation failed.");
      } catch (error) {
        if (error.name !== "AbortError" && !stopped) toasts.fail(error.message);
      }
    };
    tick();
    return () => {
      stopped = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startedId]);

  // Direct generation cannot export a score — the model never writes one down.
  // Rather than let the two contradict each other and have the backend reject
  // the job, the switch follows the mode and says why.
  const scoreImpossible = composition === 2;
  const wantsScore = saveScore && !scoreImpossible;

  const needsSource = mode === "cover" || mode === "hum";
  const instrumental = instrumentalOnly && mode === "song";

  // Uploading here rather than sending the user elsewhere to do it: needing a
  // file is the only reason the cover and hum modes exist, and discovering the
  // list is empty is exactly when you want to fill it.
  const addFiles = async (event) => {
    const picked = event.target.files;
    if (!picked || !picked.length || uploading) return;
    setUploading(true);
    try {
      const added = await uploadFiles(picked);
      const fresh = await listUploads();
      setUploads(fresh);
      // Select what was just added, since that is plainly what it was for.
      const first = added[0];
      const id = first && (first.fileId || first.id);
      if (id) setSourceId(`upload:${id}`);
      toasts.notify(added.length === 1 ? "File added" : `${added.length} files added`);
    } catch (uploadError) {
      toasts.fail(uploadError.message);
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  };

  const chosenVoice = useMemo(
    () => voices.find((item) => item.name === voice) || null,
    [voices, voice]
  );

  const problems = useMemo(() => {
    const list = [];
    if (!title.trim()) list.push("Give it a title.");
    if (!instrumental && !lyrics.trim()) list.push("Lyrics are required — even a single line.");
    if (needsSource && !sourceId) list.push(`Pick ${mode === "cover" ? "a track to cover" : "a hum recording"}.`);
    if (duration < DURATION_MIN || duration > DURATION_MAX) {
      list.push(`Length has to be between ${DURATION_MIN} and ${DURATION_MAX} seconds.`);
    }
    // A voice with no usable checkpoint would be accepted by the backend and
    // then quietly skip the conversion, which reads as "my voice was ignored".
    if (voice && chosenVoice && !chosenVoice.forInference.selectedCheckpoint) {
      list.push(`“${voice}” has no saved checkpoint to sing with — train it first.`);
    }
    return list;
  }, [title, lyrics, needsSource, sourceId, mode, duration, voice, chosenVoice, instrumental]);

  const submit = async () => {
    if (problems.length || submitting) return;

    setSubmitting(true);
    try {
      const payload = {
        title: title.trim(),
        // [instrumental] is the tag YuE2 was trained on for a wordless track —
        // not a placeholder, the actual signal that replaces lyrics entirely.
        lyrics: instrumental ? "[instrumental]" : lyrics,
        style,
        duration_seconds: Number(duration),
        // Chain-of-thought (plan the score, then the audio) is what the tag
        // above needs to land — Direct generation skips straight to audio and
        // never gets to read it.
        model_mode: instrumental ? 0 : Number(composition),
        save_score: wantsScore,
        hum: mode === "hum",
        ...(instrumental ? { instrumental_only: true } : {}),
      };
      if (seed.trim()) payload.seed = Number(seed);
      if (chosenVoice) {
        payload.model_name = chosenVoice.name;
        payload.model = chosenVoice.forInference;
      }
      if (mode === "cover") payload.cover_source_id = sourceId;
      if (mode === "hum") payload.hum_source_id = sourceId;

      const result = await startSong(payload);
      (result?.notices || []).forEach((notice) => toasts.notify(notice));
      // Stay here. You are most likely about to write another one, and being
      // thrown into the library mid-thought loses the form you just filled in.
      const jobId = result?.job_id || result?.id || null;
      setStartedId(jobId);
      // The list beside this column has no way to know a job exists until it
      // asks the server — and it stops asking once nothing is running, so a
      // job started here could sit invisible until something else happened to
      // wake polling back up. This is that wake-up call.
      if (onStarted) onStarted(jobId);
    } catch (error) {
      toasts.fail(error.message);
    } finally {
      setSubmitting(false);
    }
  };

  const addChip = (chip) =>
    setStyle((current) => (current.trim() ? `${current.replace(/[,\s]+$/, "")}, ${chip}` : chip));

  const sourceTitle = mode === "cover" ? "Track to cover" : "Your hum";

  // Songs and uploads already carry the right prefix on their id (`upload:x`,
  // bare for a song); resolve_cover_source on the backend expects exactly
  // that shape, so it is built once here rather than at three call sites.
  const songOptionId = (song) => `songgen:${song.id}`;

  // The picker only lists finished songs and imports — a hum, or a track
  // reached through the library menu, can point at a conversion run instead,
  // which the two fetched lists never include. Rather than teach the picker a
  // fourth source kind for one entry, the option is synthesised so the select
  // still shows something meaningful instead of a blank value matching nothing.
  const knownOptionIds = useMemo(
    () => new Set([...songs.map(songOptionId), ...uploads.map((upload) => upload.id)]),
    [songs, uploads]
  );
  const unlistedOption =
    sourceId && !knownOptionIds.has(sourceId)
      ? { id: sourceId, name: preset?.title || "Selected track" }
      : null;

  return (
    <div className="rx-createpanel">
      {/* Fixed head and foot, scrolling middle. Create is the one control you
          always want in reach, and a long lyrics box used to push it off the
          bottom of the column. */}
      <div className="rx-ctop">
        <div className="rx-seg" role="tablist" aria-label="What to start from">
          {MODES.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={mode === item.id}
              title={item.hint}
              onClick={() => {
                setMode(item.id);
                setSourceId("");
                setShowHumPicker(false);
                if (item.id !== "song") setInstrumentalOnly(false);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="rx-cbody">
        {started && (
          <div className="rx-started" data-state={started.status}>
            <div className="rx-started-row">
              <b>{started.title}</b>
              {isSongRunning(started) ? (
                <span className="rx-progress">
                  <span className="spinner" />
                  {started.progress}%
                </span>
              ) : isSongFailed(started) ? (
                <span className="tag" style={{ "--c": "var(--hot)" }}>
                  Failed
                </span>
              ) : (
                <span className="tag" style={{ "--c": "var(--conv)" }}>
                  Ready
                </span>
              )}
              <span style={{ flex: 1 }} />
              <button
                type="button"
                className="iconbtn"
                aria-label="Dismiss"
                onClick={() => {
                  setStartedId(null);
                  setStarted(null);
                }}
              >
                &#10005;
              </button>
            </div>
            {isSongRunning(started) && (
              <span className="bar">
                <i style={{ width: `${started.progress}%` }} />
              </span>
            )}
            <span className="hint">
              {isSongFailed(started)
                ? started.error || "Generation failed."
                : started.statusMessage ||
                  (isSongRunning(started) ? "Working…" : "Done — it is in your library.")}
            </span>
          </div>
        )}

        <Section title="Title">
          <input
            className="in"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Something you will recognise in the library"
            aria-label="Title"
          />
        </Section>

        {mode === "hum" && (
          <Section title={sourceTitle}>
            <HumRecorder
              onReady={(id, name) => {
                setSourceId(id);
                setShowHumPicker(false);
                if (!title.trim()) setTitle(name);
              }}
              onUploaded={() => listUploads().then(setUploads).catch(() => {})}
              onDiscard={() => setSourceId("")}
            />
            <button
              type="button"
              className="rx-humalt"
              onClick={() => setShowHumPicker((value) => !value)}
            >
              {showHumPicker ? "Record instead" : "Or choose a file you already have"}
            </button>
            {showHumPicker && (
              <>
                <Select
                  value={sourceId}
                  onChange={setSourceId}
                  placeholder="Choose…"
                  ariaLabel={sourceTitle}
                  groups={[
                    ...(unlistedOption
                      ? [{ label: null, options: [{ value: unlistedOption.id, label: unlistedOption.name }] }]
                      : []),
                    ...(uploads.length > 0
                      ? [
                          {
                            label: "Imports",
                            options: uploads.map((upload) => ({
                              value: upload.id,
                              label: upload.title,
                              avatar: { kind: "cover", seed: upload.id, url: upload.cover },
                            })),
                          },
                        ]
                      : []),
                  ]}
                />
                <label className="btn sm" htmlFor="rx-upload" title="Add a file">
                  {uploading ? <span className="spinner" /> : "＋ Add a file"}
                </label>
                <input
                  id="rx-upload"
                  type="file"
                  accept="audio/*"
                  multiple
                  hidden
                  disabled={uploading}
                  onChange={addFiles}
                />
              </>
            )}
            <span className="hint">Continues your hum into a full arrangement. A few bars is enough.</span>
          </Section>
        )}

        {mode === "cover" && (
          <Section
            title={sourceTitle}
            actions={
              <>
                <label className="rx-sact" htmlFor="rx-upload" title="Add a file">
                  {uploading ? <span className="spinner" /> : "＋"}
                </label>
                <input
                  id="rx-upload"
                  type="file"
                  accept="audio/*"
                  multiple
                  hidden
                  disabled={uploading}
                  onChange={addFiles}
                />
              </>
            }
          >
            <Select
              value={sourceId}
              onChange={setSourceId}
              placeholder="Choose…"
              ariaLabel={sourceTitle}
              groups={[
                ...(unlistedOption
                  ? [{ label: null, options: [{ value: unlistedOption.id, label: unlistedOption.name }] }]
                  : []),
                ...(songs.length > 0
                  ? [
                      {
                        label: "Your tracks",
                        options: songs.map((song) => ({
                          value: songOptionId(song),
                          label: song.title,
                          avatar: { kind: "cover", seed: song.id, url: song.cover },
                        })),
                      },
                    ]
                  : []),
                ...(uploads.length > 0
                  ? [
                      {
                        label: "Imports",
                        options: uploads.map((upload) => ({
                          value: upload.id,
                          label: upload.title,
                          avatar: { kind: "cover", seed: upload.id, url: upload.cover },
                        })),
                      },
                    ]
                  : []),
              ]}
            />
            <span className="hint">
              The whole arrangement is transcribed, not just the vocal — melody and chords both survive.
            </span>
          </Section>
        )}

        <Section
          title="Lyrics"
          actions={
            mode === "song" ? (
              <label className="rx-instrumental-toggle" title="No words — Rhymix plans and plays the arrangement on its own">
                <input
                  type="checkbox"
                  checked={instrumentalOnly}
                  onChange={(event) => setInstrumentalOnly(event.target.checked)}
                />
                Instrumental only
              </label>
            ) : null
          }
        >
          {instrumental ? (
            <span className="hint">
              No words — Rhymix plans and plays the arrangement on its own. Whatever the model still
              hums under its breath is separated out and dropped, so what you keep never has a voice
              in it.
            </span>
          ) : (
            <>
              <textarea
                className="in rx-lyricbox"
                value={lyrics}
                onChange={(event) => setLyrics(event.target.value)}
                placeholder={"[Verse]\nSay something worth singing\n\n[Chorus]\n…"}
                aria-label="Lyrics"
              />
              <span className="hint">
                Section tags like [Verse] and [Chorus] shape the arrangement. Lines starting with #
                are dropped by the engine.
              </span>
            </>
          )}
        </Section>

        <Section title="Styles">
          <input
            className="in"
            value={style}
            onChange={(event) => setStyle(event.target.value)}
            placeholder="melancholic indie pop, female vocals, clean electric guitar"
            aria-label="Styles"
          />
          <div className="rx-chips">
            {STYLE_CHIPS.map((chip) => (
              <button key={chip} type="button" className="rx-chip" onClick={() => addChip(chip)}>
                {chip}
              </button>
            ))}
          </div>
        </Section>

        {!instrumental && (
          <Section title="Voice">
            <Select
              value={voice}
              onChange={setVoice}
              ariaLabel="Voice"
              options={[
                { value: "", label: "Keep the generated voice" },
                ...voices.map((item) => ({
                  value: item.name,
                  label: item.name,
                  meta: item.epochs ? `${item.epochs} epochs` : null,
                  avatar: { kind: "voice", seed: item.name },
                })),
              ]}
            />
            <span className="hint">
              {voice
                ? "You get both takes: the voice it was written in, and yours singing the same performance."
                : voices.length
                ? "Pick one of your trained voices and it will sing the result as well."
                : "Train a voice first and it can sing your tracks."}
            </span>
          </Section>
        )}

        <Section title="More options" defaultOpen={false} muted>
          <div className="f">
            <label htmlFor="rx-comp">Composition</label>
            <Select
              id="rx-comp"
              value={instrumental ? 0 : composition}
              onChange={setComposition}
              ariaLabel="Composition"
              options={COMPOSITION}
              disabled={instrumental}
            />
            {instrumental && (
              <span className="hint">
                Instrumental only needs the full plan-then-play arrangement to hold together.
              </span>
            )}
          </div>

          <div className="f">
            <label htmlFor="rx-dur">Length &mdash; {duration}s</label>
            <input
              id="rx-dur"
              type="range"
              min={15}
              max={300}
              step={5}
              value={duration}
              onChange={(event) => setDuration(Number(event.target.value))}
            />
          </div>

          <label className="rx-switch">
            <input
              type="checkbox"
              checked={wantsScore}
              disabled={scoreImpossible}
              onChange={(event) => setSaveScore(event.target.checked)}
            />
            <span>
              <b>Keep the score</b>
              <span className="hint">
                {scoreImpossible
                  ? "Direct generation writes no score — it goes straight to audio."
                  : "Exports the notes as MIDI and ABC, so you can rewrite the lyrics later and keep the music."}
              </span>
            </span>
          </label>

          <div className="f">
            <label htmlFor="rx-seed">Seed</label>
            <input
              id="rx-seed"
              className="in"
              value={seed}
              onChange={(event) => setSeed(event.target.value)}
              placeholder="random"
              inputMode="numeric"
            />
            <span className="hint">Fix it to get the same music back from the same words.</span>
          </div>
        </Section>
      </div>

      <div className="rx-cfoot">
        {problems.length > 0 && (
          <ul className="rx-problems" aria-live="polite">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        )}
        <div className="rx-cfoot-row">
          <span className="hint rx-cost">
            &asymp; {Math.max(1, Math.round((duration * 1.35) / 60))} min for {duration}s
          </span>
          <button
            type="button"
            className="btn fill rx-cgo"
            onClick={submit}
            disabled={submitting || problems.length > 0}
          >
            {submitting && <span className="spinner" />}
            {submitting ? "Starting…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
