import React, { useEffect, useState } from "react";
import { LABELS, type DrumLabel, type ReviewResponse, type TakeResponse, type TrainResponse, type WizardState } from "./types";
import { useSessionApi } from "./useSessionApi";
import { useMicrophoneRecorder } from "./useMicrophoneRecorder";
import "./wizard.css";

function labelTitle(label: DrumLabel): string {
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function getMaxDeficitLabel(counts: Record<DrumLabel, number>, target: number): DrumLabel | null {
  let best: DrumLabel | null = null;
  let deficit = 0;
  for (const label of LABELS) {
    const d = Math.max(0, target - (counts[label] || 0));
    if (d > deficit) {
      deficit = d;
      best = label;
    }
  }
  return deficit > 0 ? best : null;
}

export default function BeatboxCalibrationWizard() {
  const api = useSessionApi();
  const recorder = useMicrophoneRecorder();

  const [wizardState, setWizardState] = useState<WizardState>("idle");
  const [proMode, setProMode] = useState(false);
  const [metronome, setMetronome] = useState(false);
  const [targetHits, setTargetHits] = useState(25);
  const [takeSec, setTakeSec] = useState(8);
  const [windowSec, setWindowSec] = useState(0.25);
  const [countdown, setCountdown] = useState(0);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [labels, setLabels] = useState<DrumLabel[]>(LABELS);
  const [labelIndex, setLabelIndex] = useState(0);
  const [currentLabel, setCurrentLabel] = useState<DrumLabel>("kick");
  const [counts, setCounts] = useState<Record<DrumLabel, number>>({
    kick: 0,
    snare: 0,
    hat: 0,
    clap: 0,
  });

  const [lastTake, setLastTake] = useState<TakeResponse | null>(null);
  const [trainReport, setTrainReport] = useState<TrainResponse | null>(null);
  const [reviewLabel, setReviewLabel] = useState<DrumLabel>("kick");
  const [reviewData, setReviewData] = useState<ReviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const playTick = () => {
    if (!metronome) return;
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.value = 0.05;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.06);
    setTimeout(() => {
      ctx.close().catch(() => {});
    }, 100);
  };

  const runCountdown = async () => {
    setCountdown(3);
    for (let i = 3; i > 0; i -= 1) {
      setCountdown(i);
      playTick();
      await new Promise((r) => setTimeout(r, 1000));
    }
    setCountdown(0);
  };

  const awaitBlob = async (): Promise<Blob> =>
    new Promise((resolve, reject) => {
      const started = Date.now();
      const timer = window.setInterval(() => {
        if (recorder.blob) {
          clearInterval(timer);
          resolve(recorder.blob);
        } else if (recorder.state === "error") {
          clearInterval(timer);
          reject(new Error(recorder.error || "Recording failed"));
        } else if (Date.now() - started > (takeSec + 8) * 1000) {
          clearInterval(timer);
          reject(new Error("Recording timed out"));
        }
      }, 120);
    });

  const startCalibration = async () => {
    try {
      setError(null);
      setWizardState("requesting_mic");
      await recorder.requestMic();
      const started = await api.startSession({
        sampleRate: 16000,
        windowSec,
        targetHitsPerLabel: targetHits,
      });
      setSessionId(started.sessionId);
      setLabels(started.labels);
      setCurrentLabel(started.nextLabel);
      setLabelIndex(started.labels.findIndex((x) => x === started.nextLabel));
      setWizardState("results");
    } catch (err: any) {
      setWizardState("idle");
      setError(err?.message || "Failed to start session");
    }
  };

  const recordForCurrentLabel = async () => {
    if (!sessionId) return;
    try {
      setError(null);
      await runCountdown();
      setWizardState("recording");
      await recorder.start(takeSec);
      const blob = await awaitBlob();
      setWizardState("processing");
      const result = await api.uploadTake({
        sessionId,
        label: currentLabel,
        blob,
        meta: {
          browserSampleRate: null,
          userAgent: navigator.userAgent,
        },
      });
      setLastTake(result);
      setCounts(result.balance);
      setWizardState("results");
    } catch (err: any) {
      setWizardState("results");
      setError(err?.message || "Failed to process take");
    }
  };

  const nextAction = () => {
    if (!lastTake) return;
    if (lastTake.recommendation.action === "retake") return;

    const nextSequential = labelIndex + 1;
    if (nextSequential < labels.length) {
      setLabelIndex(nextSequential);
      setCurrentLabel(labels[nextSequential]);
      return;
    }

    const deficitLabel = getMaxDeficitLabel(lastTake.balance, targetHits);
    if (deficitLabel) {
      setCurrentLabel(deficitLabel);
      setLabelIndex(labels.findIndex((x) => x === deficitLabel));
      return;
    }
    setWizardState("training");
  };

  const loadReview = async (label: DrumLabel) => {
    if (!sessionId) return;
    setReviewLabel(label);
    const result = await api.review(sessionId, label, 10);
    setReviewData(result);
  };

  const deleteReviewSample = async (sampleId: string) => {
    if (!sessionId) return;
    await api.deleteSample(sessionId, sampleId);
    await loadReview(reviewLabel);
  };

  useEffect(() => {
    const run = async () => {
      if (wizardState !== "training" || !sessionId) return;
      try {
        setError(null);
        const report = await api.train(sessionId);
        setTrainReport(report);
        setWizardState("done");
      } catch (err: any) {
        setError(err?.message || "Training failed");
        setWizardState("done");
      }
    };
    run();
    // `api` is memoised at its source now, so listing it costs nothing and
    // stops the training run being kicked off through a stale closure.
  }, [wizardState, sessionId, api]);

  return (
    <main className={`bw-page ${proMode ? "pro" : ""}`}>
      <section className="bw-card">
        <header className="bw-header">
          <h1>Beatbox Drum Calibration Wizard</h1>
          <div className="bw-header-row">
            <label className="bw-toggle">
              <input
                type="checkbox"
                checked={proMode}
                onChange={(e) => setProMode(e.target.checked)}
                aria-label="Toggle pro mode"
              />
              Pro mode
            </label>
            <label className="bw-toggle">
              <input
                type="checkbox"
                checked={metronome}
                onChange={(e) => setMetronome(e.target.checked)}
                aria-label="Toggle metronome"
              />
              Metronome
            </label>
          </div>
        </header>

        {wizardState === "idle" && (
          <div className="bw-grid">
            <div className="bw-settings">
              <label>
                Target hits per label
                <input
                  aria-label="Target hits per label"
                  type="number"
                  min={4}
                  max={200}
                  value={targetHits}
                  onChange={(e) => setTargetHits(Number(e.target.value))}
                />
              </label>
              <label>
                Take length (seconds)
                <input
                  aria-label="Take length seconds"
                  type="number"
                  min={4}
                  max={12}
                  value={takeSec}
                  onChange={(e) => setTakeSec(Number(e.target.value))}
                />
              </label>
              <label>
                Window length (seconds)
                <input
                  aria-label="Window length seconds"
                  type="number"
                  min={0.1}
                  max={0.5}
                  step={0.01}
                  value={windowSec}
                  onChange={(e) => setWindowSec(Number(e.target.value))}
                />
              </label>
            </div>
            {!proMode && <p className="bw-copy">Click start, then record each guided label. Four quick takes is enough.</p>}
            <button className="bw-primary" onClick={startCalibration} aria-label="Start calibration">
              Start calibration
            </button>
          </div>
        )}

        {wizardState !== "idle" && (
          <>
            <div className="bw-progress" role="progressbar" aria-label="Label progress">
              {LABELS.map((label) => (
                <div
                  key={label}
                  className={`bw-pill ${label === currentLabel ? "active" : counts[label] > 0 ? "done" : ""}`}
                >
                  {labelTitle(label)}
                </div>
              ))}
            </div>
            <h2>{labelTitle(currentLabel)}</h2>
            {!proMode && <p className="bw-copy">Repeat the {currentLabel} sound for {takeSec}s.</p>}

            <div className="bw-meter" aria-live="polite">
              <div className="bw-meter-fill" style={{ width: `${Math.round(recorder.level * 100)}%` }} />
              <span>{Math.round(recorder.db)} dB</span>
              {recorder.clip && <span className="bw-warn">Clipping</span>}
            </div>

            {countdown > 0 && <div className="bw-countdown">{countdown}</div>}

            {(wizardState === "results" || wizardState === "recording" || wizardState === "processing") && (
              <div className="bw-actions">
                {wizardState !== "recording" && wizardState !== "processing" && (
                  <button className="bw-primary" onClick={recordForCurrentLabel} aria-label={`Record ${currentLabel}`}>
                    Record {labelTitle(currentLabel)}
                  </button>
                )}
                {wizardState === "recording" && (
                  <button className="bw-secondary" onClick={recorder.stop} aria-label="Stop recording">
                    Stop
                  </button>
                )}
                {wizardState === "processing" && <span>Processing...</span>}
              </div>
            )}

            {lastTake && wizardState === "results" && (
              <article className="bw-results">
                <div className="bw-result-row">
                  <strong>Detected</strong> {lastTake.detectedHits}
                  <strong>Added</strong> {lastTake.added}
                  <strong>Skipped</strong> {lastTake.skipped}
                </div>
                <div className="bw-result-row">
                  <strong>SNR</strong> {lastTake.quality.snrDbMedian.toFixed(1)} dB
                  <strong>Clip</strong> {(lastTake.quality.clipRatioMax * 100).toFixed(2)}%
                  <strong>RMS</strong> {lastTake.quality.rmsMedian.toFixed(3)}
                </div>
                <div className="bw-chip-row">
                  {Object.entries(lastTake.skipReasonsTop)
                    .filter(([, n]) => n > 0)
                    .map(([reason, n]) => (
                      <span key={reason} className="bw-chip">
                        {reason}: {n}
                      </span>
                    ))}
                </div>
                <p className="bw-copy">{lastTake.recommendation.message}</p>
                <div className="bw-actions">
                  <button className="bw-primary" onClick={nextAction}>
                    {lastTake.recommendation.action === "retake" ? `Retake ${labelTitle(currentLabel)}` : "Next"}
                  </button>
                  <button
                    className="bw-secondary"
                    onClick={() => {
                      setWizardState("review");
                      loadReview(currentLabel).catch((err) => setError(err.message));
                    }}
                  >
                    Review worst hits
                  </button>
                </div>
              </article>
            )}
          </>
        )}

        {wizardState === "review" && (
          <section className="bw-review">
            <h3>Review {labelTitle(reviewLabel)} samples</h3>
            <div className="bw-chip-row">
              {LABELS.map((label) => (
                <button key={label} className="bw-chip" onClick={() => loadReview(label)}>
                  {labelTitle(label)}
                </button>
              ))}
            </div>
            {(reviewData?.items || []).map((item) => (
              <div className="bw-review-item" key={item.sampleId}>
                <audio controls src={item.audioUrl} aria-label={`Sample ${item.sampleId}`} />
                <span>Conf {item.confidence.toFixed(2)}</span>
                <span>Quality {item.qualityScore.toFixed(2)}</span>
                <button className="bw-secondary" onClick={() => deleteReviewSample(item.sampleId)}>
                  Delete
                </button>
              </div>
            ))}
            <div className="bw-actions">
              <button className="bw-primary" onClick={() => setWizardState("results")}>
                Done reviewing
              </button>
            </div>
          </section>
        )}

        {wizardState === "training" && <p>Training model...</p>}

        {wizardState === "done" && trainReport && (
          <section className="bw-results">
            <h3>Training report</h3>
            <p>Status: {trainReport.status}</p>
            <p>
              CV accuracy: {trainReport.cvAccuracyMean?.toFixed(3) ?? "N/A"}
              {trainReport.cvAccuracyStd !== undefined ? ` ± ${trainReport.cvAccuracyStd.toFixed(3)}` : ""}
            </p>
            <div className="bw-chip-row">
              {LABELS.map((label) => (
                <span key={label} className="bw-chip">
                  {labelTitle(label)}: {trainReport.counts?.[label] ?? 0}
                </span>
              ))}
            </div>
            <div className="bw-actions">
              <button className="bw-primary" onClick={() => window.location.reload()}>
                Start new calibration
              </button>
            </div>
          </section>
        )}

        {error && <div className="bw-error">{error}</div>}
      </section>
    </main>
  );
}
