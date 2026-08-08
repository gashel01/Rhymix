import { useEffect } from "react";
import { useStudioStore } from "../store";

export const useStudioKeyboardShortcuts = (playback) => {
  const { state, actions } = useStudioStore();

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.defaultPrevented) return;
      const tag = event.target?.tagName;
      if (tag && ["INPUT", "TEXTAREA", "SELECT"].includes(tag)) return;
      if (event.target?.isContentEditable) return;
      const key = event.key.toLowerCase();
      if (event.code === "Space") {
        if (state.ui.midiEditorOpen) return;
        event.preventDefault();
        if (state.transport.isPlaying) {
          playback.pause();
        } else {
          playback.play();
        }
        return;
      }
      if (key === "1") {
        actions.setUi({ showCreatePanel: !state.ui.showCreatePanel });
        return;
      }
      if (key === "2") {
        actions.setUi({ showLibraryPanel: !state.ui.showLibraryPanel });
        return;
      }
      if (key === "3") {
        actions.setUi({ showDetailsPanel: !state.ui.showDetailsPanel });
        return;
      }
      if (key === "escape") {
        actions.setSelection({ range: null, laneIds: null, clipIds: [] });
        return;
      }
      if (key === "s") {
        const clipId = state.selection?.clipIds?.[0];
        if (clipId) {
          actions.splitClip(clipId, state.transport.currentTime || 0);
        }
        return;
      }
      if (key === "d") {
        if (state.selection?.range) {
          actions.duplicateSelection(
            state.selection.range,
            state.selection.laneIds,
            state.selection.range.end
          );
          return;
        }
        if (state.selection?.clipIds?.length) {
          const selected = state.clips.filter((clip) => state.selection.clipIds.includes(clip.id));
          if (selected.length) {
            let start = Infinity;
            let end = 0;
            selected.forEach((clip) => {
              const clipStart = clip.timelineStartSec ?? 0;
              const clipEnd =
                (clip.timelineStartSec ?? 0) + (clip.srcEndSec ?? 0) - (clip.srcStartSec ?? 0);
              start = Math.min(start, clipStart);
              end = Math.max(end, clipEnd);
            });
            actions.duplicateSelection({ start, end }, null, end);
          }
          return;
        }
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        if (state.selection?.clipIds?.length) {
          actions.deleteSelection(null, null, state.selection.clipIds);
          return;
        }
        if (state.selection?.range) {
          actions.deleteSelection(state.selection.range, state.selection.laneIds, null);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    state.selection,
    state.transport.currentTime,
    state.transport.isPlaying,
    state.clips,
    state.ui.showCreatePanel,
    state.ui.showLibraryPanel,
    state.ui.showDetailsPanel,
    // Was missing while its three siblings were listed. The handler reads it
    // to stand down while the MIDI editor has focus, so without it the
    // listener bound before the editor opened still saw `false` — and Delete
    // went on deleting the timeline selection underneath the open editor.
    state.ui.midiEditorOpen,
    actions,
    playback,
  ]);
};
