import React from "react";

const JOB_LABELS = {
  stem_extract_uvr: "UVR Stems",
  render: "Export",
  render_stems: "Export Stems",
  airgen_regen: "AI Regen (drums)",
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
