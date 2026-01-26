import { useEffect, useRef } from 'react';

/**
 * Hook to synchronize waveform playback between instrumental and vocal tracks
 * @param {Object} playingBoth - Current playing both state
 * @param {Object} instrumentalWaveforms - Map of instrumental waveforms
 * @param {Object} vocalWaveforms - Map of vocal waveforms
 * @param {Function} onStop - Callback when playback stops
 */
export const useWaveformSync = (
  playingBoth,
  instrumentalWaveforms,
  vocalWaveforms,
  onStop = null
) => {
  const checkIntervalRef = useRef(null);

  useEffect(() => {
    if (!playingBoth || !playingBoth.id) {
      if (checkIntervalRef.current) {
        clearInterval(checkIntervalRef.current);
        checkIntervalRef.current = null;
      }
      return;
    }

    const trackPairId = playingBoth.id;
    if (!trackPairId || typeof trackPairId !== 'string' || !trackPairId.includes('-')) {
      console.warn('useWaveformSync: Invalid trackPairId format:', trackPairId);
      return;
    }

    const [instrumentalId, vocalId] = trackPairId.split('-');

    const instrumentalWaveform = instrumentalWaveforms[instrumentalId];
    const vocalWaveform = vocalWaveforms[vocalId];

    // Setup polling interval to check if tracks have finished
    checkIntervalRef.current = setInterval(() => {
      if (!instrumentalWaveform && !vocalWaveform) return;

      let instrumentalTime = 0;
      let instrumentalDuration = 0;
      let vocalTime = 0;
      let vocalDuration = 0;

      if (instrumentalWaveform?.getCurrentTime && instrumentalWaveform?.getDuration) {
        instrumentalTime = instrumentalWaveform.getCurrentTime();
        instrumentalDuration = instrumentalWaveform.getDuration();
      }

      if (vocalWaveform?.getCurrentTime && vocalWaveform?.getDuration) {
        vocalTime = vocalWaveform.getCurrentTime();
        vocalDuration = vocalWaveform.getDuration();
      }

      // Check if either track has reached the end
      const instrumentalEnded =
        instrumentalDuration > 0 &&
        Math.abs(instrumentalTime - instrumentalDuration) < 0.5;
      const vocalEnded =
        vocalDuration > 0 && Math.abs(vocalTime - vocalDuration) < 0.5;

      if (instrumentalEnded || vocalEnded) {
        // Pause both waveforms
        if (instrumentalWaveform?.pause) {
          instrumentalWaveform.pause();
        }
        if (vocalWaveform?.pause) {
          vocalWaveform.pause();
        }

        // Call stop callback
        if (onStop) {
          onStop();
        }
      }
    }, 500); // Check every half second

    return () => {
      if (checkIntervalRef.current) {
        clearInterval(checkIntervalRef.current);
        checkIntervalRef.current = null;
      }
    };
  }, [playingBoth, instrumentalWaveforms, vocalWaveforms, onStop]);
};
