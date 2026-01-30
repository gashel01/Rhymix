import { useState, useRef, useCallback, useEffect } from 'react';

/**
 * Hook to manage audio playback state (InferenceView-style: instrumental + raw vocals + processed vocals).
 * @returns {Object} - Playback state and handlers
 */
export const useAudioPlayback = () => {
  const [playingFile, setPlayingFile] = useState(null);
  const [playingBoth, setPlayingBoth] = useState(null);
  const [instrumentalWaveforms, setInstrumentalWaveforms] = useState({});
  const [rawVocalWaveforms, setRawVocalWaveforms] = useState({});
  const [processedVocalWaveforms, setProcessedVocalWaveforms] = useState({});
  const instrumentalAudioRef = useRef(null);
  const vocalAudioRef = useRef(null);
  const lastSyncTime = useRef(0);

  const getVocalWaveforms = useCallback((vocalType) => {
    return vocalType === 'processed_vocals' ? processedVocalWaveforms : rawVocalWaveforms;
  }, [processedVocalWaveforms, rawVocalWaveforms]);

  const handlePlayPause = useCallback((fileType, fileName) => {
    if (playingFile && playingFile.name === fileName) {
      setPlayingFile(null);
      return;
    }

    if (playingFile) setPlayingFile(null);
    if (playingBoth) {
      if (instrumentalAudioRef.current) instrumentalAudioRef.current.pause();
      if (vocalAudioRef.current) vocalAudioRef.current.pause();
      setPlayingBoth(null);
    }

    setPlayingFile({
      name: fileName,
      type: fileType,
    });
  }, [playingFile, playingBoth]);

  const handlePlayBoth = useCallback((instrumentalFile, vocalFile, vocalFileType) => {
    if (!instrumentalFile || !vocalFile) return;

    const pairId = `${instrumentalFile}-${vocalFile}`;
    const iWaveform = instrumentalWaveforms[instrumentalFile] || instrumentalWaveforms[instrumentalFile?.split?.('/')?.pop?.()];
    const vocalMap = vocalFileType === 'processed_vocals' ? processedVocalWaveforms : rawVocalWaveforms;
    const vWaveform = vocalMap[vocalFile] || vocalMap[vocalFile?.split?.('/')?.pop?.()];

    if (playingBoth && playingBoth.id === pairId) {
      setPlayingBoth(null);
      return;
    }

    if (playingFile) setPlayingFile(null);
    if (playingBoth) setPlayingBoth(null);

    if (iWaveform && vWaveform) {
      iWaveform.setCurrentTime?.(0);
      vWaveform.setCurrentTime?.(0);
    }

    setPlayingBoth({
      id: pairId,
      instrumental: instrumentalFile,
      vocal: vocalFile,
      vocalType: vocalFileType,
      instrumentalWaveform: iWaveform,
      vocalWaveform: vWaveform,
    });
  }, [playingFile, playingBoth, instrumentalWaveforms, rawVocalWaveforms, processedVocalWaveforms]);

  const handleInstrumentalWaveformReady = useCallback((filename, waveform) => {
    setInstrumentalWaveforms((prev) => ({
      ...prev,
      [filename]: waveform,
    }));
  }, []);

  const handleRawVocalWaveformReady = useCallback((filename, waveform) => {
    setRawVocalWaveforms((prev) => ({
      ...prev,
      [filename]: waveform,
    }));
  }, []);

  const handleProcessedVocalWaveformReady = useCallback((filename, waveform) => {
    setProcessedVocalWaveforms((prev) => ({
      ...prev,
      [filename]: waveform,
    }));
  }, []);

  const stopAllAudio = useCallback(() => {
    if (playingFile) setPlayingFile(null);
    if (playingBoth) {
      if (instrumentalAudioRef.current) instrumentalAudioRef.current.pause();
      if (vocalAudioRef.current) vocalAudioRef.current.pause();
      setPlayingBoth(null);
    }

    const pauseAll = (waveforms) => {
      Object.values(waveforms || {}).forEach((w) => {
        if (w?.pause) w.pause();
      });
    };
    pauseAll(instrumentalWaveforms);
    pauseAll(rawVocalWaveforms);
    pauseAll(processedVocalWaveforms);
  }, [playingFile, playingBoth, instrumentalWaveforms, rawVocalWaveforms, processedVocalWaveforms]);

  useEffect(() => {
    return () => { stopAllAudio(); };
  }, [stopAllAudio]);

  return {
    playingFile,
    playingBoth,
    instrumentalWaveforms,
    rawVocalWaveforms,
    processedVocalWaveforms,
    getVocalWaveforms,
    instrumentalAudioRef,
    vocalAudioRef,
    lastSyncTime,
    handlePlayPause,
    handlePlayBoth,
    handleInstrumentalWaveformReady,
    handleRawVocalWaveformReady,
    handleProcessedVocalWaveformReady,
    stopAllAudio,
    setPlayingFile,
    setPlayingBoth,
  };
};
