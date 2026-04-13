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
};

const JobToasts = ({ jobs, onDismiss }) => {
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
