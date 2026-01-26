import { useState, useCallback } from 'react';

/**
 * Hook to manage vocal mode state (raw/processed)
 * @param {string} initialMode - Initial mode ('raw' or 'processed')
 * @returns {Object} - { vocalMode, setVocalMode, handleVocalModeChange, vocalsFileType }
 */
export const useVocalMode = (initialMode = 'processed') => {
  const [vocalMode, setVocalMode] = useState(initialMode);

  const handleVocalModeChange = useCallback((event, newMode) => {
    if (newMode !== null) {
      setVocalMode(newMode);
    }
  }, []);

  const vocalsFileType = vocalMode === 'processed' ? 'processed_vocals' : 'raw_vocals';

  return {
    vocalMode,
    setVocalMode,
    handleVocalModeChange,
    vocalsFileType,
  };
};
