import React from "react";

const JobToasts = ({ jobs, onDismiss }) => {
  if (!jobs.length) return null;
  return (
    <div className="studio-job-toasts">
      {jobs.map((job) => (
        <div key={job.id} className={`studio-job-toast ${job.status}`}>
          <div>
            <strong>{job.type}</strong>
            <div>{job.status}</div>
          </div>
          <div className="studio-job-progress">
            {job.progress ?? 0}%
            <button className="studio-mini" onClick={() => onDismiss(job.id)}>
              x
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};

export default JobToasts;
