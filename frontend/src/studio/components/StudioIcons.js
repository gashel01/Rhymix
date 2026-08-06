import React from "react";

/**
 * Studio icon set.
 *
 * The Studio had no icons at all: every control was a word in a bordered
 * rectangle, so Snap, Metronome, Loop, Undo, Redo, Play and Stop all carried
 * the same visual weight and the eye had to read the toolbar to use it.
 *
 * These are drawn rather than pulled from @mui/icons-material (which the rest
 * of the app uses) because Material's optical style — filled, 24px grid, heavy
 * terminals — reads as Android next to the Apple-leaning surfaces here. They
 * follow SF Symbols' habits instead: 1.6px strokes, round caps and joins, a
 * 24-unit box, and `currentColor` so a button's own colour drives them.
 */
const Svg = ({ children, size = 18, filled = false, ...rest }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill={filled ? "currentColor" : "none"}
    stroke={filled ? "none" : "currentColor"}
    strokeWidth={1.6}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
    {...rest}
  >
    {children}
  </svg>
);

export const PlayIcon = (props) => (
  <Svg filled {...props}>
    <path d="M8 5.5v13a1 1 0 0 0 1.53.85l10-6.5a1 1 0 0 0 0-1.7l-10-6.5A1 1 0 0 0 8 5.5Z" />
  </Svg>
);

export const PauseIcon = (props) => (
  <Svg filled {...props}>
    <rect x="7" y="5" width="3.6" height="14" rx="1.4" />
    <rect x="13.4" y="5" width="3.6" height="14" rx="1.4" />
  </Svg>
);

export const StopIcon = (props) => (
  <Svg filled {...props}>
    <rect x="6.5" y="6.5" width="11" height="11" rx="2.4" />
  </Svg>
);

export const UndoIcon = (props) => (
  <Svg {...props}>
    <path d="M4 9h11a5 5 0 0 1 0 10h-4" />
    <path d="M7.5 5.5 4 9l3.5 3.5" />
  </Svg>
);

export const RedoIcon = (props) => (
  <Svg {...props}>
    <path d="M20 9H9a5 5 0 0 0 0 10h4" />
    <path d="M16.5 5.5 20 9l-3.5 3.5" />
  </Svg>
);

export const ExportIcon = (props) => (
  <Svg {...props}>
    <path d="M12 3v11" />
    <path d="M8.5 10.5 12 14l3.5-3.5" />
    <path d="M4.5 16v2.5A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5V16" />
  </Svg>
);

export const MagnetIcon = (props) => (
  <Svg {...props}>
    <path d="M6 4v8a6 6 0 0 0 12 0V4" />
    <path d="M6 9.5h4.5" />
    <path d="M13.5 9.5H18" />
  </Svg>
);

export const MetronomeIcon = (props) => (
  <Svg {...props}>
    <path d="M10 3.5h4l4.5 17h-13Z" />
    <path d="M16 10 8.5 17" />
  </Svg>
);

export const LoopIcon = (props) => (
  <Svg {...props}>
    <path d="M4 9.5A3.5 3.5 0 0 1 7.5 6H18" />
    <path d="M15 3.2 18 6l-3 2.8" />
    <path d="M20 14.5a3.5 3.5 0 0 1-3.5 3.5H6" />
    <path d="M9 15.2 6 18l3 2.8" />
  </Svg>
);

export const PlusIcon = (props) => (
  <Svg {...props}>
    <path d="M12 5.5v13" />
    <path d="M5.5 12h13" />
  </Svg>
);

export const ChevronDownIcon = (props) => (
  <Svg {...props}>
    <path d="M6.5 9.5 12 15l5.5-5.5" />
  </Svg>
);

export const ChevronLeftIcon = (props) => (
  <Svg {...props}>
    <path d="M14.5 5.5 8 12l6.5 6.5" />
  </Svg>
);

export const SearchIcon = (props) => (
  <Svg {...props}>
    <circle cx="11" cy="11" r="6" />
    <path d="M15.5 15.5 20 20" />
  </Svg>
);

export const SparklesIcon = (props) => (
  <Svg {...props}>
    <path d="M12 3.5 13.7 9l5.5 1.7-5.5 1.7L12 18l-1.7-5.6L4.8 10.7 10.3 9Z" />
    <path d="M18.5 4v3" />
    <path d="M20 5.5h-3" />
  </Svg>
);

export const FocusIcon = (props) => (
  <Svg {...props}>
    <path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9" />
    <path d="M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9" />
    <path d="M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15" />
    <path d="M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15" />
  </Svg>
);

export const FitIcon = (props) => (
  <Svg {...props}>
    <path d="M9 4.5H4.5V9" />
    <path d="M15 4.5h4.5V9" />
    <path d="M15 19.5h4.5V15" />
    <path d="M9 19.5H4.5V15" />
  </Svg>
);

export const TrashIcon = (props) => (
  <Svg {...props}>
    <path d="M4.5 6.5h15" />
    <path d="M9.5 6.5V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v1.5" />
    <path d="M6.5 6.5 7.4 19a1.5 1.5 0 0 0 1.5 1.4h6.2a1.5 1.5 0 0 0 1.5-1.4l.9-12.5" />
  </Svg>
);

export const MicIcon = (props) => (
  <Svg {...props}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" />
    <path d="M12 18v3" />
  </Svg>
);
