import React, { useState, useEffect, useRef } from "react";

// This component shows a smoothly incrementing progress bar
// even when the actual progress updates are less frequent
const SmoothedProgress = ({ currentProgress, isComplete }) => {
  const [displayProgress, setDisplayProgress] = useState(0);
  const targetProgress = useRef(currentProgress || 0);
  const animationRef = useRef(null);

  // Update target when props change
  useEffect(() => {
    targetProgress.current = currentProgress || 0;
  }, [currentProgress]);

  // Smooth animation effect
  useEffect(() => {
    const animate = () => {
      // Calculate how much to increment
      if (displayProgress < targetProgress.current) {
        // Move 10% of the remaining distance per frame
        const increment = Math.max(
          0.5,
          (targetProgress.current - displayProgress) * 0.1
        );
        setDisplayProgress((prev) =>
          Math.min(prev + increment, targetProgress.current)
        );
        animationRef.current = requestAnimationFrame(animate);
      }
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [displayProgress]);

  return (
    <div className="progress-container">
      <div className="progress-bar" style={{ width: `${displayProgress}%` }}>
        <span>{Math.round(displayProgress)}%</span>
      </div>
    </div>
  );
};

export default SmoothedProgress;
