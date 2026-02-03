import { useMemo } from "react";
import { mergeProcessingUpdate } from "../../utils/processingStatus";

const normalizeProcessing = (processing) => {
  if (!processing) return null;
  const state = processing.state || "ready";
  return {
    state,
    step: processing.step || state,
    message: processing.message || null,
    progress: typeof processing.progress === "number" ? processing.progress : null,
    updatedAt: processing.updatedAt || null,
  };
};

const statusFromProcessing = (processing) => {
  if (!processing || processing.state === "ready") return "completed";
  if (processing.state === "error") return "failed";
  return "processing";
};

export const useAudioPlayback = ({ rawVocals, availableFiles, vocalMode, optimisticTracks = [] }) => {
  const serverTrackPairs = useMemo(() => {
    const raw = Array.isArray(rawVocals) ? rawVocals : [];
    const proc = Array.isArray(availableFiles) ? availableFiles : [];

    const rawById = new Map(raw.map((r) => [r.fileId || r.trackId, r]));
    const procById = new Map(proc.map((p) => [p.fileId || p.trackId, p]));
    const ids = new Set([...rawById.keys(), ...procById.keys()].filter(Boolean));

    return Array.from(ids).map((fileId, index) => {
      const rawItem = rawById.get(fileId);
      const procItem = procById.get(fileId);
      const base = procItem || rawItem || {};
      const processing = normalizeProcessing(base.processing);
      const displayName =
        base.displayName || base.safeDisplayName || base.originalName || `Track ${index + 1}`;
      const vocalUrl = vocalMode === "processed" ? procItem?.vocalUrl : rawItem?.vocalUrl;
      const vocalFileType = vocalMode === "processed" ? "processed_vocals" : "raw_vocals";

      return {
        id: fileId || `row-${index}`,
        fileId,
        trackId: base.trackId || fileId,
        displayName,
        originalName: base.originalName,
        vocalMode,
        isProcessed: vocalMode === "processed",
        vocalFileType,
        instrumental: fileId,
        vocal: fileId,
        instrumentalKey: `${fileId}-instrumental`,
        vocalKey: `${fileId}-vocal`,
        instrumentalUrl: base.instrumentalUrl || undefined,
        vocalUrl,
        instrumentalPath: base.instrumentalPath || null,
        vocalPath: vocalMode === "processed" ? procItem?.vocalPath : rawItem?.vocalPath,
        processing,
        status: statusFromProcessing(processing),
        createdAt: base.createdAt || null,
      };
    });
  }, [rawVocals, availableFiles, vocalMode]);

  const optimisticTrackPairs = useMemo(() => {
    const pending = Array.isArray(optimisticTracks) ? optimisticTracks : [];
    return pending.map((track, index) => {
      const fileId = track.trackId || track.fileId || null;
      const processing = normalizeProcessing(track.processing) || {
        state: "uploading",
        step: "upload",
        message: "Uploading...",
        progress: 0,
        updatedAt: track.createdAt || null,
      };
      const displayName = track.displayName || track.originalName || `Track ${index + 1}`;
      const rowId = fileId || track.tempId || `upload-${index}`;

      return {
        id: rowId,
        fileId,
        trackId: fileId || rowId,
        displayName,
        originalName: track.originalName,
        vocalMode,
        isProcessed: vocalMode === "processed",
        vocalFileType: vocalMode === "processed" ? "processed_vocals" : "raw_vocals",
        instrumental: fileId,
        vocal: fileId,
        instrumentalKey: `${rowId}-instrumental`,
        vocalKey: `${rowId}-vocal`,
        instrumentalUrl: null,
        vocalUrl: null,
        instrumentalPath: null,
        vocalPath: null,
        processing,
        status: statusFromProcessing(processing),
        createdAt: track.createdAt || null,
      };
    });
  }, [optimisticTracks, vocalMode]);

  const trackPairs = useMemo(() => {
    const serverById = new Map(serverTrackPairs.map((pair) => [pair.fileId, pair]));
    const merged = [];
    const seen = new Set();

    optimisticTrackPairs.forEach((opt) => {
      if (opt.fileId && serverById.has(opt.fileId)) {
        const server = serverById.get(opt.fileId);
        const mergedProcessing = mergeProcessingUpdate(
          server.processing || null,
          opt.processing || null
        );
        const mergedPair = {
          ...server,
          displayName: server.displayName || opt.displayName,
          originalName: server.originalName || opt.originalName,
          createdAt: server.createdAt || opt.createdAt,
          processing: mergedProcessing,
          status: statusFromProcessing(mergedProcessing),
        };
        merged.push(mergedPair);
        seen.add(opt.fileId);
        return;
      }
      merged.push(opt);
      if (opt.fileId) seen.add(opt.fileId);
    });

    serverTrackPairs.forEach((pair) => {
      if (pair.fileId && seen.has(pair.fileId)) return;
      merged.push(pair);
    });

    return merged.sort((a, b) => {
      const aTime = a?.createdAt ? Date.parse(a.createdAt) : 0;
      const bTime = b?.createdAt ? Date.parse(b.createdAt) : 0;
      return bTime - aTime;
    });
  }, [optimisticTrackPairs, serverTrackPairs]);

  return {
    trackPairs,
  };
};
