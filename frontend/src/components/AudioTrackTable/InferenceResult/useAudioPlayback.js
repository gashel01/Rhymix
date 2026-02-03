import { useRef, useCallback, useMemo } from "react";


export const useAudioPlayback = ({ results, vocalMode }) => {


    
  const trackPairCacheRef = useRef(new Map());
  const getTrackName = useCallback((track) => {
    return track?.displayName || track?.name || "Unknown";
  }, []);
  
    const inferenceTrackPairs = useMemo(() => {
        const stableIdFor = (r) => {
          // Prefer jobId because it exists immediately and doesn’t change during polling
          if (r?.jobId) return `job:${r.jobId}`;
      
          // fallback: track.id if it’s truly stable
          if (r?.track?.id) return `track:${r.track.id}`;
      
          // last resort: derive from paths (stable) — NEVER Math.random()
          const inst = r?.track?.instrumental;
          const voc = r?.track?.vocal;
          const out = r?.outputFile;
          return `path:${inst}|${voc}|${out}`;
        };
      
        const nextPairs = results
          .filter((r) => !!r?.track?.instrumental)
          .map((r) => {
            const id = stableIdFor(r);
            const name = getTrackName(r.track);
      
            const fileId = r?.track?.fileId || r?.track?.id;
            const instrumentalUrl = r?.track?.instrumentalUrl || (fileId ? `/api/download/instrumental/${fileId}` : undefined);
            const originalVocalUrl = r?.track?.vocalUrl || (fileId ? `/api/download/${vocalMode === "original" ? "raw_vocals" : "processed_vocals"}/${fileId}` : undefined);
            const convertedVocalUrl = r?.outputUrl || (r?.runId ? `/api/download/inference/${encodeURIComponent(r.runId)}` : undefined);
      
            const isOriginal = vocalMode === "original";
      
            const next = {
              id,
              name,
              displayName: name,
              fileId,
              instrumental: fileId,
              instrumentalUrl,
              vocal: fileId,
              vocalUrl: isOriginal ? originalVocalUrl : convertedVocalUrl,
              status: r?.status || "unknown",
              result: r,
              originalVocalUrl,
              convertedVocalUrl,
              instrumentalKey: `${id}-instrumental`,
              vocalKey: `${id}-vocal`,
            };
      
            const cached = trackPairCacheRef.current.get(id);
      
            // IMPORTANT: include name + instrumental too (they can change from "" -> real value)
            const same =
              cached &&
              cached.vocalUrl === next.vocalUrl &&
              cached.vocal === next.vocal &&
              cached.status === next.status &&
              cached.instrumentalUrl === next.instrumentalUrl &&
              cached.instrumental === next.instrumental &&
              cached.name === next.name;
      
            if (same) return cached;
      
            trackPairCacheRef.current.set(id, next);
            return next;
          });
      
        // Clean cache for removed rows
        const alive = new Set(nextPairs.map((p) => p.id));
        for (const key of trackPairCacheRef.current.keys()) {
          if (!alive.has(key)) trackPairCacheRef.current.delete(key);
        }
      
        return nextPairs;
      }, [results, vocalMode, getTrackName]);

   

  return {
    inferenceTrackPairs,
    getTrackName,
  };
  
};
