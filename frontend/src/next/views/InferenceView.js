import React, { useEffect, useMemo, useState } from "react";

import Section from "../components/Section";
import Select from "../components/Select";
import {
  listVoices,
  startInference,
  inferenceStatus,
  isInferenceRunning,
  INFERENCE_DEFAULTS,
  F0_METHODS,
} from "../api";
import { useToasts } from "../toasts";
import "./CreateView.css";

// Same presets and values as Studio's Live VC panel — raw quefrency/timbre
// numbers meant nothing to pick by feel; "which direction am I converting"
// is the actual question, and there are only two useful answers to it.
const FORMANT_PRESETS = {
  none: { formantShifting: false, formantQfrency: 1.0, formantTimbre: 1.0, label: "Off" },
  f2m: { formantShifting: true, formantQfrency: 1.0, formantTimbre: 0.8, label: "Female → Male" },
  m2f: { formantShifting: true, formantQfrency: 1.0, formantTimbre: 1.2, label: "Male → Female" },
};

/**
 * Re-singing a track you already have with one of your voices.
 *
 * It takes the same column as Create and the same shape — fixed head, scrolling
 * body, the action pinned at the foot — because it is the same kind of work:
 * set something up, start it, watch it land in the list beside you.
 *
 * What it needs is a vocal, not a song. A track that was never split into stems
 * has nothing to convert, which is why the panel says so rather than offering a
 * button that would fail.
 */

const POLL_MS = 2000;

