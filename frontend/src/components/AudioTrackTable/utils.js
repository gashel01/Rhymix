/**
 * Utility functions for AudioTrackTable
 */

/**
 * Extract clean filename without path and extension
 */
export const getCleanFileName = (filename) => {
  if (!filename) return "";
  const fileOnly = filename.split(/[/\\]/).pop();
  return fileOnly
    .replace(/_instrumental\.wav$/, "")
    .replace(/_vocals\.wav$/, "");
};



export const getCleanFileNameAndModelForInference = (filename) => {

  if (!filename) return { name: "Unknown", model: "Unknown" };

  // 1. Get the first part (before the hyphen) which contains the model
  // Part 1: eminem_dive_into_the_dirt_instrumental.wav
  const [firstPart] = filename.split("-");

  // 2. Extract the model (everything before the first underscore)
  const model = firstPart.split("_")[0];

  // 3. Extract the track name
  // We look for the section between the model name and the "_instrumental" tag
  const name = firstPart
    .replace(`${model}_`, "") // Remove model prefix
    .replace("_instrumental.wav", "") // Remove file suffix
    .replace(".wav", ""); // Safety catch for varying extensions

  return { name, model };

}



/**
 * Extract just the filename from a path (with extension)
 */
export const getFileNameFromPath = (filepath) => {
  if (!filepath) return "";
  return filepath.split(/[/\\]/).pop();
};

/**
 * Safely play a waveform
 */
export const safePlay = (waveform) => {
  if (waveform && typeof waveform.play === "function") {
    waveform.play();
    return true;
  }
  return false;
};

/**
 * Safely pause a waveform
 */
export const safePause = (waveform) => {
  if (waveform && typeof waveform.pause === "function") {
    waveform.pause();
    return true;
  }
  return false;
};

/**
 * Safely set muted state on a waveform
 */
export const safeSetMuted = (waveform, muted) => {
  if (!waveform) {
    console.warn('safeSetMuted: waveform is null or undefined');
    return false;
  }
  
  if (typeof waveform.setMuted === "function") {
    try {
      waveform.setMuted(muted);
      return true;
    } catch (err) {
      console.error('safeSetMuted: error calling waveform.setMuted:', err);
      return false;
    }
  } else if (typeof waveform.getWavesurfer === "function") {
    try {
      const wavesurfer = waveform.getWavesurfer();
      if (wavesurfer && typeof wavesurfer.setMuted === "function") {
        wavesurfer.setMuted(!!muted);
        return true;
      }
      if (wavesurfer && typeof wavesurfer.setVolume === "function") {
        wavesurfer.setVolume(muted ? 0 : 1);
        return true;
      }
      if (wavesurfer && wavesurfer.backend && wavesurfer.backend.gainNode) {
        wavesurfer.backend.gainNode.gain.value = muted ? 0 : 1;
        return true;
      }
    } catch (err) {
      console.error('safeSetMuted: error accessing wavesurfer:', err);
    }
  } else {
    console.warn('safeSetMuted: waveform does not have setMuted or getWavesurfer method', {
      hasSetMuted: typeof waveform.setMuted === "function",
      hasGetWavesurfer: typeof waveform.getWavesurfer === "function",
      waveformKeys: Object.keys(waveform || {})
    });
  }
  return false;
};
