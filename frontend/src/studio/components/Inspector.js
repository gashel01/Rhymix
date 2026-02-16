import React, { useEffect, useMemo, useState } from "react";
import VoiceToMidiPanel from "./VoiceToMidiPanel";

const SOUND_FONT_OPTIONS = [
  { value: "", label: "Use lane default" },
  { value: "acoustic_grand_piano", label: "Piano" },
  { value: "electric_guitar_clean", label: "Guitar (Clean)" },
  { value: "acoustic_bass", label: "Bass" },
  { value: "string_ensemble_1", label: "Strings" },
  { value: "synth_pad_1_new_age", label: "Synth Pad" },
  { value: "synth_drum", label: "Synth Drum" },
  { value: "choir_aahs", label: "Choir" },
  { value: "flute", label: "Flute" },
  { value: "alto_sax", label: "Sax" },
  { value: "trumpet", label: "Trumpet" },
];

const Inspector = ({
  project,
  lanes,
  clips,
  selection,
  onSplit,
  onTrimLeft,
  onTrimRight,
  onMoveClip,
  onDeleteSelection,
  onDuplicateSelection,
  onStartAiJob,
  onUpdateLane,
  onUpdateClip,
  onUpdateProject,
  transport,
  studioActions,
  metadata,
  playheadTime,
  onRefreshProject,
}) => {
  const [tab, setTab] = useState("details");
  const selectedClip = useMemo(
    () => clips.find((clip) => selection?.clipIds?.[0] === clip.id),
    [clips, selection]
  );
  const selectedLaneId = selection?.laneIds?.[0] || selectedClip?.laneId;
  const selectedLane = useMemo(
    () => lanes?.find((lane) => lane.id === selectedLaneId),
    [lanes, selectedLaneId]
  );

  const [clipForm, setClipForm] = useState({
    timelineStartSec: 0,
    srcStartSec: 0,
    srcEndSec: 0,
  });

  useEffect(() => {
    if (!selectedClip) return;
    setClipForm({
      timelineStartSec: selectedClip.timelineStartSec ?? 0,
      srcStartSec: selectedClip.srcStartSec ?? 0,
      srcEndSec: selectedClip.srcEndSec ?? 0,
    });
  }, [selectedClip]);

  const [prompt, setPrompt] = useState("");
  const [durationSec, setDurationSec] = useState(10);
  const [startSec, setStartSec] = useState(selection?.range?.start ?? 0);
  const [endSec, setEndSec] = useState(selection?.range?.end ?? 5);
  const [weirdness, setWeirdness] = useState(20);
  const [styleInfluence, setStyleInfluence] = useState(70);
  const [audioInfluence, setAudioInfluence] = useState(50);

  useEffect(() => {
    if (selection?.range) {
      setStartSec(selection.range.start);
      setEndSec(selection.range.end);
    }
  }, [selection]);

  return (
    <div className="studio-inspector">
      <div className="studio-panel-title">Details & Modifiers</div>
      <div className="studio-tabs">
        {[
          { id: "details", label: "Details" },
          { id: "ai", label: "AI Actions" },
          { id: "voice_midi", label: "Voice → MIDI" },
          { id: "fx", label: "FX" },
          { id: "meta", label: "Metadata" },
        ].map((item) => (
          <button
            key={item.id}
            className={`studio-tab ${tab === item.id ? "active" : ""}`}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "details" && (
        <div className="studio-panel-content">
          {!selectedClip ? (
            <>
              <div className="studio-meta-block">
                <div className="studio-panel-title">Project Settings</div>
                <div className="studio-field">
                  <label>BPM</label>
                  <input
                    type="number"
                    min="40"
                    max="240"
                    step="1"
                    value={project?.bpm ?? 120}
                    onChange={(e) => {
                      const bpm = Math.max(40, Math.min(240, Number(e.target.value) || 120));
                      onUpdateProject?.({ bpm });
                    }}
                  />
                </div>
                <div className="studio-field">
                  <label>Key</label>
                  <input
                    type="text"
                    value={project?.key || ""}
                    placeholder="C minor"
                    onChange={(e) => onUpdateProject?.({ key: e.target.value })}
                  />
                </div>
                <div className="studio-field">
                  <label>Time Signature</label>
                  <input
                    type="text"
                    value={project?.timeSignature || ""}
                    placeholder="4/4"
                    onChange={(e) => onUpdateProject?.({ timeSignature: e.target.value })}
                  />
                </div>
                <div className="studio-field">
                  <label>Transpose (semitones)</label>
                  <input
                    type="number"
                    step="1"
                    value={project?.transpose || 0}
                    onChange={(e) => onUpdateProject?.({ transpose: Number(e.target.value) || 0 })}
                  />
                </div>
              </div>
              <div className="studio-empty">Select a clip for clip-specific controls.</div>
            </>
          ) : (
            <>
              <div className="studio-meta-block">
                <div className="studio-panel-title">Clip Settings</div>
                <div className="studio-field">
                  <label>Timeline Start (s)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={clipForm.timelineStartSec}
                    onChange={(e) =>
                      setClipForm((prev) => ({ ...prev, timelineStartSec: Number(e.target.value) }))
                    }
                  />
                  <button
                    className="studio-btn ghost"
                    onClick={() => onMoveClip(selectedClip.id, clipForm.timelineStartSec)}
                  >
                    Move
                  </button>
                </div>
                <div className="studio-inline">
                  <div className="studio-field">
                    <label>Trim Left (s)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={clipForm.timelineStartSec}
                      onChange={(e) =>
                        setClipForm((prev) => ({ ...prev, timelineStartSec: Number(e.target.value) }))
                      }
                    />
                    <button
                      className="studio-btn ghost"
                      onClick={() => onTrimLeft(selectedClip.id, clipForm.timelineStartSec)}
                    >
                      Trim
                    </button>
                  </div>
                  <div className="studio-field">
                    <label>Trim Right (s)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={clipForm.srcEndSec}
                      onChange={(e) =>
                        setClipForm((prev) => ({ ...prev, srcEndSec: Number(e.target.value) }))
                      }
                    />
                    <button
                      className="studio-btn ghost"
                      onClick={() =>
                        onTrimRight(
                          selectedClip.id,
                          (selectedClip.timelineStartSec ?? 0) +
                            (clipForm.srcEndSec - (selectedClip.srcStartSec ?? 0))
                        )
                      }
                    >
                      Trim
                    </button>
                  </div>
                </div>
                <div className="studio-actions-row">
                  <button
                    className="studio-btn"
                    onClick={() => onSplit(selectedClip.id, selection?.range?.start ?? playheadTime ?? 0)}
                  >
                    Remix / Edit (Split)
                  </button>
                </div>
                {selectedClip.clipType === "midi" && (
                  <div className="studio-field">
                    <label>SoundFont (MIDI clip)</label>
                    <select
                      value={selectedClip.midi?.soundfont || ""}
                      onChange={(e) => {
                        const soundfont = e.target.value || null;
                        const nextMidi = { ...(selectedClip.midi || {}), soundfont };
                        onUpdateClip?.(selectedClip.id, { midi: nextMidi });
                      }}
                    >
                      {SOUND_FONT_OPTIONS.map((opt) => (
                        <option key={opt.value || "default"} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              <div className="studio-meta-block">
                <div className="studio-panel-title">Stems</div>
                <div className="studio-stems-row">
                  {[
                    { id: "vocal", label: "Vocal" },
                    { id: "drums", label: "Drums" },
                    { id: "bass", label: "Bass" },
                    { id: "other", label: "Other" },
                  ].map((stem) => (
                    <button
                      key={stem.id}
                      className="studio-mini"
                      onClick={() =>
                        onStartAiJob("stem_extract_uvr", {
                          stem: stem.id,
                          sourceAssetId: selectedClip.sourceAssetId,
                        })
                      }
                    >
                      {stem.label}
                    </button>
                  ))}
                </div>
                <div className="studio-actions-row">
                  <button
                    className="studio-btn accent"
                    onClick={() =>
                      onStartAiJob("stem_extract_uvr", {
                        sourceAssetId: selectedClip.sourceAssetId,
                      })
                    }
                  >
                    Extract Stems (UVR)
                  </button>
                  <button
                    className="studio-btn ghost"
                    onClick={() =>
                      onStartAiJob("stem_extract", {
                        sourceAssetId: selectedClip.sourceAssetId,
                      })
                    }
                  >
                    Extract Stems (Instrumental)
                  </button>
                </div>
              </div>

              <div className="studio-meta-block">
                <div className="studio-panel-title">Modifiers</div>
                <div className="studio-field">
                  <label>Weirdness ({weirdness})</label>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={weirdness}
                    onChange={(e) => setWeirdness(Number(e.target.value))}
                  />
                </div>
                <div className="studio-field">
                  <label>Style Influence ({styleInfluence})</label>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={styleInfluence}
                    onChange={(e) => setStyleInfluence(Number(e.target.value))}
                  />
                </div>
                <div className="studio-field">
                  <label>Audio Influence ({audioInfluence})</label>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={audioInfluence}
                    onChange={(e) => setAudioInfluence(Number(e.target.value))}
                  />
                </div>
              </div>
            </>
          )}

          <div className="studio-actions-row">
            <button
              className="studio-btn ghost"
              onClick={() => onDeleteSelection(selection?.range, selection?.laneIds, selection?.clipIds)}
            >
              Delete Selection
            </button>
            <button
              className="studio-btn ghost"
              onClick={() => onDuplicateSelection(selection?.range, selection?.laneIds, selection?.range?.end ?? 0)}
            >
              Duplicate Selection
            </button>
          </div>
        </div>
      )}

      {tab === "ai" && (
        <div className="studio-panel-content">
          <div className="studio-field">
            <label>Prompt</label>
            <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} />
          </div>
          <div className="studio-field">
            <label>Start / End (s)</label>
            <div className="studio-inline">
              <input
                type="number"
                step="0.1"
                value={startSec}
                onChange={(e) => setStartSec(Number(e.target.value))}
              />
              <input
                type="number"
                step="0.1"
                value={endSec}
                onChange={(e) => setEndSec(Number(e.target.value))}
              />
            </div>
          </div>
          <div className="studio-field">
            <label>Duration (s)</label>
            <input
              type="number"
              step="0.1"
              value={durationSec}
              onChange={(e) => setDurationSec(Number(e.target.value))}
            />
          </div>
          <div className="studio-actions-grid">
            {[
              { id: "repaint", label: "Repaint / Inpaint" },
              { id: "add_layer", label: "Add Layer" },
              { id: "replace_section", label: "Replace Section" },
              { id: "extend", label: "Extend / Continue" },
              { id: "cover", label: "Cover" },
              { id: "vocal2bgm", label: "Vocal to BGM" },
              { id: "stem_extract_uvr", label: "UVR Multi-Stem (Fast)" },
              { id: "stem_extract", label: "Stem Extract (Instrumental)" },
              { id: "understand", label: "Analyze (BPM/Key)" },
              { id: "lrc", label: "Generate LRC" },
              { id: "quality_score", label: "Quality Score" },
            ].map((action) => (
              <button
                key={action.id}
                className="studio-btn accent"
                onClick={() =>
                  onStartAiJob(action.id, {
                    prompt,
                    startSec,
                    endSec,
                    durationSec,
                  })
                }
              >
                {action.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {tab === "voice_midi" && (
        <VoiceToMidiPanel
          lanes={lanes}
          project={project}
          transport={transport}
          selection={selection}
          actions={studioActions}
          onRefreshProject={onRefreshProject}
        />
      )}

      {tab === "fx" && (
        <div className="studio-panel-content">
          {!selectedLane ? (
            <div className="studio-empty">Select a lane to apply effects.</div>
          ) : (
            <>
              <div className="studio-meta-block">
                <div className="studio-panel-title">Pitch Shift</div>
                <div className="studio-field">
                  <label>Semitones ({selectedLane.fx?.pitch?.semitones ?? 0})</label>
                  <input
                    type="range"
                    min="-12"
                    max="12"
                    step="1"
                    value={selectedLane.fx?.pitch?.semitones ?? 0}
                    onChange={(e) => {
                      const current = selectedLane.fx?.pitch || {};
                      onUpdateLane?.(selectedLane.id, {
                        fx: {
                          ...(selectedLane.fx || {}),
                          pitch: { ...current, semitones: Number(e.target.value) },
                        },
                      });
                    }}
                  />
                </div>
              </div>

              <div className="studio-meta-block">
                <div className="studio-panel-title">Echo</div>
                <label className="studio-toggle">
                  <input
                    type="checkbox"
                    checked={!!selectedLane.fx?.echo?.enabled}
                    onChange={(e) => {
                      const current = selectedLane.fx?.echo || {};
                      onUpdateLane?.(selectedLane.id, {
                        fx: {
                          ...(selectedLane.fx || {}),
                          echo: { ...current, enabled: e.target.checked },
                        },
                      });
                    }}
                  />
                  Enable Echo
                </label>
                <div className="studio-field">
                  <label>Delay Time</label>
                  <input
                    type="range"
                    min="0.05"
                    max="1.5"
                    step="0.01"
                    value={selectedLane.fx?.echo?.time ?? 0.25}
                    onChange={(e) => {
                      const current = selectedLane.fx?.echo || {};
                      onUpdateLane?.(selectedLane.id, {
                        fx: {
                          ...(selectedLane.fx || {}),
                          echo: { ...current, time: Number(e.target.value) },
                        },
                      });
                    }}
                  />
                </div>
                <div className="studio-field">
                  <label>Feedback</label>
                  <input
                    type="range"
                    min="0"
                    max="0.85"
                    step="0.01"
                    value={selectedLane.fx?.echo?.feedback ?? 0.3}
                    onChange={(e) => {
                      const current = selectedLane.fx?.echo || {};
                      onUpdateLane?.(selectedLane.id, {
                        fx: {
                          ...(selectedLane.fx || {}),
                          echo: { ...current, feedback: Number(e.target.value) },
                        },
                      });
                    }}
                  />
                </div>
                <div className="studio-field">
                  <label>Mix</label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={selectedLane.fx?.echo?.mix ?? 0.25}
                    onChange={(e) => {
                      const current = selectedLane.fx?.echo || {};
                      onUpdateLane?.(selectedLane.id, {
                        fx: {
                          ...(selectedLane.fx || {}),
                          echo: { ...current, mix: Number(e.target.value) },
                        },
                      });
                    }}
                  />
                </div>
              </div>

              <div className="studio-meta-block">
                <div className="studio-panel-title">Reverb</div>
                <label className="studio-toggle">
                  <input
                    type="checkbox"
                    checked={!!selectedLane.fx?.reverb?.enabled}
                    onChange={(e) => {
                      const current = selectedLane.fx?.reverb || {};
                      onUpdateLane?.(selectedLane.id, {
                        fx: {
                          ...(selectedLane.fx || {}),
                          reverb: { ...current, enabled: e.target.checked },
                        },
                      });
                    }}
                  />
                  Enable Reverb
                </label>
                <div className="studio-field">
                  <label>Decay</label>
                  <input
                    type="range"
                    min="0.5"
                    max="8"
                    step="0.1"
                    value={selectedLane.fx?.reverb?.decay ?? 2.5}
                    onChange={(e) => {
                      const current = selectedLane.fx?.reverb || {};
                      onUpdateLane?.(selectedLane.id, {
                        fx: {
                          ...(selectedLane.fx || {}),
                          reverb: { ...current, decay: Number(e.target.value) },
                        },
                      });
                    }}
                  />
                </div>
                <div className="studio-field">
                  <label>Mix</label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={selectedLane.fx?.reverb?.mix ?? 0.25}
                    onChange={(e) => {
                      const current = selectedLane.fx?.reverb || {};
                      onUpdateLane?.(selectedLane.id, {
                        fx: {
                          ...(selectedLane.fx || {}),
                          reverb: { ...current, mix: Number(e.target.value) },
                        },
                      });
                    }}
                  />
                </div>
              </div>

              <div className="studio-meta-block">
                <div className="studio-panel-title">Distortion</div>
                <label className="studio-toggle">
                  <input
                    type="checkbox"
                    checked={!!selectedLane.fx?.distortion?.enabled}
                    onChange={(e) => {
                      const current = selectedLane.fx?.distortion || {};
                      onUpdateLane?.(selectedLane.id, {
                        fx: {
                          ...(selectedLane.fx || {}),
                          distortion: { ...current, enabled: e.target.checked },
                        },
                      });
                    }}
                  />
                  Enable Distortion
                </label>
                <div className="studio-field">
                  <label>Drive</label>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    value={selectedLane.fx?.distortion?.drive ?? 20}
                    onChange={(e) => {
                      const current = selectedLane.fx?.distortion || {};
                      onUpdateLane?.(selectedLane.id, {
                        fx: {
                          ...(selectedLane.fx || {}),
                          distortion: { ...current, drive: Number(e.target.value) },
                        },
                      });
                    }}
                  />
                </div>
              </div>

              <div className="studio-meta-block">
                <div className="studio-panel-title">Chorus</div>
                <label className="studio-toggle">
                  <input
                    type="checkbox"
                    checked={!!selectedLane.fx?.chorus?.enabled}
                    onChange={(e) => {
                      const current = selectedLane.fx?.chorus || {};
                      onUpdateLane?.(selectedLane.id, {
                        fx: {
                          ...(selectedLane.fx || {}),
                          chorus: { ...current, enabled: e.target.checked },
                        },
                      });
                    }}
                  />
                  Enable Chorus
                </label>
                <div className="studio-field">
                  <label>Rate</label>
                  <input
                    type="range"
                    min="0.1"
                    max="5"
                    step="0.1"
                    value={selectedLane.fx?.chorus?.rate ?? 0.8}
                    onChange={(e) => {
                      const current = selectedLane.fx?.chorus || {};
                      onUpdateLane?.(selectedLane.id, {
                        fx: {
                          ...(selectedLane.fx || {}),
                          chorus: { ...current, rate: Number(e.target.value) },
                        },
                      });
                    }}
                  />
                </div>
                <div className="studio-field">
                  <label>Depth</label>
                  <input
                    type="range"
                    min="0"
                    max="0.03"
                    step="0.001"
                    value={selectedLane.fx?.chorus?.depth ?? 0.012}
                    onChange={(e) => {
                      const current = selectedLane.fx?.chorus || {};
                      onUpdateLane?.(selectedLane.id, {
                        fx: {
                          ...(selectedLane.fx || {}),
                          chorus: { ...current, depth: Number(e.target.value) },
                        },
                      });
                    }}
                  />
                </div>
                <div className="studio-field">
                  <label>Mix</label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={selectedLane.fx?.chorus?.mix ?? 0.3}
                    onChange={(e) => {
                      const current = selectedLane.fx?.chorus || {};
                      onUpdateLane?.(selectedLane.id, {
                        fx: {
                          ...(selectedLane.fx || {}),
                          chorus: { ...current, mix: Number(e.target.value) },
                        },
                      });
                    }}
                  />
                </div>
              </div>

              <div className="studio-meta-block">
                <div className="studio-panel-title">Filter</div>
                <label className="studio-toggle">
                  <input
                    type="checkbox"
                    checked={!!selectedLane.fx?.lowpass?.enabled}
                    onChange={(e) => {
                      const current = selectedLane.fx?.lowpass || {};
                      onUpdateLane?.(selectedLane.id, {
                        fx: {
                          ...(selectedLane.fx || {}),
                          lowpass: { ...current, enabled: e.target.checked },
                        },
                      });
                    }}
                  />
                  Low-pass Filter
                </label>
                <div className="studio-field">
                  <label>Cutoff (Hz)</label>
                  <input
                    type="range"
                    min="200"
                    max="20000"
                    step="10"
                    value={selectedLane.fx?.lowpass?.cutoff ?? 12000}
                    onChange={(e) => {
                      const current = selectedLane.fx?.lowpass || {};
                      onUpdateLane?.(selectedLane.id, {
                        fx: {
                          ...(selectedLane.fx || {}),
                          lowpass: { ...current, cutoff: Number(e.target.value) },
                        },
                      });
                    }}
                  />
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {tab === "meta" && (
        <div className="studio-panel-content">
          <div className="studio-meta-block">
            <div>BPM: {metadata?.understand?.bpm ?? "N/A"}</div>
            <div>Key: {metadata?.understand?.key ?? "N/A"}</div>
            <div>Time Signature: {metadata?.understand?.timeSignature ?? "N/A"}</div>
            <div>Caption: {metadata?.understand?.caption ?? "N/A"}</div>
          </div>
          <div className="studio-meta-block">
            <div>LRC Segments: {metadata?.lrc?.segments?.length ?? 0}</div>
            <div>Quality Score: {metadata?.quality_score?.score ?? "N/A"}</div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Inspector;
