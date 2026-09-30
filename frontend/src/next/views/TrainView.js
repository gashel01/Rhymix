import React, { useEffect, useMemo, useRef, useState } from "react";

import {
  listSongs,
  listUploads,
  isSongDone,
  listTrainingJobs,
  getTrainingStatus,
  prepareTrainingDataset,
  startTraining,
  cancelTraining,
  isTrainingRunning,
  isTrainingFailed,
} from "../api";
import { useToasts } from "../toasts";
import Select from "../components/Select";
import "./TrainView.css";

/**
 * Training a voice.
 *
 * A run is two backend calls, not one: the dataset has to exist as files under
 * Applio's dataset root before /api/start-training will look at it, so this
 * always uploads first and only starts the job once that lands. The dataset
 * can come from files on disk, or from vocals you already generated in the
 * Library — those are fetched back down to a Blob and repackaged, because
 * /api/prepare-training-dataset only ever reads multipart file fields.
 *
 * Status polling has no page of its own to live on — a run outlives whatever
 * screen started it — so this always shows every run the backend remembers,
 * and a run picked from that list is what the progress card below follows.
 */

const POLL_JOBS_MS = 4000;
const POLL_STATUS_MS = 3000;

const RVC_VERSIONS = [
  { value: "v2", label: "RVC v2 — recommended" },
  { value: "v1", label: "RVC v1 — legacy" },
];
const SAMPLE_RATES = [32000, 40000, 48000];
const GPUS = [
  { value: 0, label: "GPU 0" },
  { value: 1, label: "GPU 1" },
  { value: 2, label: "GPU 2" },
  { value: -1, label: "CPU — not recommended" },
];
const INDEX_ALGOS = ["Auto", "Flat", "HNS"];

const SOURCES = [
  { id: "upload", label: "Upload files", hint: "Clean recordings of one voice" },
  { id: "library", label: "From your library", hint: "Reuse vocals you already generated" },
];

/** A track name reduced to something safe to put on disk — it reaches the
 * filesystem on the backend, so separators and control characters go first. */
const safeName = (name) =>
  (name || "track")
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 80);

/** The status endpoint returns the whole log every poll — this pulls out the
 * furthest epoch mentioned rather than trusting `progress` alone, since the
 * backend only starts counting epochs after preprocessing and extraction. */
const extractEpoch = (logs) => {
  for (let i = (logs || []).length - 1; i >= 0; i -= 1) {
    const m = /Epoch (\d+)\/(\d+)/.exec(logs[i]);
    if (m) return { current: Number(m[1]), total: Number(m[2]) };
  }
  return null;
};

const STATUS_LABELS = {
  preprocessing: "Preprocessing",
  training: "Training",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
  interrupted: "Interrupted",
};

