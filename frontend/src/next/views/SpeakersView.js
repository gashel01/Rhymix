import React, { useEffect, useMemo, useState } from "react";

import {
  uploadTalkingFile,
  getTalkingStatus,
  listTalkingDatasets,
  listSpeakerSamples,
  speakerIds,
  isTalkingDone,
  isTalkingFailed,
} from "../api";
import { usePlayer } from "../player";
import { useToasts } from "../toasts";
import "./SpeakersView.css";

/**
 * Speaker diarisation: one recording in, one track per voice out.
 *
 * There is no endpoint that lists diarisation jobs the way training has one —
 * only a status check for the job you just started — so this tracks a single
 * in-flight run rather than a history. What does persist is the output on
 * disk, which /api/available-talking-datasets reads directly; that list is
 * the real source of truth for anything already finished, including runs
 * from a previous session.
 *
 * Nothing on the backend names the speaker folders it writes back to the
 * client — only a count — so the ids below (speaker_01, speaker_02, ...) are
 * reconstructed from the same zero-padded convention every other diarisation
 * route already assumes.
 */

const POLL_MS = 2500;

const STATUS_LABELS = {
  preprocessing: "Separating vocals from the mix…",
  diarizing: "Telling the speakers apart…",
  completed: "Done",
  completed_but_no_speakers: "Finished, but found no distinct speakers",
  completed_but_no_directory: "Finished, but produced no output",
  failed: "Failed",
  error: "Failed",
};

// Cycled by speaker index rather than given a palette of their own — the
// brief for this screen: reuse the stem colours everywhere else means something.
const SPEAKER_TINTS = ["--spk", "--inst", "--conv", "--score", "--vox", "--hot"];

const stripExtension = (name) => (name || "").replace(/\.[^/.]+$/, "");

