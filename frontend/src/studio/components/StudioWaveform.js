import React from "react";
import AudioWaveform from "../../components/AudioWaveform";

const hexToRgba = (hex, alpha) => {
  if (!hex || typeof hex !== "string") return null;
  const trimmed = hex.replace("#", "").trim();
  if (trimmed.length !== 3 && trimmed.length !== 6) return null;
  const full =
    trimmed.length === 3
      ? trimmed
          .split("")
          .map((c) => c + c)
          .join("")
      : trimmed;
  const intVal = Number.parseInt(full, 16);
  if (Number.isNaN(intVal)) return null;
  const r = (intVal >> 16) & 255;
  const g = (intVal >> 8) & 255;
  const b = intVal & 255;
  const a = Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 1;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
};

const StudioWaveform = ({
  url,
  height = 64,
  color = "#00c2ff",
  clipStartSec = 0,
  pixelsPerSecond,
}) => {
  const waveColor = hexToRgba(color, 0.45) || "rgba(255,255,255,0.5)";
  return (
    <div className="studio-waveform">
      <AudioWaveform
        url={url}
        isPlaying={false}
        onDownload={() => {}}
        height={height}
        progressColor={color}
        waveColor={waveColor}
        onSeek={() => {}}
        interactive={false}
        showControls={false}
        pixelsPerSecond={pixelsPerSecond}
        clipStartSec={clipStartSec}
      />
    </div>
  );
};

export default StudioWaveform;
