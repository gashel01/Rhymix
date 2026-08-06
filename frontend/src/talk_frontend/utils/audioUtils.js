// Speaker colors for consistent visual identity
export const speakerColors = [
  "#3f51b5",
  "#f44336",
  "#009688",
  "#ff9800",
  "#9c27b0",
  "#2196f3",
  "#ff5722",
  "#4caf50",
  "#ffeb3b",
  "#673ab7",
];

/**
 * Format seconds into a human-readable time string (MM:SS.mmm)
 * @param {number} seconds - The time in seconds
 * @returns {string} Formatted time string
 */
export function formatDuration(seconds) {
  if (!seconds || isNaN(seconds)) return "00:00.000";

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  const milliseconds = Math.floor((seconds % 1) * 1000);

  return `${minutes.toString().padStart(2, "0")}:${remainingSeconds
    .toString()
    .padStart(2, "0")}.${milliseconds.toString().padStart(3, "0")}`;
}

/**
 * Get a consistent color for a speaker
 * @param {string} speakerName - Name of the speaker
 * @param {number} index - Index of the speaker in the list
 * @returns {string} Color hex code
 */
export function getSpeakerColor(speakerName, index) {
  // Use a fixed gray for Unknown segments
  if (speakerName === "Unknown") {
    return "#666666";
  }

  // For other speakers, use the theme colors array
  return speakerColors[index % speakerColors.length];
}

/**
 * Calculate the percentage of time a speaker takes in the audio
 * @param {array} speakerSegments - Array of segments for a specific speaker
 * @param {number} totalDuration - Total duration of the audio in seconds
 * @returns {number} Percentage of time (0-100)
 */
export function calculateSpeakerPercentage(speakerSegments, totalDuration) {
  if (!speakerSegments?.length || !totalDuration) return 0;

  const speakerDuration = speakerSegments.reduce(
    (total, segment) => total + (segment.end - segment.start),
    0
  );

  return (speakerDuration / totalDuration) * 100;
}

/**
 * Extract unique speakers from timeline data
 * @param {array} timelineData - Array of timeline segments
 * @returns {array} Array of unique speaker names
 */
export function extractUniqueSpeakers(timelineData) {
  if (!timelineData?.length) return [];

  return [...new Set(timelineData.map((segment) => segment.speaker))].sort();
}
