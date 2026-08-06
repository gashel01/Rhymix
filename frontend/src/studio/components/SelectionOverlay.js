import React from "react";

import { LANE_HEIGHT } from "../timelineMetrics";

const SelectionOverlay = ({ range, pxPerSec, lanes = [], laneIds = null }) => {
  if (!range) return null;
  const left = Math.min(range.start, range.end) * pxPerSec;
  const width = Math.abs(range.end - range.start) * pxPerSec;
  let top = 0;
  let height = lanes.length * LANE_HEIGHT;
  if (Array.isArray(laneIds) && laneIds.length) {
    const indices = laneIds
      .map((id) => lanes.findIndex((lane) => lane.id === id))
      .filter((idx) => idx >= 0);
    if (indices.length) {
      const minIndex = Math.min(...indices);
      const maxIndex = Math.max(...indices);
      top = minIndex * LANE_HEIGHT;
      height = (maxIndex - minIndex + 1) * LANE_HEIGHT;
    }
  }
  return <div className="studio-selection" style={{ left, width, top, height }} />;
};

export default SelectionOverlay;
