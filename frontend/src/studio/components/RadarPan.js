import React, { useRef, useCallback } from "react";

/**
 * A half-circle "radar sweep" pan control — a plain L/R slider reads as two
 * abstract endpoints, but pan is inherently an angle (hard left through
 * centre to hard right), and a sweep from a fixed pivot is what a stereo
 * field actually looks like on a radar/level-meter display.
 */
const RadarPan = ({ value = 0, onChange, size = 60 }) => {
  const svgRef = useRef(null);
  const radius = size / 2 - 5;
  const cx = size / 2;
  const cy = size / 2 + 1;
  const height = size / 2 + 10;

  const clampedValue = Math.max(-1, Math.min(1, Number(value) || 0));
  // -1 (hard left) sits at the left end of the arc, +1 (hard right) at the
  // right end, 0 straight up — angle measured from the positive x-axis.
  const angle = Math.PI - ((clampedValue + 1) / 2) * Math.PI;
  const dotX = cx + radius * Math.cos(angle);
  const dotY = cy - radius * Math.sin(angle);

  const valueFromPointer = useCallback(
    (clientX, clientY) => {
      const rect = svgRef.current.getBoundingClientRect();
      const x = clientX - rect.left - cx;
      const y = cy - (clientY - rect.top);
      const clampedY = Math.max(0, y);
      const rawAngle = Math.atan2(clampedY, x);
      const boundedAngle = Math.max(0, Math.min(Math.PI, rawAngle));
      return Math.max(-1, Math.min(1, 1 - (boundedAngle / Math.PI) * 2));
    },
    [cx, cy]
  );

  const handlePointerDown = (event) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    onChange(valueFromPointer(event.clientX, event.clientY));
  };

  const handlePointerMove = (event) => {
    if (event.buttons !== 1) return;
    onChange(valueFromPointer(event.clientX, event.clientY));
  };

  const leftX = cx - radius;
  const rightX = cx + radius;

  return (
    <svg
      ref={svgRef}
      className="studio-radar-pan"
      width={size}
      height={height}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onDoubleClick={() => onChange(0)}
      role="slider"
      aria-label="Master pan"
      aria-valuemin={-1}
      aria-valuemax={1}
      aria-valuenow={Number(clampedValue.toFixed(2))}
    >
      <path
        className="studio-radar-pan-arc"
        d={`M ${leftX} ${cy} A ${radius} ${radius} 0 0 1 ${rightX} ${cy}`}
        fill="none"
      />
      <line className="studio-radar-pan-sweep" x1={cx} y1={cy} x2={dotX} y2={dotY} />
      <circle className="studio-radar-pan-pivot" cx={cx} cy={cy} r="1.6" />
      <circle className="studio-radar-pan-dot" cx={dotX} cy={dotY} r="3.2" />
    </svg>
  );
};

export default RadarPan;
