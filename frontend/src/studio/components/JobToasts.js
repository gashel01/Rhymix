import React from "react";

const JOB_LABELS = {
  understand: "Analyze",
  orchestrate_song: "AI Orchestrator",
  foundation_generate: "Foundation Generate",
  foundation_restyle: "Foundation Restyle",
  foundation_extend: "Foundation Extend",
  stage_drums_generate: "STAGE Drums",
  stem_extract: "Stem Extract",
  stem_extract_uvr: "UVR Stems",
  render: "Export",
  render_stems: "Export Stems",
  repaint: "Regenerate",
  replace_section: "Replace Section",
  extend: "Extend",
  cover: "Cover",
  vocal2bgm: "Vocals → Backing",
  lrc: "Lyrics Timing",
  quality_score: "Quality Score",
};

const TERMINAL = new Set(["completed", "failed", "cancelled"]);

const JobToasts = ({ jobs, onDismiss, onCancel }) => {
  if (!jobs.length) return null;
  return (
    <div className="studio-job-toasts">
      {jobs.map((job) => (
        <div key={job.id} className={`studio-job-toast ${job.status}`}>
          <div className="studio-job-copy">
            <strong>{JOB_LABELS[job.type] || job.type}</strong>
            <div>{job.statusMessage || job.error || job.status}</div>
            <div className="studio-progress">
              <div className="studio-progress-bar" style={{ width: `${Math.max(0, Math.min(100, job.progress ?? 0))}%` }} />
            </div>
          </div>
          <div className="studio-job-progress">
            <span>{job.progress ?? 0}%</span>
            {/* A running job holds the GPU; dismissing the toast only hides it,
                so offer the way to actually stop the work. */}
            {!TERMINAL.has(job.status) && onCancel ? (
              <button className="studio-mini danger" onClick={() => onCancel(job.id)}>
                Cancel
              </button>
            ) : null}
            <button className="studio-mini" onClick={() => onDismiss(job.id)}>
              Dismiss
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};

export default JobToasts;
