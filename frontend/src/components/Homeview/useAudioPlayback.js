import { useState, useRef, useCallback, useEffect, useMemo } from "react";


export const useAudioPlayback = ({ rawVocals, availableFiles, vocalMode }) => {
  
    const trackPairs = useMemo(() => {
        const getFile = (p) => (p || "").split("/").pop() || "";
        const norm = (s) => (s || "").toLowerCase();
    
        const raw = Array.isArray(rawVocals) ? rawVocals : [];
        const proc = Array.isArray(availableFiles) ? availableFiles : [];
    
        const procByInst = new Map(
          proc.map((p) => [norm(getFile(p.instrumentalPath)), p])
        );
    
        return raw.map((r, index) => {
          const instPath = r.instrumentalPath || "";
          const instFile = getFile(instPath);
          const match = procByInst.get(norm(instFile));
    
          const chosenVocalPath =
            vocalMode === "processed" ? match?.vocalPath : r.vocalPath;
          const vocalFile = getFile(chosenVocalPath);
    
          return {
            id: instFile || `row-${index}`,
            name: r.name || match?.name || instFile || `Track ${index + 1}`,
            instrumental: instFile,
            vocal: vocalFile,
            vocalMode,
            isProcessed: vocalMode === "processed",
            instrumentalUrl: instFile ? `/api/download/instrumental/${instFile}` : (r.instrumentalUrl || undefined),
            vocalUrl: vocalMode === "processed" ? match?.vocalUrl : r.vocalUrl,
          };
        });
      }, [rawVocals, availableFiles, vocalMode]);

   

  return {
    trackPairs,

  };
};
