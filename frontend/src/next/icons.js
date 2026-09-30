import React from "react";

/**
 * Rail and toolbar icons.
 *
 * Inline SVG rather than an icon font or a package: there are nine of them,
 * they never change, and they inherit `currentColor` so the rail's active
 * state tints them without a second rule.
 */

const icon = (path, viewBox = "0 0 24 24") =>
  function Icon(props) {
    return (
      <svg viewBox={viewBox} width="17" height="17" fill="currentColor" aria-hidden="true" {...props}>
        {path}
      </svg>
    );
  };

export const LibraryIcon = icon(
  <path d="M4 4h3v16H4zm5 0h2.5v16H9zm5.4.6 2.9-.8 4.3 15.4-2.9.8z" />
);

export const CreateIcon = icon(
  <path d="M12 2.6l2.1 5.2 5.3.4-4 3.5 1.2 5.2L12 14.2 7.4 16.9l1.2-5.2-4-3.5 5.3-.4zM18.5 16l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z" />
);

export const VoiceIcon = icon(
  <path d="M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM6 11h1.8a4.2 4.2 0 0 0 8.4 0H18a6 6 0 0 1-5 5.9V20h2.5v1.6h-7V20H11v-3.1A6 6 0 0 1 6 11z" />
);

export const TrainIcon = icon(
  <path d="M3 17.5 9 11l3.6 3.6L20 6.4l1.4 1.5-8.8 9.8L9 14.1l-4.6 5zM3 20h18v1.8H3z" />
);

export const SpeakerIcon = icon(
  <path d="M8.5 3a3.4 3.4 0 1 1 0 6.8 3.4 3.4 0 0 1 0-6.8zm7.6 1.6a2.8 2.8 0 1 1 0 5.6 2.8 2.8 0 0 1 0-5.6zM8.5 11.6c3.1 0 5.6 1.6 5.6 3.6v3.9H2.9v-3.9c0-2 2.5-3.6 5.6-3.6zm7.6.4c2.7 0 5 1.4 5 3.1v3.5h-5.3v-3.4c0-1.2-.6-2.3-1.6-3.1a8 8 0 0 1 1.9-.1z" />
);

export const StudioIcon = icon(
  <path d="M3 4.5h18v2.2H3zm0 6.4h18v2.2H3zm0 6.4h18v2.2H3zM7.4 2.6h2.2v6H7.4zm6.8 6.4h2.2v6h-2.2zM5.2 15.4h2.2v6H5.2z" />
);

export const SettingsIcon = icon(
  <path d="M12 8.4a3.6 3.6 0 1 0 0 7.2 3.6 3.6 0 0 0 0-7.2zm8.6 3.6c0 .5 0 1-.1 1.5l2 1.5-2 3.4-2.3-1a8.5 8.5 0 0 1-2.6 1.5l-.3 2.5h-4l-.3-2.5a8.5 8.5 0 0 1-2.6-1.5l-2.3 1-2-3.4 2-1.5a9.6 9.6 0 0 1 0-3l-2-1.5 2-3.4 2.3 1A8.5 8.5 0 0 1 9 5.1l.3-2.5h4l.3 2.5c1 .3 1.8.8 2.6 1.5l2.3-1 2 3.4-2 1.5c.1.5.1 1 .1 1.5z" />
);

export const ScoreIcon = icon(
  <path d="M9 3h1.8v12.1a3.4 3.4 0 1 1-1.8-3V3zm2.8 0H21v1.8h-9.2zm0 4H21v1.8h-9.2zm0 4H18v1.8h-6.2z" />
);

export const SearchIcon = icon(
  <path d="M10.6 3a7.6 7.6 0 0 1 5.9 12.4l4.5 4.5-1.5 1.5-4.5-4.5A7.6 7.6 0 1 1 10.6 3zm0 2a5.6 5.6 0 1 0 0 11.2 5.6 5.6 0 0 0 0-11.2z" />
);

export const MoreIcon = icon(
  <path d="M5.2 9.8a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4zm6.8 0a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4zm6.8 0a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4z" />
);
