import { useState, useRef, useCallback, useEffect } from 'react';

/**
 * Hook to manage audio playback state
 * @returns {Object} - Playback state and handlers
 */
export const useAudioPlayback = () => {
  const [playingFile, setPlayingFile] = useState(null);
  const [playingBoth, setPlayingBoth] = useState(null);
  const [instrumentalWaveforms, setInstrumentalWaveforms] = useState({});
  const [vocalWaveforms, setVocalWaveforms] = useState({});
  const instrumentalAudioRef = useRef(null);
  const vocalAudioRef = useRef(null);
  const lastSyncTime = useRef(0);

  const handlePlayPause = useCallback((fileType, fileName) => {
    // If already playing this file, pause it
    if (playingFile && playingFile.name === fileName) {
      setPlayingFile(null);
      return;
    }

    // If playing something else, stop it
    if (playingFile) {
      setPlayingFile(null);
    }

    // Stop playing both if active
    if (playingBoth) {
      if (instrumentalAudioRef.current) instrumentalAudioRef.current.pause();
      if (vocalAudioRef.current) vocalAudioRef.current.pause();
      setPlayingBoth(null);
    }

    // Start playing the new file
    setPlayingFile({
      name: fileName,
      type: fileType,
    });
  }, [playingFile, playingBoth]);

  const handlePlayBoth = useCallback((instrumentalFile, vocalFile, vocalFileType) => {
    if (!instrumentalFile || !vocalFile) return;

    const pairId = `${instrumentalFile}-${vocalFile}`;
    const iWaveform = instrumentalWaveforms[instrumentalFile];
    const vWaveform = vocalWaveforms[vocalFile];

    // If already playing this pair, stop it
    if (playingBoth && playingBoth.id === pairId) {
      setPlayingBoth(null);
      return;
    }

    // If playing a single file, stop it
    if (playingFile) {
      setPlayingFile(null);
    }

    // If playing another pair, stop it
    if (playingBoth) {
      setPlayingBoth(null);
    }

    // Ensure waveforms are at the same position before playing
    if (iWaveform && vWaveform) {
      iWaveform.setCurrentTime(0);
      vWaveform.setCurrentTime(0);
    }

    // Start playing both
    setPlayingBoth({
      id: pairId,
      instrumental: instrumentalFile,
      vocal: vocalFile,
      vocalType: vocalFileType,
      instrumentalWaveform: iWaveform,
      vocalWaveform: vWaveform,
    });
  }, [playingFile, playingBoth, instrumentalWaveforms, vocalWaveforms]);

  const handleInstrumentalWaveformReady = useCallback((filename, waveform) => {
    setInstrumentalWaveforms((prev) => ({
      ...prev,
      [filename]: waveform,
    }));
  }, []);

  const handleVocalWaveformReady = useCallback((filename, waveform) => {
    setVocalWaveforms((prev) => ({
      ...prev,
      [filename]: waveform,
    }));
  }, []);

  const stopAllAudio = useCallback(() => {
    // Stop any currently playing file
    if (playingFile) {
      setPlayingFile(null);
    }

    // Stop playing both tracks if active
    if (playingBoth) {
      if (instrumentalAudioRef.current) instrumentalAudioRef.current.pause();
      if (vocalAudioRef.current) vocalAudioRef.current.pause();
      setPlayingBoth(null);
    }

    // Stop all waveform players
    Object.values(instrumentalWaveforms).forEach((waveform) => {
      if (waveform && typeof waveform.stop === 'function') {
        waveform.stop();
      }
    });

    Object.values(vocalWaveforms).forEach((waveform) => {
      if (waveform && typeof waveform.stop === 'function') {
        waveform.stop();
      }
    });
  }, [playingFile, playingBoth, instrumentalWaveforms, vocalWaveforms]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopAllAudio();
    };
  }, [stopAllAudio]);

  return {
    playingFile,
    playingBoth,
    instrumentalWaveforms,
    vocalWaveforms,
    instrumentalAudioRef,
    vocalAudioRef,
    lastSyncTime,
    handlePlayPause,
    handlePlayBoth,
    handleInstrumentalWaveformReady,
    handleVocalWaveformReady,
    stopAllAudio,
    setPlayingFile,
    setPlayingBoth,
  };
};
