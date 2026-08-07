import React, { useMemo, useRef } from "react";
import { transcribeStudioSelection } from "../api";
import { useStudioStore } from "../store";

export const useLyricsActions = ({ handleStartJob }) => {
  const { state, actions } = useStudioStore();
  const lyricsMap = state.metadata?.lyricsReplacement || {};
  const transcribeTokenRef = useRef(0);

  const buildSegmentsFromText = React.useCallback((text, startSec, endSec) => {
    const safeText = String(text || "").trim();
    if (!safeText) return [];
    const lines = safeText.split(/\n+/).map((line) => line.trim()).filter(Boolean);
    if (!lines.length) return [];
    const start = Number.isFinite(startSec) ? startSec : 0;
    const end = Number.isFinite(endSec) ? endSec : start;
    const duration = Math.max(0.01, end - start);
    const step = duration / lines.length;
    return lines.map((line, idx) => ({
      start: start + idx * step,
      end: start + (idx + 1) * step,
      text: line,
    }));
  }, []);

  const normalizeLyricsEntries = React.useCallback((raw) => {
    if (Array.isArray(raw)) return raw.filter(Boolean);
    if (raw && typeof raw === "object") return [raw];
    return [];
  }, []);

  const findLyricsEntryIndex = React.useCallback((entries, range, rangeClip = null) => {
    if (!Array.isArray(entries) || !entries.length) return -1;
    if (rangeClip && Number.isFinite(rangeClip.start) && Number.isFinite(rangeClip.end)) {
      const start = Number(rangeClip.start);
      const end = Number(rangeClip.end);
      return entries.findIndex((entry) => {
        if (!entry || !entry.rangeClip) return false;
        const entryStart = Number(entry.rangeClip.start ?? 0);
        const entryEnd = Number(entry.rangeClip.end ?? 0);
        return Math.abs(entryStart - start) < 0.05 && Math.abs(entryEnd - end) < 0.05;
      });
    }
    if (!range || !Number.isFinite(range.start) || !Number.isFinite(range.end)) return -1;
    const start = Number(range.start);
    const end = Number(range.end);
    return entries.findIndex((entry) => {
      if (!entry || !entry.range) return false;
      const entryStart = Number(entry.range.start ?? 0);
      const entryEnd = Number(entry.range.end ?? 0);
      return Math.abs(entryStart - start) < 0.05 && Math.abs(entryEnd - end) < 0.05;
    });
  }, []);

  const updateLyricsEntry = React.useCallback(
    (clipId, patch) => {
      if (!clipId) return;
      const currentMap = state.metadata?.lyricsReplacement || {};
      const entries = normalizeLyricsEntries(currentMap[clipId]);
      const range = patch?.range || patch?.sourceRange || null;
      const rangeClip = patch?.rangeClip || null;
      const idx = findLyricsEntryIndex(entries, range, rangeClip);
      let nextEntries = entries;
      if (idx >= 0) {
        nextEntries = entries.map((entry, index) =>
          index === idx ? { ...entry, ...patch } : entry
        );
      } else {
        nextEntries = [...entries, { ...patch }];
      }
      actions.updateMetadata({
        lyricsReplacement: {
          ...currentMap,
          [clipId]: nextEntries,
        },
      });
    },
    [actions, state.metadata, normalizeLyricsEntries, findLyricsEntryIndex]
  );

  const updateLyricsText = React.useCallback(
    (clipId, nextText, rangeOverride = null) => {
      if (!clipId) return;
      const currentMap = state.metadata?.lyricsReplacement || {};
      const entries = normalizeLyricsEntries(currentMap[clipId]);
      const payload = rangeOverride && typeof rangeOverride === "object" && ("range" in rangeOverride || "rangeClip" in rangeOverride)
        ? rangeOverride
        : { range: rangeOverride };
      const range = payload.range || entries[0]?.range;
      const rangeClip = payload.rangeClip || entries[0]?.rangeClip;
      const segments = range ? buildSegmentsFromText(nextText, range.start, range.end) : [];
      updateLyricsEntry(clipId, {
        text: nextText,
        segments,
        range,
        rangeClip,
        status: "ready",
        error: null,
      });
    },
    [buildSegmentsFromText, updateLyricsEntry, state.metadata, normalizeLyricsEntries]
  );

  const removeLyricsEntry = React.useCallback(
    (clipId, rangeOverride = null) => {
      if (!clipId) return;
      const currentMap = state.metadata?.lyricsReplacement || {};
      const entries = normalizeLyricsEntries(currentMap[clipId]);
      const payload =
        rangeOverride && typeof rangeOverride === "object" && ("range" in rangeOverride || "rangeClip" in rangeOverride)
          ? rangeOverride
          : { range: rangeOverride };
      const range = payload.range || entries[0]?.range;
      const rangeClip = payload.rangeClip || entries[0]?.rangeClip;
      const idx = findLyricsEntryIndex(entries, range, rangeClip);
      if (idx < 0) return;
      const nextEntries = entries.filter((_, index) => index !== idx);
      actions.updateMetadata({
        lyricsReplacement: {
          ...currentMap,
          [clipId]: nextEntries,
        },
      });
    },
    [actions, state.metadata, normalizeLyricsEntries, findLyricsEntryIndex]
  );

  const restoreLyricsEntry = React.useCallback(
    (clipId, rangeOverride = null) => {
      if (!clipId) return;
      const currentMap = state.metadata?.lyricsReplacement || {};
      const entries = normalizeLyricsEntries(currentMap[clipId]);
      const payload =
        rangeOverride && typeof rangeOverride === "object" && ("range" in rangeOverride || "rangeClip" in rangeOverride)
          ? rangeOverride
          : { range: rangeOverride };
      const range = payload.range || entries[0]?.range;
      const rangeClip = payload.rangeClip || entries[0]?.rangeClip;
      const idx = findLyricsEntryIndex(entries, range, rangeClip);
      if (idx < 0) return;
      const entry = entries[idx];
      if (!entry || entry.originalText == null) return;
      const originalText = String(entry.originalText || "").trim();
      const segments = range ? buildSegmentsFromText(originalText, range.start, range.end) : [];
      updateLyricsEntry(clipId, {
        text: originalText,
        segments,
        range,
        rangeClip,
        status: "ready",
        error: null,
      });
    },
    [buildSegmentsFromText, updateLyricsEntry, state.metadata, normalizeLyricsEntries, findLyricsEntryIndex]
  );

  const lyricsSelection = useMemo(() => {
    const range = state.selection?.range;
    if (!range) return null;
    const start = Math.min(range.start ?? 0, range.end ?? 0);
    const end = Math.max(range.start ?? 0, range.end ?? 0);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    if (end - start < 0.2) return null;

    const laneId = state.selection?.laneIds?.[0] || null;
    const lanes = state.lanes || [];
    const clips = state.clips || [];
    const assets = state.assets || {};
    const candidates = laneId ? clips.filter((clip) => clip.laneId === laneId) : clips;
    const hit = candidates.find((clip) => {
      if (clip.clipType === "midi") return false;
      const clipStart = clip.timelineStartSec ?? 0;
      const clipLen = Math.max(0.01, (clip.srcEndSec ?? 0) - (clip.srcStartSec ?? 0));
      const clipEnd = clipStart + clipLen;
      return end > clipStart && start < clipEnd;
    });
    if (!hit) return null;
    const lane = lanes.find((l) => l.id === hit.laneId);
    const asset = assets[hit.sourceAssetId];
    const isVocal = lane?.type === "vocal" || asset?.kind === "vocal";
    if (!isVocal) return null;
    return { clip: hit, lane, asset, range: { start, end } };
  }, [state.selection, state.lanes, state.clips, state.assets]);

  const selectionLyricsEntry = useMemo(() => {
    if (!lyricsSelection?.clip?.id) return null;
    const entries = normalizeLyricsEntries(lyricsMap[lyricsSelection.clip.id]);
    const range = lyricsSelection.range;
    const clipStart = lyricsSelection.clip.timelineStartSec ?? 0;
    const idx = entries.findIndex((entry) => {
      if (!entry) return false;
      if (entry.rangeClip && Number.isFinite(entry.rangeClip.start) && Number.isFinite(entry.rangeClip.end)) {
        const start = clipStart + Number(entry.rangeClip.start);
        const end = clipStart + Number(entry.rangeClip.end);
        return Math.abs(start - range.start) < 0.05 && Math.abs(end - range.end) < 0.05;
      }
      if (
        entry.clipStartAtTranscribe != null
        && entry.range
        && Number.isFinite(entry.range.start)
        && Number.isFinite(entry.range.end)
      ) {
        const offsetStart = Number(entry.range.start) - Number(entry.clipStartAtTranscribe);
        const offsetEnd = Number(entry.range.end) - Number(entry.clipStartAtTranscribe);
        const start = clipStart + offsetStart;
        const end = clipStart + offsetEnd;
        return Math.abs(start - range.start) < 0.05 && Math.abs(end - range.end) < 0.05;
      }
      if (entry.range && Number.isFinite(entry.range.start) && Number.isFinite(entry.range.end)) {
        return Math.abs(Number(entry.range.start) - range.start) < 0.05 && Math.abs(Number(entry.range.end) - range.end) < 0.05;
      }
      return false;
    });
    return idx >= 0 ? entries[idx] : null;
    // findLyricsEntryIndex is not called here — the search is inlined above.
  }, [lyricsSelection, lyricsMap, normalizeLyricsEntries]);

  const detectLyricsLanguage = React.useCallback((text) => {
    const sample = String(text || "");
    if (/[\u4e00-\u9fff]/.test(sample)) {
      return "Mandarin";
    }
    return "English";
  }, []);

  const handleTranscribeSelection = React.useCallback(async () => {
    if (!state.project?.id || !lyricsSelection) return;
    const { clip, range } = lyricsSelection;
    if (!clip?.sourceAssetId) return;

    const start = range.start;
    const end = range.end;
    const clipStart = clip.timelineStartSec ?? 0;
    const clipSrcStart = clip.srcStartSec ?? 0;
    const clipLen = Math.max(0.01, (clip.srcEndSec ?? 0) - (clip.srcStartSec ?? 0));
    const localStart = Math.max(0, Math.min(clipLen, start - clipStart));
    const localEnd = Math.max(localStart + 0.01, Math.min(clipLen, end - clipStart));
    const sourceStart = clipSrcStart + localStart;
    const sourceEnd = clipSrcStart + localEnd;

    updateLyricsEntry(clip.id, {
      status: "transcribing",
      range: { start, end },
      sourceRange: { start: sourceStart, end: sourceEnd },
      rangeClip: { start: localStart, end: localEnd },
      clipStartAtTranscribe: clipStart,
      error: null,
    });

    const token = (transcribeTokenRef.current += 1);
    try {
      const data = await transcribeStudioSelection(state.project.id, {
        assetId: clip.sourceAssetId,
        startSec: sourceStart,
        endSec: sourceEnd,
        engine: "whisperx",
      });
      if (token !== transcribeTokenRef.current) return;
      const text = String(data?.text || "").trim();
      const segments = buildSegmentsFromText(text, start, end);
      updateLyricsEntry(clip.id, {
        status: "ready",
        text,
        originalText: text,
        segments,
        range: { start, end },
        sourceRange: { start: sourceStart, end: sourceEnd },
        rangeClip: { start: localStart, end: localEnd },
        clipStartAtTranscribe: clipStart,
        error: null,
      });
    } catch (err) {
      if (token !== transcribeTokenRef.current) return;
      updateLyricsEntry(clip.id, {
        status: "error",
        error: err?.message || "Transcription failed",
        range: { start, end },
        sourceRange: { start: sourceStart, end: sourceEnd },
        rangeClip: { start: localStart, end: localEnd },
        clipStartAtTranscribe: clipStart,
      });
    }
  }, [
    state.project?.id,
    lyricsSelection,
    updateLyricsEntry,
    buildSegmentsFromText,
  ]);

  const handleResynthesizeSelection = React.useCallback(async (override = null) => {
    if (!state.project?.id) return;
    const overrideClip = override?.clip || null;
    const overrideRange = override?.range || null;
    const clip = overrideClip || lyricsSelection?.clip || null;
    const range = overrideRange || lyricsSelection?.range || null;
    if (!clip?.sourceAssetId || !range) return;
    const text = String(override?.text || selectionLyricsEntry?.text || "").trim();
    if (!text) return;
    const originalLyrics = String(
      override?.originalText || selectionLyricsEntry?.originalText || ""
    ).trim();
    const start = range.start;
    const end = range.end;
    const clipStart = clip.timelineStartSec ?? 0;
    const clipSrcStart = clip.srcStartSec ?? 0;
    const clipLen = Math.max(0.01, (clip.srcEndSec ?? 0) - (clip.srcStartSec ?? 0));
    const localStart = Math.max(0, Math.min(clipLen, start - clipStart));
    const localEnd = Math.max(localStart + 0.01, Math.min(clipLen, end - clipStart));
    const sourceStart = clipSrcStart + localStart;
    const sourceEnd = clipSrcStart + localEnd;

    await handleStartJob("resynthesize", {
      clipId: clip.id,
      sourceAssetId: clip.sourceAssetId,
      startSec: start,
      endSec: end,
      sourceStartSec: sourceStart,
      sourceEndSec: sourceEnd,
      lyrics: text,
      originalLyrics: originalLyrics || undefined,
      language: detectLyricsLanguage(text),
    });
  }, [state.project?.id, lyricsSelection, selectionLyricsEntry, handleStartJob, detectLyricsLanguage]);

  return {
    lyricsMap,
    lyricsSelection,
    selectionLyricsEntry,
    buildSegmentsFromText,
    updateLyricsText,
    removeLyricsEntry,
    restoreLyricsEntry,
    handleTranscribeSelection,
    handleResynthesizeSelection,
  };
};
