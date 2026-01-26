import React, { useState, useEffect, useRef } from "react";
import SmoothedProgress from "./SmoothedProgress";

const DiarizationProgress = ({ jobId }) => {
  const [status, setStatus] = useState({});
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  // Timer ID for cleanup
  const timerRef = useRef(null);
 
  console.log(`DiarizationProgress rendering with jobId: ${jobId}`);

  

  useEffect(() => {
    console.log(`DiarizationProgress useEffect called with jobId: ${jobId}`);
    const instanceId = Math.random().toString(36).substr(2, 9);
    console.log(`Instance ID: ${instanceId}`);

   
    // Clean up on unmount
    return () => {
      console.log(`DiarizationProgress with instance ${instanceId} unmounting`);
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [jobId]);

  if (loading) {
    return <div>Loading job status...</div>;
  }

  if (error) {
    return <div className="error">Error: {error}</div>;
  }

  // Format elapsed time nicely
  let elapsedTime = "";
  if (status.started_at) {
    const startTime = status.started_at * 1000; // convert to milliseconds
    const endTime = status.completed_at
      ? status.completed_at * 1000
      : Date.now();
    const elapsedSeconds = Math.floor((endTime - startTime) / 1000);

    if (elapsedSeconds < 60) {
      elapsedTime = `${elapsedSeconds} seconds`;
    } else {
      const minutes = Math.floor(elapsedSeconds / 60);
      const seconds = elapsedSeconds % 60;
      elapsedTime = `${minutes} min ${seconds} sec`;
    }
  }

  return (
    <div className="diarization-progress">
      <h3>Diarization Job: {status.status}</h3>

      <SmoothedProgress
        currentProgress={status.progress || 0}
        isComplete={status.status === "completed"}
      />

      <p className="status-message">
        {status.message || "Processing..."}
        {elapsedTime && ` (${elapsedTime})`}
      </p>

      {status.status === "completed" && (
        <div className="success-message">
          <p>Diarization completed! You can now download the results.</p>
          {status.speakers && (
            <div className="speakers-info">
              <h4>Detected Speakers:</h4>
              <ul>
                {Object.keys(status.speakers).map((speaker) => (
                  <li key={speaker}>
                    {speaker}: {status.speakers[speaker].count} segments,
                    {Math.round(status.speakers[speaker].duration)} seconds
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {status.status === "failed" && (
        <div className="error-message">
          <p>Diarization failed: {status.error || "Unknown error"}</p>
        </div>
      )}
    </div>
  );
};

export default DiarizationProgress;
