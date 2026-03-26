import React, { useEffect, useMemo, useState } from "react";

const normalizeRange = (range) => {
  if (!range) return null;
  const start = Math.min(Number(range.start ?? 0), Number(range.end ?? 0));
  const end = Math.max(Number(range.start ?? 0), Number(range.end ?? 0));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return { start, end };
};

const getClipBounds = (clip) => {
  const start = Number(clip?.timelineStartSec ?? 0);
  const duration = Math.max(0.01, Number(clip?.srcEndSec ?? 0) - Number(clip?.srcStartSec ?? 0));
  return { start, end: start + duration, duration };
};

const makeRandomSeed = () => Math.floor(Math.random() * 1000000000);

const StageDrumsPanel = ({ clips, selection, project, onStartAiJob }) => {
  const [prompt, setPrompt] = useState("");
  const [seed, setSeed] = useState(42);
  const [bpm, setBpm] = useState(project?.bpm || 120);

  useEffect(() => {
    setBpm(project?.bpm || 120);
  }, [project?.bpm]);

  const selectedAudioClips = useMemo(() => {
    const selectedIds = Array.isArray(selection?.clipIds) ? selection.clipIds : [];
    const explicit = clips.filter(
      (clip) => selectedIds.includes(clip.id) && clip.clipType !== "midi" && clip.sourceAssetId
    );
    if (explicit.length) {
      return explicit.sort((a, b) => Number(a.timelineStartSec ?? 0) - Number(b.timelineStartSec ?? 0));
    }

    const range = normalizeRange(selection?.range);
    if (!range) return [];
    const laneIds = Array.isArray(selection?.laneIds) ? selection.laneIds : null;
    return clips
      .filter((clip) => {
        if (clip.clipType === "midi" || !clip.sourceAssetId) return false;
        if (laneIds?.length && !laneIds.includes(clip.laneId)) return false;
        const bounds = getClipBounds(clip);
        return range.end > bounds.start && range.start < bounds.end;
      })
      .sort((a, b) => Number(a.timelineStartSec ?? 0) - Number(b.timelineStartSec ?? 0));
  }, [clips, selection]);

  const sourceRange = useMemo(() => {
    const range = normalizeRange(selection?.range);
    if (range) return range;
    if (!selectedAudioClips.length) return null;
    const starts = selectedAudioClips.map((clip) => getClipBounds(clip).start);
    const ends = selectedAudioClips.map((clip) => getClipBounds(clip).end);
    return { start: Math.min(...starts), end: Math.max(...ends) };
  }, [selection, selectedAudioClips]);

  const canGenerate = Boolean(selectedAudioClips.length && sourceRange);
  const sourceSummary = useMemo(() => {
    if (!selectedAudioClips.length) return "No audio selection";
    if (selectedAudioClips.length === 1) return "1 source track";
    return `${selectedAudioClips.length} source tracks`;
  }, [selectedAudioClips]);

  const handleSubmit = () => {
    if (!canGenerate) return;
    onStartAiJob?.("stage_drums_generate", {
      clipIds: selectedAudioClips.map((clip) => clip.id),
      laneIds: Array.isArray(selection?.laneIds) ? selection.laneIds : undefined,
      startSec: sourceRange.start,
      endSec: sourceRange.end,
      timelineStartSec: sourceRange.start,
      insertSec: sourceRange.start,
      durationSec: Math.max(0.5, sourceRange.end - sourceRange.start),
      prompt: prompt.trim(),
      seed: Number.isFinite(Number(seed)) ? Number(seed) : 42,
      bpm: Number(bpm) || project?.bpm || 120,
      label: "STAGE Drums",
    });
  };

  return (
    <div className="studio-panel-content studio-voice-midi">
      <div className="studio-meta-block">
        <div className="studio-panel-title">STAGE Drums</div>
        <div className="studio-subtext">
          Generate a drum stem from one selected audio track or multiple selected tracks over the same timeline span.
          Rhymix will merge the selected audio into a temporary conditioning mix before running STAGE.
        </div>
      </div>

      <div className="studio-meta-block">
        {canGenerate ? (
          <>
            <div className="studio-subtext">
              Source: {sourceSummary} · {sourceRange.start.toFixed(2)}s to {sourceRange.end.toFixed(2)}s
            </div>
            <div className="studio-subtext" style={{ marginTop: 4 }}>
              Generated drums will be inserted on a fresh generated lane starting at the selected range.
            </div>
          </>
        ) : (
          <div className="studio-empty">Select one or more audio clips, or drag a range over audio clips, to generate drums.</div>
        )}
      </div>

      <div className="studio-field">
        <label>Description</label>
        <textarea
          rows={3}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="Punchy modern drums, tight kick, crisp snare, energetic hats"
        />
      </div>

      <div className="studio-inline">
        <div className="studio-field">
          <label>BPM</label>
          <input
            type="number"
            min="40"
            max="240"
            step="1"
            value={bpm}
            onChange={(event) => setBpm(Number(event.target.value) || 120)}
          />
        </div>
        <div className="studio-field">
          <div className="studio-field-head">
            <label>Seed</label>
            <button className="studio-mini" type="button" onClick={() => setSeed(makeRandomSeed())}>
              Randomize
            </button>
          </div>
          <input
            type="number"
            step="1"
            value={seed}
            onChange={(event) => setSeed(Number(event.target.value) || 42)}
          />
        </div>
      </div>

      <div className="studio-actions-row">
        <button className="studio-btn accent" disabled={!canGenerate} onClick={handleSubmit}>
          Generate Drums
        </button>
      </div>
    </div>
  );
};

export default StageDrumsPanel;
