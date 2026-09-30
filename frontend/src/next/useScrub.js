import { useCallback, useRef } from "react";

/**
 * Turn an element into a scrubber.
 *
 * Returns props to spread onto whatever should be draggable — a waveform, a
 * progress bar. `onScrub(ratio)` fires on press and again on every move, so a
 * drag reads as a continuous seek rather than a jump at the end.
 *
 * Pointer capture is the point: without it, dragging past the edge of the
 * element silently stops updating, which feels like the scrubber let go of you.
 */
export default function useScrub(onScrub) {
  const draggingRef = useRef(false);

  const ratioFrom = (element, clientX) => {
    const rect = element.getBoundingClientRect();
    if (!rect.width) return 0;
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  };

  const onPointerDown = useCallback(
    (event) => {
      // Left button only, and never when the press landed on a real control
      // sitting on top of the scrubber.
      if (event.button !== 0) return;
      if (event.target.closest("button, a, input, select, textarea")) return;
      draggingRef.current = true;
      // Capture is what keeps a drag alive past the element's edge, but it
      // throws for a pointer id the browser does not know — and a failed
      // capture must not cost you the seek you already asked for.
      try {
        event.currentTarget.setPointerCapture?.(event.pointerId);
      } catch (captureFailed) {
        draggingRef.current = false;
      }
      onScrub(ratioFrom(event.currentTarget, event.clientX));
    },
    [onScrub]
  );

  const onPointerMove = useCallback(
    (event) => {
      if (!draggingRef.current) return;
      onScrub(ratioFrom(event.currentTarget, event.clientX));
    },
    [onScrub]
  );

  const stop = useCallback((event) => {
    draggingRef.current = false;
    try {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    } catch (releaseFailed) {
      // Never captured, nothing to release.
    }
  }, []);

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: stop,
    onPointerCancel: stop,
  };
}
