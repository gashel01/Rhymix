import { useState, useRef, useCallback, useEffect, useMemo } from "react";


export const useAudioPlayback = ({ results, vocalMode }) => {


    
  const trackPairCacheRef = useRef(new Map());
    const basename = useCallback(
        (p) => {
          const s = p;
          // supports windows + unix paths
          if (!s) return "";
          return s.split("/").pop()?.split("\\").pop() || "";
        },
        []
      );
    
    
  const getTrackName = useCallback(
    (track) => {
      const inst = track?.instrumental;
      const voc = track?.vocal;

      const instName = inst ? basename(inst) : "";
      const vocName = voc ? basename(voc) : "";

      const cleanedInst = instName.replace("_instrumental.wav", "");
      const cleanedVoc = vocName.replace("_vocals.wav", "");

      return cleanedInst || cleanedVoc || instName || vocName || "Unknown";
    },
    [basename]
  );
  
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
      
            const instrumental = r?.track?.instrumental;
            const instrumentalUrl = r?.track?.instrumentalUrl || undefined;
      
            const originalVocalFile = basename(r?.track?.vocal);
            const originalVocalUrl = r?.track?.vocalUrl || undefined;
      
            const outputFileName = basename(r?.outputFile);
            const convertedVocalUrl = outputFileName
              ? `/api/download/inference/${encodeURIComponent(outputFileName)}`
              : undefined;
      
            const isOriginal = vocalMode === "original";
      
            const next = {
              id,
              name,
              instrumental,
              instrumentalUrl,
              vocal: isOriginal ? originalVocalFile : outputFileName,
              vocalUrl: isOriginal ? originalVocalUrl : convertedVocalUrl,
              status: r?.status || "unknown",
              result: r,
              originalVocalUrl,
              convertedVocalUrl,
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
      }, [results, vocalMode, basename, getTrackName]);

   

  return {
    inferenceTrackPairs,
    getTrackName,
    basename,

  };
  
};
