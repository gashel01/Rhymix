import React, { createContext, useContext, useRef, useEffect } from 'react';

const VolumeContext = createContext({ volume: 1 });

export const VolumeProvider = ({ children, volume }) => {
  const volumeRef = useRef(volume);
  
  // Update ref when volume changes (doesn't cause re-renders)
  useEffect(() => {
    volumeRef.current = volume;
  }, [volume]);

  // Provide both ref and value - components can use ref to avoid re-renders
  const value = React.useMemo(() => ({
    volume,
    volumeRef,
    getVolume: () => volumeRef.current,
  }), [volume]);

  return (
    <VolumeContext.Provider value={value}>
      {children}
    </VolumeContext.Provider>
  );
};

export const useVolume = () => {
  const context = useContext(VolumeContext);
  if (!context) {
    // Fallback if not in provider
    return { volume: 1, volumeRef: { current: 1 }, getVolume: () => 1 };
  }
  return context;
};
