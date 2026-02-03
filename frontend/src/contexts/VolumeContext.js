import React, { createContext, useContext, useRef, useEffect } from 'react';

const VolumeContext = createContext({ volume: 1 });

export const VolumeProvider = ({ children, volume }) => {
  const volumeRef = useRef(volume);
  
  // Update ref when volume changes (doesn't cause re-renders)
  useEffect(() => {
    volumeRef.current = volume;
  }, [volume]);

  // Stable value: only ref, so consumers don't re-render when volume changes
  const value = React.useMemo(() => ({
    volumeRef,
    getVolume: () => volumeRef.current,
  }), []);

  return (
    <VolumeContext.Provider value={value}>
      {children}
    </VolumeContext.Provider>
  );
};

export const useVolume = () => {
  const context = useContext(VolumeContext);
  if (!context) {
    return { volumeRef: { current: 1 }, getVolume: () => 1 };
  }
  return context;
};
