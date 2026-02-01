import { useState, useRef, useCallback, useEffect, useMemo } from "react";


export const useAudioPlayback = ({ rawVocals, availableFiles, vocalMode }) => {
  
    const trackPairs = useMemo(() => {
        const raw = Array.isArray(rawVocals) ? rawVocals : [];
        const proc = Array.isArray(availableFiles) ? availableFiles : [];

        const rawById = new Map(raw.map((r) => [r.fileId, r]));
        const procById = new Map(proc.map((p) => [p.fileId, p]));
        const ids = new Set([...rawById.keys(), ...procById.keys()]);

        return Array.from(ids).map((fileId, index) => {
          const rawItem = rawById.get(fileId);
          const procItem = procById.get(fileId);
          const base = procItem || rawItem;
          const displayName = base?.displayName || base?.safeDisplayName || base?.originalName || `Track ${index + 1}`;
          const vocalUrl = vocalMode === "processed" ? procItem?.vocalUrl : rawItem?.vocalUrl;
          const vocalFileType = vocalMode === "processed" ? "processed_vocals" : "raw_vocals";

          return {
            id: fileId || `row-${index}`,
            fileId,
            displayName,
            originalName: base?.originalName,
            vocalMode,
            isProcessed: vocalMode === "processed",
            vocalFileType,
            instrumental: fileId,
            vocal: fileId,
            instrumentalKey: `${fileId}-instrumental`,
            vocalKey: `${fileId}-vocal`,
            instrumentalUrl: base?.instrumentalUrl || undefined,
            vocalUrl,
            instrumentalPath: base?.instrumentalPath || null,
            vocalPath: vocalMode === "processed" ? procItem?.vocalPath : rawItem?.vocalPath,
          };
        });
      }, [rawVocals, availableFiles, vocalMode]);

   

  return {
    trackPairs,

  };
};
