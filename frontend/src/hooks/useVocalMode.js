import { useState, useCallback } from 'react';

/**
 * Hook to manage vocal mode state (raw/processed)
 * @param {string} initialMode - Initial mode ('raw' or 'processed')
 * @returns {Object} - { vocalMode, setVocalMode, handleVocalModeChange, vocalsFileType }
 */
export const useVocalMode = (initialMode = 'raw') => {
  const [vocalMode, setVocalMode] = useState(initialMode);

  const handleVocalModeChange = useCallback((event, newMode) => {
    if (newMode !== null) {
      setVocalMode(newMode);
    }
  }, []);

  const vocalsFileType = useCallback((vocalMode) => {
    switch (vocalMode) {
    case 'processed':
      return 'processed_vocals';
    case 'raw':
      return 'raw_vocals';
    case 'converted':
      return 'converted_vocals';
    case 'original':
      return 'original_vocals';
    default:
      return 'raw_vocals';
  }
}, []);

  return {
    vocalMode,
    setVocalMode,
    handleVocalModeChange,
    vocalsFileType,
  };
};