const formatDuration = (seconds) => {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

export default function SpeakersView() {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [job, setJob] = useState(null);

  const [datasets, setDatasets] = useState(null);
  const [datasetsError, setDatasetsError] = useState(null);
  const [selectedName, setSelectedName] = useState(null);
  const [speakers, setSpeakers] = useState(null);

  const player = usePlayer();
  const toasts = useToasts();

  const loadDatasets = async (signal) => {
    try {
      const list = await listTalkingDatasets(signal);
      setDatasets(list);
      setDatasetsError(null);
      return list;
    } catch (error) {
      if (error.name !== "AbortError") setDatasetsError(error.message);
      return null;
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    loadDatasets(controller.signal);
    return () => controller.abort();
  }, []);

  // Poll the one job this screen tracks until it lands somewhere final, then
  // point the dataset list at what it just produced.
  useEffect(() => {
    if (!job || isTalkingDone(job)) return undefined;
    const controller = new AbortController();
    let stopped = false;
    let timer = null;

    const tick = async () => {
      try {
        const status = await getTalkingStatus(job.id, controller.signal);
        if (stopped) return;
        setJob((prev) => (prev && prev.id === job.id ? { ...prev, ...status } : prev));
        if (isTalkingDone(status)) {
          if (status.status === "completed") {
            const name = stripExtension(job.originalFilename);
            loadDatasets().then(() => setSelectedName(name));
            toasts.notify("Diarisation finished");
          }
        } else {
          timer = setTimeout(tick, POLL_MS);
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
  }, [job?.id]);

  const selectedDataset = useMemo(
    () => (datasets || []).find((item) => item.name === selectedName) || null,
    [datasets, selectedName]
  );

  // Refetches only when the dataset actually selected changes, or its speaker
  // count does — not on every dataset-list refresh, which would otherwise
  // re-request every speaker's samples each poll for no reason.
  useEffect(() => {
    if (!selectedDataset) {
      setSpeakers(null);
      return undefined;
    }
    const ids = speakerIds(selectedDataset.speakerCount);
    setSpeakers(ids.map((id, index) => ({ id, index, samples: null, error: null })));
    const controller = new AbortController();

    (async () => {
      const results = await Promise.all(
        ids.map(async (id, index) => {
          try {
            const samples = await listSpeakerSamples(selectedDataset.name, id, controller.signal);
            return { id, index, samples, error: null };
          } catch (error) {
            if (error.name === "AbortError") return null;
            return { id, index, samples: [], error: error.message };
          }
        })
      );
      if (!controller.signal.aborted) setSpeakers(results.filter(Boolean));
    })();

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDataset?.name, selectedDataset?.speakerCount]);

  const startUpload = async () => {
    if (!file || uploading) return;
    setUploading(true);
    try {
      const result = await uploadTalkingFile(file);
      if (!result || !result.job_id) throw new Error("The backend did not return a job id.");
      setJob({
        id: result.job_id,
        originalFilename: result.original_filename,
        status: result.status || "preprocessing",
        statusMessage: result.status_message || "",
        error: null,
      });
      setFile(null);
      toasts.notify("Diarisation started");
    } catch (error) {
      toasts.fail(error.message);
    } finally {
      setUploading(false);
    }
  };

  const playSample = (dataset, speaker, sample) => {
    const sourceId = `talk:${dataset.name}:${speaker.id}:${sample.id}`;
    player.play({
      sourceId,
      url: sample.url,
      title: `${dataset.name} — Speaker ${speaker.index + 1}`,
      subtitle: sample.name,
    });
  };

  const jobRunning = job && !isTalkingDone(job);
  const jobFailed = job && isTalkingFailed(job);

  return (
    <div className="rx-view">
      <div className="rx-head">
        <div>
          <h1>Speakers</h1>
          <p>Split a multi-speaker recording into one track per voice.</p>
        </div>
      </div>

      <div className="card">
        <h3>New recording</h3>
        <div className="f">
          <label htmlFor="rx-talk-file">Recording</label>
          <label className="btn sm" htmlFor="rx-talk-file">
            Choose an audio file
          </label>
          <input
            id="rx-talk-file"
            type="file"
            accept="audio/*"
            hidden
            onChange={(event) => setFile(event.target.files && event.target.files[0])}
          />
          {file && (
            <div className="rx-filerow">
              <span>{file.name}</span>
              <button type="button" className="btn sm ghost" onClick={() => setFile(null)}>
                Remove
              </button>
            </div>
          )}
          <span className="hint">One file, any number of speakers. Longer recordings take longer.</span>
        </div>

        <button type="button" className="btn fill" onClick={startUpload} disabled={!file || uploading || jobRunning}>
          {uploading && <span className="spinner" />}
          {uploading ? "Uploading…" : "Run diarisation"}
        </button>

        {job && (
          <div className={jobFailed ? "rx-jobline rx-jobline-error" : "rx-jobline"}>
            {jobRunning && <span className="spinner" />}
            <span>
              {STATUS_LABELS[job.status] || job.status}
              {job.statusMessage ? ` — ${job.statusMessage}` : ""}
            </span>
          </div>
        )}
        {jobFailed && job.error && <span className="hint">{job.error}</span>}
      </div>

      {datasetsError && (
        <div className="card rx-problem">
          <b>Could not load your speaker splits</b>
          <span className="hint">{datasetsError}</span>
        </div>
      )}

      {datasets !== null && !datasets.length && !datasetsError && (
        <div className="card rx-empty">
          <b>No recordings split yet</b>
          <span className="hint">
            Upload a recording above — Rhymix separates the vocals, tells the speakers apart, and
            gives you one folder per voice.
          </span>
        </div>
      )}

      {datasets && datasets.length > 0 && (
        <div className="rx-datasets">
          {datasets.map((dataset) => (
            <button
              key={dataset.id}
              type="button"
              className="rx-dataset"
              aria-pressed={dataset.name === selectedName}
              onClick={() => setSelectedName(dataset.name)}
            >
              <b>{dataset.name}</b>
              <span className="hint">
                {dataset.speakerCount} speaker{dataset.speakerCount === 1 ? "" : "s"} ·{" "}
                {dataset.sampleCount} clip{dataset.sampleCount === 1 ? "" : "s"}
              </span>
            </button>
          ))}
        </div>
      )}

      {selectedDataset && (
        <div className="rx-speakers">
          {speakers === null && <span className="hint">Loading speakers…</span>}
          {speakers &&
            speakers.map((speaker) => {
              const tint = SPEAKER_TINTS[speaker.index % SPEAKER_TINTS.length];
              return (
                <div className="card rx-speaker" style={{ "--c": `var(${tint})` }} key={speaker.id}>
                  <h3>
                    <span className="rx-dot" />
                    Speaker {speaker.index + 1}
                  </h3>

                  {speaker.error && <span className="hint">Could not load this speaker: {speaker.error}</span>}
                  {speaker.samples === null && !speaker.error && <span className="hint">Loading…</span>}
                  {speaker.samples && speaker.samples.length === 0 && !speaker.error && (
                    <span className="hint">No clips for this speaker.</span>
                  )}

                  {speaker.samples && speaker.samples.length > 0 && (
                    <div className="rx-clips">
                      {speaker.samples.map((sample) => {
                        const sourceId = `talk:${selectedDataset.name}:${speaker.id}:${sample.id}`;
                        const isCurrent = player.sourceId === sourceId;
                        return (
                          <div className="rx-clip" key={sample.id}>
                            <button
                              type="button"
                              className="btn sm"
                              onClick={() => playSample(selectedDataset, speaker, sample)}
                            >
                              {isCurrent && player.playing ? "Pause" : "Play"}
                            </button>
                            <span className="rx-clipname">{sample.name}</span>
                            <span className="hint">{formatDuration(sample.duration)}</span>
                            <a className="btn sm ghost" href={sample.url} download>
                              Download
                            </a>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}
