import React, { useRef, useState } from "react";
import styled from "styled-components";

const VisualizerContainer = styled.div`
  width: 100%;
  height: 120px;
  background-color: #f0f0f0;
  position: relative;
  border-radius: 8px;
  overflow: hidden;
  margin-bottom: 10px;
`;

const SegmentBar = styled.div`
  position: absolute;
  height: 100%;
  top: 0;
  border-right: ${(props) => (props.isEnd ? "1px solid #000" : "none")};
  background-color: ${(props) =>
    props.speaker === "Unknown" ? "#666666" : props.color};
  opacity: ${(props) => (props.isActive ? 0.9 : 0.6)};
  cursor: pointer;
  transition: opacity 0.2s;
  background-image: ${(props) =>
    props.speaker === "Unknown"
      ? "repeating-linear-gradient(45deg, #666666, #666666 10px, #555555 10px, #555555 20px)"
      : "none"};

  &:hover {
    opacity: 0.8;
  }
`;

const CurrentTimeIndicator = styled.div`
  position: absolute;
  height: 100%;
  width: 2px;
  background-color: #ff0000;
  top: 0;
  z-index: 10;
  pointer-events: none;
`;

const HoverTimeLabel = styled.div`
  position: absolute;
  background-color: rgba(0, 0, 0, 0.7);
  color: white;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 12px;
  bottom: 5px;
  transform: translateX(-50%);
  z-index: 20;
  pointer-events: none;
`;

const SegmentLabel = styled.div`
  position: absolute;
  font-size: 11px;
  top: 5px;
  left: 5px;
  color: ${(props) => (props.isUnknown ? "white" : "black")};
  text-shadow: ${(props) =>
    props.isUnknown ? "0px 0px 2px black" : "0px 0px 2px white"};
  pointer-events: none;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: calc(100% - 10px);
`;

const formatTime = (seconds) => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
};

const AudioVisualizer = ({
  segments,
  currentTime = 0,
  totalDuration,
  onSegmentClick,
  getSpeakerColor,
  getDisplayName,
}) => {
  const containerRef = useRef(null);
  const [mousePosition, setMousePosition] = useState(null);
  const [hoverTime, setHoverTime] = useState(null);

  const handleMouseMove = (e) => {
    if (!containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const relativeX = e.clientX - rect.left;
    setMousePosition(relativeX);

    // Convert position to time
    const hoverTimeValue = (relativeX / rect.width) * totalDuration;
    setHoverTime(hoverTimeValue);
  };

  const handleMouseLeave = () => {
    setMousePosition(null);
    setHoverTime(null);
  };

  return (
    <VisualizerContainer
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {segments &&
        segments.map((segment, idx) => {
          const width = ((segment.end - segment.start) / totalDuration) * 100;
          const left = (segment.start / totalDuration) * 100;
          const isActive =
            currentTime >= segment.start && currentTime <= segment.end;
          const isEnd = idx === segments.length - 1;
          const isUnknown = segment.speaker === "Unknown";
          const color = getSpeakerColor(segment.speaker);
          const displayName = isUnknown
            ? "No Speech"
            : getDisplayName(segment.speaker);

          return (
            <SegmentBar
              key={segment.id || `segment-${idx}`}
              style={{ width: `${width}%`, left: `${left}%` }}
              color={color}
              speaker={segment.speaker}
              isActive={isActive}
              isEnd={isEnd}
              onClick={() => onSegmentClick(segment)}
            >
              {width > 3 && (
                <SegmentLabel isUnknown={isUnknown}>{displayName}</SegmentLabel>
              )}
            </SegmentBar>
          );
        })}

      {/* Current time indicator */}
      <CurrentTimeIndicator
        style={{ left: `${(currentTime / totalDuration) * 100}%` }}
      />

      {/* Hover time indicator */}
      {mousePosition !== null && (
        <HoverTimeLabel style={{ left: mousePosition }}>
          {formatTime(hoverTime)}
        </HoverTimeLabel>
      )}
    </VisualizerContainer>
  );
};

export default AudioVisualizer;
