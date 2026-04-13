import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LABELS } from "./types";
import { useSessionApi } from "./useSessionApi";
import { useMicrophoneRecorder } from "./useMicrophoneRecorder";
import "./wizard.css";

function labelTitle(label) {
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function getMaxDeficitLabel(counts, target) {
  let best = null;
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

function WizardModal({ open, title, children, footer, onClose }) {
  if (!open) return null;
  return createPortal(
    <div className="bw-modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="bw-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="bw-modal-header">
          <h3>{title}</h3>
          <button className="bw-icon-btn" onClick={onClose} aria-label="Close dialog">
            x
          </button>
        </header>
        <div className="bw-modal-body">{children}</div>
        <footer className="bw-modal-footer">{footer}</footer>
      </div>
    </div>,
    document.body
  );
}

function qualityVerdict(take) {
  if (!take) return "neutral";
  const recBad = take.recommendation?.action === "retake";
  const lowSnr = take.quality?.snrDbMedian < 10;
  const clipped = take.quality?.clipRatioMax > 0.01;
  if (recBad || lowSnr || clipped) return "bad";
  return "good";
}

function qualityTips(take) {
  if (!take) return [];
  const tips = [];
  const reasons = take.skipReasonsTop || {};
  if ((reasons.low_snr || 0) > 0 || take.quality?.snrDbMedian < 10) {
    tips.push("Move closer to the mic and reduce room noise.");
  }
  if ((reasons.clipping || 0) > 0 || take.quality?.clipRatioMax > 0.01) {
    tips.push("Back off the mic slightly to avoid clipping.");
  }
  if ((reasons.silence || 0) > 0) {
    tips.push("Hit with stronger attacks and keep a steady rhythm.");
  }
  if ((reasons.duplicate || 0) > 0) {
    tips.push("Vary hit intensity a bit so samples are not near-identical.");
  }
  return tips.slice(0, 3);
}

const COACH = {
  kick: "Tip: tight 'p' or 'b' burst, close to mic.",
  snare: "Tip: 'k' + breath ('kah') for a sharp crack.",
  hat: "Tip: clean 'tss' noise, lighter hits, steady rhythm.",
  clap: "Tip: 'pf' / lip-pop, avoid long breathy tails.",
};

function useBeep() {
  const ctxRef = useRef(null);
  const beep = useCallback((freq = 880, ms = 60, gainVal = 0.05) => {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!ctxRef.current) ctxRef.current = new AudioCtx();
    const ctx = ctxRef.current;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    gain.gain.value = gainVal;
    osc.connect(gain).connect(ctx.destination);
    const t0 = ctx.currentTime;
    osc.start(t0);
    osc.stop(t0 + ms / 1000);
  }, []);

  useEffect(() => {
    return () => {
      if (ctxRef.current) {
        ctxRef.current.close().catch(() => {});
        ctxRef.current = null;
      }
    };
  }, []);

  return beep;
}

export default function BeatboxCalibrationWizard({ embedded = false, onClose = null, onTrained = null } = {}) {
  const api = useSessionApi();
  const recorder = useMicrophoneRecorder();
  const beep = useBeep();
  const autoAdvanceTimerRef = useRef(null);

  const [wizardState, setWizardState] = useState("idle");
  const [proMode, setProMode] = useState(false);
  const [metronome, setMetronome] = useState(false);
  const [targetHits, setTargetHits] = useState(25);
  const [takeSec, setTakeSec] = useState(8);
  const [windowSec, setWindowSec] = useState(0.25);
  const [countdown, setCountdown] = useState(0);

  const [sessionId, setSessionId] = useState(null);
  const [labels, setLabels] = useState(LABELS);
  const [labelIndex, setLabelIndex] = useState(0);
  const [sequenceComplete, setSequenceComplete] = useState(false);
  const [currentLabel, setCurrentLabel] = useState("kick");
  const [counts, setCounts] = useState({
    kick: 0,
    snare: 0,
    hat: 0,
    clap: 0,
  });

  const [lastTake, setLastTake] = useState(null);
  const [trainReport, setTrainReport] = useState(null);
  const [reviewLabel, setReviewLabel] = useState("kick");
  const [reviewData, setReviewData] = useState(null);
  const [error, setError] = useState(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [trainingOpen, setTrainingOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [trainingBusy, setTrainingBusy] = useState(false);
  const [autoAdvancing, setAutoAdvancing] = useState(false);
  const [holdRecording, setHoldRecording] = useState(false);
  const [reviewSort, setReviewSort] = useState("confidence");
  const [reviewSelected, setReviewSelected] = useState({});

  const progress = useMemo(() => {
    const done = labels.findIndex((x) => x === currentLabel);
    return Math.max(1, done + 1);
  }, [labels, currentLabel]);
  const verdict = useMemo(() => qualityVerdict(lastTake), [lastTake]);
  const readyToTrain = useMemo(
    () => LABELS.every((label) => (counts[label] || 0) >= targetHits),
    [counts, targetHits]
  );
  const levelStatus = useMemo(() => {
    if (recorder.clip) return "Clipping";
    if (recorder.db < -35) return "Too quiet";
    return "Good level";
  }, [recorder.clip, recorder.db]);

  const playTick = useCallback(() => {
    if (!metronome) return;
    beep(880, 60, 0.05);
  }, [metronome, beep]);

  const runCountdown = useCallback(async () => {
    setCountdown(3);
    for (let i = 3; i > 0; i -= 1) {
      setCountdown(i);
      playTick();
      await new Promise((r) => setTimeout(r, 1000));
    }
    setCountdown(0);
  }, [playTick]);

  const awaitBlob = useCallback(async () =>
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
    }), [recorder.blob, recorder.state, recorder.error, takeSec]);

  const clearAutoAdvance = useCallback(() => {
    if (autoAdvanceTimerRef.current) {
      window.clearTimeout(autoAdvanceTimerRef.current);
      autoAdvanceTimerRef.current = null;
    }
    setAutoAdvancing(false);
  }, []);

  const moveToLabel = useCallback(
    (label) => {
      setCurrentLabel(label);
      setLabelIndex(labels.findIndex((x) => x === label));
      setLastTake(null);
      setAutoAdvancing(false);
    },
    [labels]
  );

  const continueAfterTake = useCallback(
    (takeResult) => {
      if (!takeResult) return;
      if (takeResult.recommendation?.action === "retake") {
        setFeedbackOpen(true);
        setAutoAdvancing(false);
        return;
      }

      let sequenceDone = sequenceComplete;
      if (!sequenceDone) {
        const nextSequential = labelIndex + 1;
        if (nextSequential < labels.length) {
          moveToLabel(labels[nextSequential]);
          return;
        }
        sequenceDone = true;
        setSequenceComplete(true);
      }

      const deficitLabel = getMaxDeficitLabel(takeResult.balance || counts, targetHits);
      if (deficitLabel) {
        moveToLabel(deficitLabel);
        return;
      }

      if (sequenceDone) {
        setTrainingOpen(true);
        setAutoAdvancing(false);
      }
    },
    [sequenceComplete, labelIndex, labels, moveToLabel, counts, targetHits]
  );

  const startCalibration = async () => {
    try {
      setError(null);
      clearAutoAdvance();
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
      setSequenceComplete(false);
      setCounts({ kick: 0, snare: 0, hat: 0, clap: 0 });
      setLastTake(null);
      setTrainReport(null);
      setFeedbackOpen(false);
      setTrainingOpen(false);
      setReviewOpen(false);
      setWizardState("results");
    } catch (err) {
      setWizardState("idle");
      setError(err?.message || "Failed to start session");
    }
  };

  const processCapturedBlob = useCallback(
    async (blob) => {
      if (!sessionId) return;
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
      setReviewSelected({});
      if (result?.recommendation?.action === "next") {
        setFeedbackOpen(false);
        setAutoAdvancing(true);
        autoAdvanceTimerRef.current = window.setTimeout(() => {
          continueAfterTake(result);
        }, 1200);
      } else {
        setFeedbackOpen(true);
      }
      setWizardState("results");
    },
    [sessionId, api, currentLabel, continueAfterTake]
  );

  const recordForCurrentLabel = useCallback(async () => {
    if (!sessionId) return;
    try {
      setError(null);
      clearAutoAdvance();
      await runCountdown();
      setWizardState("recording");
      await recorder.start(takeSec);
      const blob = await awaitBlob();
      setWizardState("processing");
      await processCapturedBlob(blob);
    } catch (err) {
      setWizardState("results");
      setError(err?.message || "Failed to process take");
    }
  }, [sessionId, clearAutoAdvance, runCountdown, recorder, awaitBlob, takeSec, processCapturedBlob]);

  const startHoldRecording = useCallback(async () => {
    if (!sessionId || holdRecording || wizardState === "processing") return;
    try {
      setError(null);
      clearAutoAdvance();
      setHoldRecording(true);
      setWizardState("recording");
      await recorder.start(Math.max(16, takeSec + 8));
    } catch (err) {
      setHoldRecording(false);
      setWizardState("results");
      setError(err?.message || "Failed to start hold recording");
    }
  }, [sessionId, holdRecording, wizardState, clearAutoAdvance, recorder, takeSec]);

  const stopHoldRecording = useCallback(async () => {
    if (!holdRecording) return;
    try {
      recorder.stop();
      setHoldRecording(false);
      const blob = await awaitBlob();
      setWizardState("processing");
      await processCapturedBlob(blob);
    } catch (err) {
      setHoldRecording(false);
      setWizardState("results");
      setError(err?.message || "Failed to process hold recording");
    }
  }, [holdRecording, recorder, awaitBlob, processCapturedBlob]);

  const continueAfterFeedback = () => {
    if (!lastTake) return;
    if (lastTake.recommendation?.action === "retake") {
      setFeedbackOpen(false);
      recordForCurrentLabel();
      return;
    }
    setFeedbackOpen(false);
    continueAfterTake(lastTake);
  };

  const loadReview = async (label, sort = reviewSort) => {
    if (!sessionId) return;
    setReviewLabel(label);
    const result = await api.review(sessionId, label, 10, sort);
    setReviewData(result);
  };

  const deleteReviewSample = async (sampleId) => {
    if (!sessionId) return;
    await api.deleteSample(sessionId, sampleId);
    await loadReview(reviewLabel, reviewSort);
  };

  const startTraining = async () => {
    if (!sessionId || trainingBusy) return;
    try {
      setError(null);
      setTrainingBusy(true);
      setWizardState("training");
      const report = await api.train(sessionId);
      setTrainReport(report);
      setWizardState("done");
      if (onTrained) {
        onTrained(report);
      }
    } catch (err) {
      setError(err?.message || "Training failed");
      setWizardState("results");
    } finally {
      setTrainingBusy(false);
    }
  };

  const focusNeededLabel = () => {
    const targetCounts = trainReport?.counts || counts;
    const deficitLabel = getMaxDeficitLabel(targetCounts, targetHits);
    if (deficitLabel) {
      moveToLabel(deficitLabel);
      setTrainingOpen(false);
      setWizardState("results");
    }
  };

  const openReview = async () => {
    try {
      await loadReview(currentLabel, reviewSort);
      setReviewOpen(true);
    } catch (err) {
      setError(err?.message || "Could not load review list");
    }
  };

  const sortedReviewItems = useMemo(() => reviewData?.items || [], [reviewData]);

  const deleteSelectedReviewSamples = async () => {
    if (!sessionId) return;
    const selectedIds = Object.entries(reviewSelected)
      .filter(([, checked]) => Boolean(checked))
      .map(([sampleId]) => sampleId);
    if (selectedIds.length === 0) return;
    try {
      for (const sampleId of selectedIds) {
        await api.deleteSample(sessionId, sampleId);
      }
      setReviewSelected({});
      await loadReview(reviewLabel, reviewSort);
    } catch (err) {
      setError(err?.message || "Failed to delete selected samples");
    }
  };

  useEffect(() => {
    if (!reviewOpen || !sessionId) return;
    loadReview(reviewLabel, reviewSort).catch(() => {});
  }, [reviewSort, reviewOpen, sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return () => {
      clearAutoAdvance();
    };
  }, [clearAutoAdvance]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.code !== "Space") return;
      const target = event.target;
      const isTyping =
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (isTyping) return;
      if (wizardState === "results" && !autoAdvancing && !trainingBusy) {
        event.preventDefault();
        recordForCurrentLabel();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [wizardState, autoAdvancing, trainingBusy, recordForCurrentLabel]);

  return (
    <main className={`bw-page ${proMode ? "pro" : ""} ${embedded ? "embedded" : ""}`}>
      <section className="bw-card">
        <header className="bw-header">
          <div className="bw-header-main">
            <h1>Beatbox Drum Calibration Wizard</h1>
            {embedded && onClose && (
              <button className="bw-icon-btn" onClick={onClose} aria-label="Close Beatbox Wizard">
                x
              </button>
            )}
          </div>
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
            <div
              className="bw-progress"
              role="progressbar"
              aria-label="Label progress"
              aria-valuemin={1}
              aria-valuemax={4}
              aria-valuenow={progress}
            >
              {LABELS.map((label) => (
                <div
                  key={label}
                  className={`bw-pill ${label === currentLabel ? "active" : counts[label] > 0 ? "done" : ""}`}
                >
                  {labelTitle(label)}
                  <span className="bw-pill-count">
                    {counts[label] || 0}/{targetHits}
                  </span>
                </div>
              ))}
            </div>
            <p className="bw-copy">
              Step {Math.min(progress, 4)} / 4 - Current: <strong>{labelTitle(currentLabel)}</strong>
            </p>
            <h2>{labelTitle(currentLabel)}</h2>
            {!proMode && <p className="bw-copy">{COACH[currentLabel]}</p>}
            {!proMode && <p className="bw-copy">Repeat the {currentLabel} sound for {takeSec}s.</p>}

            <div className="bw-meter" aria-live="polite">
              <div className="bw-meter-fill" style={{ width: `${Math.round(recorder.level * 100)}%` }} />
              <span>{Math.round(recorder.db)} dB</span>
              <span className={`bw-level ${levelStatus.replace(" ", "-").toLowerCase()}`}>{levelStatus}</span>
              {recorder.clip && <span className="bw-warn">Back off mic</span>}
            </div>

            {countdown > 0 && <div className="bw-countdown">{countdown}</div>}

            {(wizardState === "results" || wizardState === "recording" || wizardState === "processing") && (
              <div className="bw-actions">
                {wizardState !== "recording" && wizardState !== "processing" && (
                  <button className="bw-primary" onClick={recordForCurrentLabel} aria-label={`Record ${currentLabel}`}>
                    Record {labelTitle(currentLabel)}
                  </button>
                )}
                {wizardState !== "processing" && (
                  <button
                    className={`bw-secondary ${holdRecording ? "active" : ""}`}
                    onMouseDown={startHoldRecording}
                    onMouseUp={stopHoldRecording}
                    onMouseLeave={stopHoldRecording}
                    onTouchStart={startHoldRecording}
                    onTouchEnd={stopHoldRecording}
                    aria-label="Hold to record"
                  >
                    {holdRecording ? "Release to stop" : "Hold to record"}
                  </button>
                )}
                {wizardState === "recording" && (
                  <button
                    className="bw-secondary"
                    onClick={() => {
                      if (holdRecording) {
                        stopHoldRecording();
                      } else {
                        recorder.stop();
                      }
                    }}
                    aria-label="Stop recording"
                  >
                    Stop
                  </button>
                )}
                {wizardState === "processing" && <span>Processing...</span>}
              </div>
            )}

            {lastTake && wizardState === "results" && (
              <article className="bw-results">
                <div className={`bw-quality-banner ${verdict === "good" ? "good" : "bad"}`}>
                  {verdict === "good"
                    ? "Good take. You are ready for the next step."
                    : "This take needs improvement. Redo this step for cleaner data."}
                </div>
                <div className="bw-result-row">
                  <strong>Detected</strong> {lastTake.detectedHits}
                  <strong>Added</strong> {lastTake.added}
                  <strong>Skipped</strong> {lastTake.skipped}
                </div>
                <div className="bw-result-row">
                  <strong>SNR</strong> {lastTake.quality.snrDbMedian.toFixed(1)} dB
                  <strong>Clip</strong> {(lastTake.quality.clipRatioMax * 100).toFixed(2)}%
                  <strong>RMS</strong> {lastTake.quality.rmsMedian.toFixed(3)}
                  {lastTake.consistency !== null && lastTake.consistency !== undefined && (
                    <>
                      <strong>Consistency</strong> {Math.round(lastTake.consistency * 100)}%
                    </>
                  )}
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
                {lastTake.predictedTop && Object.keys(lastTake.predictedTop).length > 0 && (
                  <div className="bw-chip-row">
                    {Object.entries(lastTake.predictedTop).map(([pred, n]) => (
                      <span key={pred} className="bw-chip">
                        predicted {pred}: {n}
                      </span>
                    ))}
                  </div>
                )}
                {lastTake.needMore?.[currentLabel] > 0 && (
                  <p className="bw-copy">Need {lastTake.needMore[currentLabel]} more {currentLabel} hits.</p>
                )}
                <p className="bw-copy">{lastTake.recommendation.message}</p>
                <div className="bw-actions">
                  <button
                    className="bw-primary"
                    disabled={autoAdvancing}
                    onClick={() => {
                      if (lastTake.recommendation?.action === "next") {
                        continueAfterTake(lastTake);
                      } else {
                        setFeedbackOpen(true);
                      }
                    }}
                  >
                    {autoAdvancing
                      ? "Recording next..."
                      : lastTake.recommendation?.action === "next"
                        ? "Next label"
                        : "Record again"}
                  </button>
                  <button className="bw-secondary" onClick={openReview}>
                    Review worst hits
                  </button>
                  {readyToTrain && (
                    <button className="bw-secondary" onClick={() => setTrainingOpen(true)}>
                      Open training summary
                    </button>
                  )}
                </div>
              </article>
            )}
          </>
        )}

        {wizardState === "training" && <p>Training model...</p>}

        {error && <div className="bw-error">{error}</div>}
      </section>

      <WizardModal
        open={feedbackOpen}
        onClose={() => setFeedbackOpen(false)}
        title={`${labelTitle(currentLabel)} take feedback`}
        footer={
          <>
            <button className="bw-secondary" onClick={() => setFeedbackOpen(false)}>
              Stay here
            </button>
            {lastTake?.recommendation?.action === "retake" ? (
              <button className="bw-primary" onClick={continueAfterFeedback}>
                Redo this step
              </button>
            ) : (
              <button className="bw-primary" onClick={continueAfterFeedback}>
                {readyToTrain ? "Looks good, prepare training" : "Looks good, next step"}
              </button>
            )}
          </>
        }
      >
        {lastTake && (
          <>
            <div className={`bw-quality-banner ${qualityVerdict(lastTake) === "good" ? "good" : "bad"}`}>
              {qualityVerdict(lastTake) === "good"
                ? "Clean samples captured."
                : "Quality is below target for reliable training."}
            </div>
            <div className="bw-result-row">
              <strong>Detected</strong> {lastTake.detectedHits}
              <strong>Added</strong> {lastTake.added}
              <strong>Skipped</strong> {lastTake.skipped}
            </div>
            <div className="bw-result-row">
              <strong>SNR</strong> {lastTake.quality.snrDbMedian.toFixed(1)} dB
              <strong>Clip</strong> {(lastTake.quality.clipRatioMax * 100).toFixed(2)}%
              <strong>RMS</strong> {lastTake.quality.rmsMedian.toFixed(3)}
              {lastTake.consistency !== null && lastTake.consistency !== undefined && (
                <>
                  <strong>Consistency</strong> {Math.round(lastTake.consistency * 100)}%
                </>
              )}
            </div>
            <div className="bw-chip-row">
              {Object.entries(lastTake.skipReasonsTop || {})
                .filter(([, n]) => n > 0)
                .map(([reason, n]) => (
                  <span key={reason} className="bw-chip">
                    {reason}: {n}
                  </span>
                ))}
            </div>
            {lastTake.predictedTop && Object.keys(lastTake.predictedTop).length > 0 && (
              <div className="bw-chip-row">
                {Object.entries(lastTake.predictedTop).map(([pred, n]) => (
                  <span key={pred} className="bw-chip">
                    predicted {pred}: {n}
                  </span>
                ))}
              </div>
            )}
            <div className="bw-tips">
              {qualityTips(lastTake).map((tip) => (
                <p key={tip}>{tip}</p>
              ))}
            </div>
            {lastTake.needMore?.[currentLabel] > 0 && (
              <p className="bw-copy">Need {lastTake.needMore[currentLabel]} more {currentLabel} hits.</p>
            )}
            <p className="bw-copy">{lastTake.recommendation.message}</p>
          </>
        )}
      </WizardModal>

      <WizardModal
        open={trainingOpen}
        onClose={() => {
          if (!trainingBusy) setTrainingOpen(false);
        }}
        title="Training readiness"
        footer={
          <>
            {!trainingBusy && !trainReport && (
              <button className="bw-secondary" onClick={() => setTrainingOpen(false)}>
                Keep collecting
              </button>
            )}
            {!trainingBusy && !trainReport && (
              <button className="bw-primary" onClick={startTraining} disabled={!readyToTrain}>
                Start training
              </button>
            )}
            {!trainingBusy && trainReport?.status !== "trained" && (
              <button className="bw-primary" onClick={focusNeededLabel}>
                Collect missing hits
              </button>
            )}
            {!trainingBusy && trainReport?.status === "trained" && (
              <button
                className="bw-primary"
                onClick={() => {
                  setTrainingOpen(false);
                  if (embedded && onClose) onClose();
                }}
              >
                {embedded ? "Done and close" : "Done"}
              </button>
            )}
          </>
        }
      >
        {!trainReport && (
          <>
            <p className="bw-copy">
              Review counts before training. Green means ready, red means redo more takes.
            </p>
            <div className="bw-chip-row">
              {LABELS.map((label) => {
                const ok = (counts[label] || 0) >= targetHits;
                return (
                  <span key={label} className={`bw-chip ${ok ? "ok" : "bad"}`}>
                    {labelTitle(label)}: {counts[label] || 0}/{targetHits}
                  </span>
                );
              })}
            </div>
            {!readyToTrain && (
              <div className="bw-quality-banner bad">
                Not ready yet. Add more takes for the labels below target.
              </div>
            )}
          </>
        )}
        {trainingBusy && <p>Training in progress... this usually takes a few seconds.</p>}
        {!trainingBusy && trainReport && (
          <section className="bw-results">
            <h3>Training report</h3>
            <p>Status: {trainReport.status}</p>
            <p>
              CV accuracy: {trainReport.cvAccuracyMean?.toFixed(3) ?? "N/A"}
              {trainReport.cvAccuracyStd !== undefined ? ` ± ${trainReport.cvAccuracyStd.toFixed(3)}` : ""}
            </p>
            <div className="bw-chip-row">
              {LABELS.map((label) => {
                const value = trainReport.counts?.[label] ?? 0;
                const ok = value >= targetHits;
                return (
                  <span key={label} className={`bw-chip ${ok ? "ok" : "bad"}`}>
                    {labelTitle(label)}: {value}/{targetHits}
                  </span>
                );
              })}
            </div>
            {trainReport.status !== "trained" && (
              <div className="bw-quality-banner bad">
                More data is needed before the model can generalize reliably.
              </div>
            )}
          </section>
        )}
      </WizardModal>

      <WizardModal
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        title={`Review ${labelTitle(reviewLabel)} samples`}
        footer={
          <>
            <button className="bw-secondary" onClick={deleteSelectedReviewSamples}>
              Delete selected
            </button>
            <button className="bw-primary" onClick={() => setReviewOpen(false)}>
              Done reviewing
            </button>
          </>
        }
      >
        <div className="bw-chip-row">
          {LABELS.map((label) => (
            <button key={label} className="bw-chip" onClick={() => loadReview(label)}>
              {labelTitle(label)}
            </button>
          ))}
        </div>
        <div className="bw-chip-row">
          <button className={`bw-chip ${reviewSort === "confidence" ? "ok" : ""}`} onClick={() => setReviewSort("confidence")}>
            Worst confidence
          </button>
          <button className={`bw-chip ${reviewSort === "quality" ? "ok" : ""}`} onClick={() => setReviewSort("quality")}>
            Worst quality
          </button>
        </div>
        {sortedReviewItems.map((item) => (
          <div className="bw-review-item" key={item.sampleId}>
            <label className="bw-review-check">
              <input
                type="checkbox"
                checked={Boolean(reviewSelected[item.sampleId])}
                onChange={(e) =>
                  setReviewSelected((prev) => ({
                    ...prev,
                    [item.sampleId]: e.target.checked,
                  }))
                }
                aria-label={`Select sample ${item.sampleId}`}
              />
            </label>
            <audio controls src={item.audioUrl} aria-label={`Sample ${item.sampleId}`} />
            <span>Conf {item.confidence.toFixed(2)}</span>
            <span>Quality {item.qualityScore.toFixed(2)}</span>
            <span className={`bw-chip ${item.reviewReason === "low_confidence" ? "bad" : "ok"}`}>
              {item.reviewReason === "low_confidence" ? "low confidence" : "low quality"}
            </span>
            <button className="bw-secondary" onClick={() => deleteReviewSample(item.sampleId)}>
              Delete
            </button>
          </div>
        ))}
        {sortedReviewItems.length === 0 && <p className="bw-copy">No review items yet for this label.</p>}
      </WizardModal>
    </main>
  );
}