export default function InferenceView({ song, initialVoice, onClose, onChanged, onStarted }) {
  const [voices, setVoices] = useState([]);
  const [voice, setVoice] = useState(initialVoice || "");
  const [params, setParams] = useState(INFERENCE_DEFAULTS);
  const [submitting, setSubmitting] = useState(false);
  const [jobId, setJobId] = useState(null);
  const [job, setJob] = useState(null);
  const toasts = useToasts();

  useEffect(() => {
    const controller = new AbortController();
    listVoices(controller.signal).then(setVoices).catch(() => {});
    return () => controller.abort();
  }, []);

  // A new target is a new run; nothing from the last one should carry over.
  useEffect(() => {
    setJobId(null);
    setJob(null);
  }, [song?.id]);

  useEffect(() => {
    if (!jobId) return undefined;
    const controller = new AbortController();
    let stopped = false;
    let timer = null;
    const tick = async () => {
      try {
        const next = await inferenceStatus(jobId, controller.signal);
        if (stopped) return;
        setJob(next);
        if (isInferenceRunning(next)) {
          timer = setTimeout(tick, POLL_MS);
        } else if (next.status === "completed") {
          toasts.notify("Conversion finished");
          if (onChanged) onChanged();
        } else {
          // Failure is terminal too — without calling onChanged here, the
          // library's placeholder row for this job (added the moment it
          // started) never learns it is over and sits showing "Converting"
          // forever, since a failed run never lands as a real row on its own.
          toasts.fail(next.error || "Conversion failed");
          if (onChanged) onChanged();
        }
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
  }, [jobId]);

  const chosen = useMemo(() => voices.find((item) => item.name === voice) || null, [voices, voice]);

  const blocker = !song
    ? "Pick a track from the library."
    : !song.vocals
    ? "This track has no isolated vocal yet — split it into stems first."
    : !voice
    ? "Choose a voice."
    : chosen && !chosen.forInference.selectedCheckpoint
    ? `“${voice}” has no saved checkpoint to sing with — train it first.`
    : null;

  const submit = async () => {
    if (blocker || submitting || !chosen) return;
    setSubmitting(true);
    try {
      const result = await startInference(
        chosen.forInference,
        // A generated song and an import are resolved by different means: one
        // keeps its vocal in its own job directory, the other in the shared
        // vocals folder under an upload id. Sending the wrong key is what made
        // this fail with "Unknown fileId".
        song.kind === "upload"
          ? {
              fileId: song.fileId,
              name: song.title,
              vocalFileType: "raw_vocals",
              processed: false,
            }
          : { songJobId: song.id, name: song.title },
        params
      );
      setJobId(result.jobId);
      if (onStarted) onStarted(song, voice, result.jobId);
      toasts.notify(`Converting with ${voice}…`);
    } catch (error) {
      toasts.fail(error.message);
    } finally {
      setSubmitting(false);
    }
  };

  const setParam = (key, value) => setParams((current) => ({ ...current, [key]: value }));
  const running = isInferenceRunning(job) && Boolean(jobId);

  const formantPreset = params.formantShifting
    ? params.formantTimbre >= 1
      ? "m2f"
      : "f2m"
    : "none";
  const applyFormantPreset = (key) => {
    const preset = FORMANT_PRESETS[key];
    setParams((current) => ({
      ...current,
      formantShifting: preset.formantShifting,
      formantQfrency: preset.formantQfrency,
      formantTimbre: preset.formantTimbre,
    }));
  };

  return (
    <div className="rx-createpanel">
      <div className="rx-ctop rx-ctop-row">
        <b className="rx-ctitle">Convert a voice</b>
        <button type="button" className="iconbtn" onClick={onClose} aria-label="Close">
          &#10005;
        </button>
      </div>

      <div className="rx-cbody">
        <Section title="Track">
          {song ? (
            <>
              <div className="rx-target">
                <b>{song.title}</b>
                <span className="hint">
                  {song.vocals ? "Vocal ready to convert" : "No isolated vocal yet"}
                </span>
              </div>
              {!song.vocals && (
                <span className="hint">
                  Use “Split into vocals and music” on the track first — a conversion needs the
                  voice on its own, not the mix.
                </span>
              )}
            </>
          ) : (
            <span className="hint">Choose a track in the library to convert.</span>
          )}
        </Section>

        <Section title="Voice">
          <Select
            value={voice}
            onChange={setVoice}
            placeholder="Choose a voice…"
            ariaLabel="Voice"
            options={voices.map((item) => ({
              value: item.name,
              label: item.name,
              meta: item.epochs ? `${item.epochs} epochs` : null,
              avatar: { kind: "voice", seed: item.name },
            }))}
          />
        </Section>

        <Section title="How it sings" defaultOpen={false} muted>
          <div className="f">
            <label htmlFor="rx-inf-pitch">Pitch — {params.pitch > 0 ? `+${params.pitch}` : params.pitch} semitones</label>
            <input
              id="rx-inf-pitch"
              type="range"
              min={-12}
              max={12}
              step={1}
              value={params.pitch}
              onChange={(event) => setParam("pitch", Number(event.target.value))}
            />
            <span className="hint">
              Shift it when the voice sits in a different range from the original singer. ±12 is an
              octave.
            </span>
          </div>

          <div className="f">
            <label htmlFor="rx-inf-index">Voice character — {params.indexRate.toFixed(2)}</label>
            <input
              id="rx-inf-index"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={params.indexRate}
              onChange={(event) => setParam("indexRate", Number(event.target.value))}
            />
            <span className="hint">
              How hard it pulls toward the trained voice. High keeps the timbre, low keeps the
              original delivery.
            </span>
          </div>

          <div className="f">
            <label htmlFor="rx-inf-protect">Protect consonants — {params.protectVoiced.toFixed(2)}</label>
            <input
              id="rx-inf-protect"
              type="range"
              min={0}
              max={0.5}
              step={0.05}
              value={params.protectVoiced}
              onChange={(event) => setParam("protectVoiced", Number(event.target.value))}
            />
            <span className="hint">
              Leaves breath and consonants alone. Raise it if the words start slurring.
            </span>
          </div>

          <div className="f">
            <label htmlFor="rx-inf-formant">Shift formants</label>
            <Select
              id="rx-inf-formant"
              value={formantPreset}
              onChange={applyFormantPreset}
              ariaLabel="Shift formants"
              options={Object.entries(FORMANT_PRESETS).map(([value, preset]) => ({
                value,
                label: preset.label,
              }))}
            />
            <span className="hint">
              Pick the direction when the voice you're converting to sits in a different register
              from the original singer — a man sung by a woman&rsquo;s model, or the reverse. Pitch
              alone moves the notes; this moves the body of the voice with them.
            </span>
          </div>

          <div className="f">
            <label htmlFor="rx-inf-f0">Pitch tracking</label>
            <Select
              id="rx-inf-f0"
              value={params.f0Method}
              onChange={(value) => setParam("f0Method", value)}
              ariaLabel="Pitch tracking"
              options={F0_METHODS.map((method) => ({ value: method, label: method }))}
            />
          </div>
        </Section>

        {job && (
          <div className="rx-started" data-state={job.status}>
            <div className="rx-started-row">
              <b>{song?.title}</b>
              {running ? (
                <span className="rx-progress">
                  <span className="spinner" />
                  {job.progress ?? 0}%
                </span>
              ) : (
                <span
                  className="tag"
                  style={{ "--c": job.status === "completed" ? "var(--conv)" : "var(--hot)" }}
                >
                  {job.status === "completed" ? "Done" : "Failed"}
                </span>
              )}
            </div>
            {running && (
              <span className="bar">
                <i style={{ width: `${job.progress ?? 0}%` }} />
              </span>
            )}
            <span className="hint">{job.error || job.message || job.status}</span>
          </div>
        )}
      </div>

      <div className="rx-cfoot">
        {blocker && <ul className="rx-problems"><li>{blocker}</li></ul>}
        <div className="rx-cfoot-row">
          <span className="hint rx-cost">{voice ? `Sung by ${voice}` : "No voice chosen"}</span>
          <button
            type="button"
            className="btn fill rx-cgo"
            onClick={submit}
            disabled={Boolean(blocker) || submitting || running}
          >
            {(submitting || running) && <span className="spinner" />}
            {running ? "Converting…" : submitting ? "Starting…" : "Convert"}
          </button>
        </div>
      </div>
    </div>
  );
}