export default function TrainView() {
  const [source, setSource] = useState("upload");
  const [files, setFiles] = useState([]);
  const [songs, setSongs] = useState(null);
  const [selectedSongIds, setSelectedSongIds] = useState(() => new Set());

  const [modelName, setModelName] = useState("");
  const [rvcVersion, setRvcVersion] = useState("v2");
  const [epochs, setEpochs] = useState(100);
  const [batchSize, setBatchSize] = useState(8);
  const [sampleRate, setSampleRate] = useState(48000);
  const [gpu, setGpu] = useState(0);
  const [pitchGuidance, setPitchGuidance] = useState(true);
  const [pretrained, setPretrained] = useState(true);
  const [advanced, setAdvanced] = useState(false);
  const [saveEveryEpoch, setSaveEveryEpoch] = useState(20);
  const [indexAlgorithm, setIndexAlgorithm] = useState("Auto");
  const [overtrainingDetector, setOvertrainingDetector] = useState(true);
  const [overtrainingThreshold, setOvertrainingThreshold] = useState(5);
  const [cacheDataInGpu, setCacheDataInGpu] = useState(false);
  const [cleanup, setCleanup] = useState(true);
  const [saveOnlyLatest, setSaveOnlyLatest] = useState(false);
  const [saveEveryWeights, setSaveEveryWeights] = useState(true);

  const [phase, setPhase] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [jobs, setJobs] = useState(null);
  const [jobsError, setJobsError] = useState(null);
  const [currentJobId, setCurrentJobId] = useState(null);
  const [currentJob, setCurrentJob] = useState(null);
  const [cancellingId, setCancellingId] = useState(null);

  const logBoxRef = useRef(null);
  const toasts = useToasts();

  // Anything in the library with an isolated vocal can be trained on, whether
  // Rhymix generated it or you imported it — training wants a voice, not a
  // provenance. A track that was never split has no vocal to offer, so it is
  // not listed.
  useEffect(() => {
    const controller = new AbortController();
    Promise.allSettled([listSongs(controller.signal), listUploads(controller.signal)]).then(
      ([generated, imported]) => {
        const all = [
          ...(generated.status === "fulfilled" ? generated.value : []),
          ...(imported.status === "fulfilled" ? imported.value : []),
        ];
        setSongs(all.filter((song) => isSongDone(song) && song.vocals));
      }
    );
    return () => controller.abort();
  }, []);

  const loadJobs = async (signal) => {
    try {
      const list = await listTrainingJobs(signal);
      setJobs(list);
      setJobsError(null);
      return list;
    } catch (error) {
      if (error.name !== "AbortError") setJobsError(error.message);
      return null;
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    let timer = null;
    let stopped = false;
    const tick = async () => {
      const list = await loadJobs(controller.signal);
      if (stopped) return;
      if (list && list.some(isTrainingRunning)) timer = setTimeout(tick, POLL_JOBS_MS);
    };
    tick();
    return () => {
      stopped = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Detail poll for whichever run is selected — starting one selects it, and
  // clicking "View" on any run in the list below does the same.
  useEffect(() => {
    if (!currentJobId) {
      setCurrentJob(null);
      return undefined;
    }
    const controller = new AbortController();
    let timer = null;
    let stopped = false;
    const tick = async () => {
      try {
        const job = await getTrainingStatus(currentJobId, controller.signal);
        if (stopped) return;
        setCurrentJob(job);
        if (job && isTrainingRunning(job)) timer = setTimeout(tick, POLL_STATUS_MS);
        else loadJobs();
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
  }, [currentJobId]);

  useEffect(() => {
    const box = logBoxRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [currentJob]);

  const toggleSong = (id) => {
    setSelectedSongIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const addFiles = (list) => {
    const picked = Array.from(list || []).filter((file) => file.type.startsWith("audio/") || !file.type);
    setFiles((prev) => [...prev, ...picked]);
  };
  const removeFile = (index) => setFiles((prev) => prev.filter((_, i) => i !== index));

  const problems = useMemo(() => {
    const list = [];
    if (!modelName.trim()) list.push("Give the voice a name.");
    if (source === "upload" && !files.length) list.push("Add at least one clean recording to train on.");
    if (source === "library" && !selectedSongIds.size) {
      list.push("Pick at least one vocal track from your library.");
    }
    if (epochs < 1 || epochs > 1000) list.push("Epochs has to be between 1 and 1000.");
    if (batchSize < 1 || batchSize > 32) list.push("Batch size has to be between 1 and 32.");
    return list;
  }, [modelName, source, files, selectedSongIds, epochs, batchSize]);

  const submit = async (event) => {
    event.preventDefault();
    if (problems.length || submitting) return;

    setSubmitting(true);
    setPhase(source === "library" ? "Fetching vocals…" : "Packaging dataset…");
    try {
      let datasetFiles = files;
      if (source === "library") {
        const chosen = (songs || []).filter((song) => selectedSongIds.has(song.id));
        datasetFiles = await Promise.all(
          chosen.map(async (song, index) => {
            const response = await fetch(song.vocals);
            if (!response.ok) throw new Error(`Could not fetch the vocal for "${song.title}".`);
            const blob = await response.blob();
            return new File([blob], `speaker01_${index + 1}_${safeName(song.title)}.wav`, {
              type: "audio/wav",
            });
          })
        );
      }

      const name = modelName.trim();
      await prepareTrainingDataset(name, datasetFiles, sampleRate);

      setPhase("Starting…");
      const result = await startTraining({
        modelName: name,
        rvcVersion,
        saveEveryEpoch,
        saveOnlyLatest,
        saveEveryWeights,
        totalEpoch: epochs,
        sampleRate,
        batchSize,
        gpu,
        pitchGuidance,
        overtrainingDetector,
        overtrainingThreshold,
        pretrained,
        cleanup,
        indexAlgorithm,
        cacheDataInGpu,
        customPretrained: false,
        gPretrainedPath: null,
        dPretrainedPath: null,
      });
      if (!result || !result.jobId) throw new Error("The backend did not return a job id.");

      toasts.notify(`Training “${name}” started`);
      setCurrentJobId(result.jobId);
      loadJobs();
      setFiles([]);
      setSelectedSongIds(new Set());
    } catch (error) {
      toasts.fail(error.message);
    } finally {
      setSubmitting(false);
      setPhase("");
    }
  };

  const cancel = async (jobId) => {
    if (cancellingId) return;
    setCancellingId(jobId);
    try {
      await cancelTraining(jobId);
      toasts.notify("Cancelled");
      loadJobs();
    } catch (error) {
      toasts.fail(error.message);
    } finally {
      setCancellingId(null);
    }
  };

  const epoch = currentJob ? extractEpoch(currentJob.logs) : null;
  const availableSongs = songs || [];

  return (
    <div className="rx-view">
      <div className="rx-head">
        {/* No "Train" word here — the rail beside it already says which
            page this is. */}
        <div>
          <h1>Teach Rhymix a voice from a handful of clean recordings.</h1>
        </div>
      </div>

      <div className="rx-trainlayout">
      <form className="rx-trainmain" onSubmit={submit}>
        <div className="card">
          <h3>Dataset</h3>
          <div className="rx-modes">
            {SOURCES.map((item) => (
              <button
                key={item.id}
                type="button"
                className="rx-mode"
                aria-pressed={source === item.id}
                onClick={() => {
                  setSource(item.id);
                  setFiles([]);
                  setSelectedSongIds(new Set());
                }}
              >
                <b>{item.label}</b>
                <span>{item.hint}</span>
              </button>
            ))}
          </div>

          {source === "upload" ? (
            <div className="f">
              <label htmlFor="rx-train-files">Recordings</label>
              <label className="btn sm" htmlFor="rx-train-files">
                Choose audio files
              </label>
              <input
                id="rx-train-files"
                type="file"
                accept="audio/*"
                multiple
                hidden
                onChange={(event) => {
                  addFiles(event.target.files);
                  event.target.value = "";
                }}
              />
              {files.length > 0 && (
                <div className="rx-filelist">
                  {files.map((file, index) => (
                    <div className="rx-filerow" key={`${file.name}-${index}`}>
                      <span>{file.name}</span>
                      <button type="button" className="btn sm ghost" onClick={() => removeFile(index)}>
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <span className="hint">
                A handful of minutes of one voice, as clean as you can get it — no music, no other
                speakers.
              </span>
            </div>
          ) : (
            <div className="f">
              <label>Vocals already in your library</label>
              {songs === null && <span className="hint">Loading your library…</span>}
              {songs !== null && !availableSongs.length && (
                <span className="hint">
                  Nothing to pick from yet — finish generating a track with vocals first.
                </span>
              )}
              {availableSongs.length > 0 && (
                <div className="rx-picklist">
                  {availableSongs.map((song) => (
                    <button
                      key={song.id}
                      type="button"
                      className="rx-pickrow"
                      aria-pressed={selectedSongIds.has(song.id)}
                      onClick={() => toggleSong(song.id)}
                    >
                      <b>{song.title}</b>
                      {song.voice && <span className="tag" style={{ "--c": "var(--conv)" }}>{song.voice}</span>}
                    </button>
                  ))}
                </div>
              )}
              <span className="hint">Each track's vocal take is fetched and bundled as training data.</span>
            </div>
          )}

          <div className="f">
            <label htmlFor="rx-train-name">Voice name</label>
            <input
              id="rx-train-name"
              className="in"
              value={modelName}
              onChange={(event) => setModelName(event.target.value)}
              placeholder="e.g. my_voice_v1"
            />
            <span className="hint">Becomes the model's file name — letters, numbers, underscores.</span>
          </div>
        </div>

        <div className="card">
          <h3>How it trains</h3>

          <div className="f">
            <label htmlFor="rx-train-epochs">Epochs</label>
            <input
              id="rx-train-epochs"
              type="number"
              className="in"
              min={1}
              max={1000}
              value={epochs}
              onChange={(event) => setEpochs(Number(event.target.value))}
            />
            <span className="hint">More passes over the dataset — a few hundred is typical.</span>
          </div>

          <label className="rx-switch">
            <input
              type="checkbox"
              checked={pitchGuidance}
              onChange={(event) => setPitchGuidance(event.target.checked)}
            />
            <span>
              <b>Pitch guidance</b>
              <span className="hint">Better pitch accuracy — leave this on for singing.</span>
            </span>
          </label>

          <label className="rx-switch">
            <input
              type="checkbox"
              checked={pretrained}
              onChange={(event) => setPretrained(event.target.checked)}
            />
            <span>
              <b>Start from a pretrained model</b>
              <span className="hint">Converges faster with a small dataset.</span>
            </span>
          </label>

          <details open={advanced} onToggle={(event) => setAdvanced(event.currentTarget.open)}>
            <summary>Advanced</summary>
            <div className="two" style={{ marginTop: 12 }}>
              <div className="f">
                <label htmlFor="rx-train-rvc">RVC version</label>
                <Select
                  id="rx-train-rvc"
                  value={rvcVersion}
                  onChange={setRvcVersion}
                  ariaLabel="RVC version"
                  options={RVC_VERSIONS}
                />
              </div>
              <div className="f">
                <label htmlFor="rx-train-batch">Batch size</label>
                <input
                  id="rx-train-batch"
                  type="number"
                  className="in"
                  min={1}
                  max={32}
                  value={batchSize}
                  onChange={(event) => setBatchSize(Number(event.target.value))}
                />
              </div>
            </div>

            <div className="two">
              <div className="f">
                <label htmlFor="rx-train-sr">Sample rate</label>
                <Select
                  id="rx-train-sr"
                  value={sampleRate}
                  onChange={setSampleRate}
                  ariaLabel="Sample rate"
                  options={SAMPLE_RATES.map((rate) => ({ value: rate, label: `${rate / 1000}kHz` }))}
                />
              </div>
              <div className="f">
                <label htmlFor="rx-train-gpu">Device</label>
                <Select id="rx-train-gpu" value={gpu} onChange={setGpu} ariaLabel="Device" options={GPUS} />
              </div>
            </div>

            <div className="two" style={{ marginTop: 12 }}>
              <div className="f">
                <label htmlFor="rx-train-save">Save every N epochs</label>
                <input
                  id="rx-train-save"
                  type="number"
                  className="in"
                  min={1}
                  value={saveEveryEpoch}
                  onChange={(event) => setSaveEveryEpoch(Number(event.target.value))}
                />
              </div>
              <div className="f">
                <label htmlFor="rx-train-idx">Index algorithm</label>
                <Select
                  id="rx-train-idx"
                  value={indexAlgorithm}
                  onChange={setIndexAlgorithm}
                  ariaLabel="Index algorithm"
                  options={INDEX_ALGOS.map((item) => ({ value: item, label: item }))}
                />
              </div>
            </div>

            <label className="rx-switch">
              <input
                type="checkbox"
                checked={overtrainingDetector}
                onChange={(event) => setOvertrainingDetector(event.target.checked)}
              />
              <span>
                <b>Stop early on overtraining</b>
                <span className="hint">Halts before the model memorises the dataset.</span>
              </span>
            </label>
            {overtrainingDetector && (
              <div className="f">
                <label htmlFor="rx-train-ot">Overtraining threshold</label>
                <input
                  id="rx-train-ot"
                  type="number"
                  className="in"
                  min={1}
                  value={overtrainingThreshold}
                  onChange={(event) => setOvertrainingThreshold(Number(event.target.value))}
                />
              </div>
            )}

            <label className="rx-switch">
              <input
                type="checkbox"
                checked={cacheDataInGpu}
                onChange={(event) => setCacheDataInGpu(event.target.checked)}
              />
              <span>
                <b>Cache data in GPU</b>
                <span className="hint">Faster, but needs more VRAM.</span>
              </span>
            </label>

            <label className="rx-switch">
              <input
                type="checkbox"
                checked={saveEveryWeights}
                onChange={(event) => setSaveEveryWeights(event.target.checked)}
              />
              <span>
                <b>Save a checkpoint every save interval</b>
                <span className="hint">Off keeps only the final weights.</span>
              </span>
            </label>

            <label className="rx-switch">
              <input
                type="checkbox"
                checked={saveOnlyLatest}
                onChange={(event) => setSaveOnlyLatest(event.target.checked)}
              />
              <span>
                <b>Keep only the latest checkpoint</b>
                <span className="hint">Saves disk space; you lose earlier epochs.</span>
              </span>
            </label>

            <label className="rx-switch">
              <input type="checkbox" checked={cleanup} onChange={(event) => setCleanup(event.target.checked)} />
              <span>
                <b>Clean up intermediate files</b>
                <span className="hint">Removes preprocessing scratch data once training starts.</span>
              </span>
            </label>
          </details>

          {problems.length > 0 && (
            <ul className="rx-problems">
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          )}

          <button type="submit" className="btn fill" disabled={submitting || problems.length > 0}>
            {submitting && <span className="spinner" />}
            {submitting ? phase || "Working…" : "Start training"}
          </button>
        </div>
      </form>

      <aside className="rx-trainrail">
      {currentJob && (
        <div className="card rx-progress-card">
          <div className="rx-progress-head">
            <h3>{currentJob.modelName || "Training"}</h3>
            <span className="rx-runmeta">
              <span className="tag" style={{ "--c": isTrainingFailed(currentJob) ? "var(--hot)" : "var(--conv)" }}>
                {STATUS_LABELS[currentJob.status] || currentJob.status}
              </span>
              <button
                type="button"
                className="iconbtn"
                onClick={() => setCurrentJobId(null)}
                aria-label="Close"
                title="Close"
              >
                ✕
              </button>
            </span>
          </div>

          <div className="rx-pbar">
            <i style={{ width: `${currentJob.progress}%` }} />
          </div>
          <div className="rx-runmeta">
            <span>{currentJob.progress}%</span>
            {epoch && <span>Epoch {epoch.current}/{epoch.total}</span>}
            {isTrainingRunning(currentJob) && (
              <button
                type="button"
                className="btn sm ghost"
                onClick={() => cancel(currentJob.id)}
                disabled={cancellingId === currentJob.id}
              >
                {cancellingId === currentJob.id ? "Cancelling…" : "Cancel"}
              </button>
            )}
          </div>

          {currentJob.error && <span className="hint">{currentJob.error}</span>}

          <div className="rx-logbox" ref={logBoxRef}>
            {(currentJob.logs || []).map((line, index) => (
              <div key={index}>{line}</div>
            ))}
          </div>
        </div>
      )}

      <div className="rx-runsblock">
        <span className="sect">Runs</span>
        {jobsError && (
          <div className="card rx-problem">
            <b>Could not load training runs</b>
            <span className="hint">{jobsError}</span>
          </div>
        )}
        {jobs !== null && !jobs.length && !jobsError && (
          <div className="card rx-empty">
            <b>No training runs yet</b>
            <span className="hint">Start one above and it will show up here, even after you navigate away.</span>
          </div>
        )}
        {jobs && jobs.length > 0 && (
          <div className="rx-runs">
            {jobs.map((job) => (
              <div className="rx-run" key={job.id}>
                <b>{job.modelName || job.id}</b>
                <span className="rx-runmeta">
                  <span className="tag" style={{ "--c": isTrainingFailed(job) ? "var(--hot)" : isTrainingRunning(job) ? "var(--vox)" : "var(--conv)" }}>
                    {STATUS_LABELS[job.status] || job.status}
                  </span>
                  {isTrainingRunning(job) && <span>{job.progress}%</span>}
                </span>
                <span className="rx-runmeta">
                  <button type="button" className="btn sm ghost" onClick={() => setCurrentJobId(job.id)}>
                    {job.id === currentJobId ? "Watching" : "View"}
                  </button>
                  {isTrainingRunning(job) && (
                    <button
                      type="button"
                      className="btn sm ghost"
                      onClick={() => cancel(job.id)}
                      disabled={cancellingId === job.id}
                    >
                      {cancellingId === job.id ? "Cancelling…" : "Cancel"}
                    </button>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      </aside>
      </div>
    </div>
  );
}
