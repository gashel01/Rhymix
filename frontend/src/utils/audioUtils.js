/**
 * Audio utility functions for download logic and URL construction
 */

import { extractFilename } from './fileUtils';

const INVALID_FILENAME_CHARS = /[\\/:*?"<>|]+/g;

export const sanitizeModelName = (value, maxLength = 40) => {
  if (!value) return "";
  const normalized = value
    .toString()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(INVALID_FILENAME_CHARS, "_")
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!normalized) return "";
  return normalized.length > maxLength ? normalized.slice(0, maxLength) : normalized;
};

export const sanitizeBaseName = (value) => {
  if (!value) return "";
  const cleaned = value
    .toString()
    .replace(INVALID_FILENAME_CHARS, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned;
};

export const getBaseNameAndExt = ({ originalName, displayName, fallbackExt = "wav" } = {}) => {
  const rawName = originalName || displayName || "";
  const parts = rawName.split(".");
  let ext = "";
  let base = rawName;
  if (parts.length > 1) {
    ext = parts.pop();
    base = parts.join(".");
  }
  const safeBase = sanitizeBaseName(base) || sanitizeBaseName(displayName) || "track";
  const safeExt = ext ? ext.replace(/[^a-zA-Z0-9]/g, "").toLowerCase() : fallbackExt;
  return { baseName: safeBase, ext: safeExt || fallbackExt };
};

export const makeDownloadName = ({ baseName, type, modelName, ext = "wav" }) => {
  const safeBase = sanitizeBaseName(baseName) || "track";
  const safeExt = ext ? ext.replace(/[^a-zA-Z0-9]/g, "").toLowerCase() : "wav";
  const safeModel = sanitizeModelName(modelName);
  const kind = (type || "").toLowerCase();

  if (["instrumental"].includes(kind)) {
    return `${safeBase}_instrumental.${safeExt}`;
  }
  if (["raw_vocals", "raw_vocal", "original"].includes(kind)) {
    return `${safeBase}_raw_vocal.${safeExt}`;
  }
  if (["processed_vocals", "processed_vocal"].includes(kind)) {
    return `${safeBase}_processed_vocal.${safeExt}`;
  }
  if (["converted", "converted_vocal"].includes(kind)) {
    const model = safeModel || "model";
    return `${safeBase}_converted_${model}_vocal.${safeExt}`;
  }
  if (["merged", "full"].includes(kind)) {
    const model = safeModel || "original";
    return `${safeBase}_${model}_full.${safeExt}`;
  }
  return `${safeBase}.${safeExt}`;
};

/**
 * Construct download URL for a file
 * @param {string} fileType - Type of file ('instrumental', 'raw_vocals', 'processed_vocals', etc.)
 * @param {string} filename - Filename to download
 * @returns {string} - Download URL
 */
export const getDownloadUrl = (fileType, fileId, downloadName = null) => {
  if (!fileType || !fileId) return null;
  const base = `/api/download/${fileType}/${fileId}`;
  if (!downloadName) return base;
  return `${base}?downloadName=${encodeURIComponent(downloadName)}`;
};

/**
 * Download a file from the server
 * @param {string} fileType - Type of file
 * @param {string} filePath - Full file path or filename
 * @param {string} vocalMode - Current vocal mode for vocals files
 * @param {string} customFilename - Optional custom filename for download
 * @returns {Promise<void>}
 */
export const downloadFile = async (fileType, filePath, vocalMode = 'processed', customFilename = null, abortSignal = null) => {
  try {
    if (!filePath) return;

    const fileName = extractFilename(filePath) || filePath;
    const actualFileType = fileType;
    const url = getDownloadUrl(actualFileType, fileName, customFilename);

    const response = await fetch(url, {
      signal: abortSignal
    });

    if (!response.ok) {
      let errorDetail = '';
      try {
        const errorData = await response.json();
        errorDetail = errorData.error || '';
        if (errorData.available_files) {
          console.log('Available files:', errorData.available_files);
        }
      } catch (e) {
        try {
          errorDetail = await response.text();
        } catch (textError) {
          errorDetail = response.statusText;
        }
      }
      throw new Error(`Download failed: ${response.status} ${errorDetail}`);
    }

    const blob = await response.blob();
    const downloadUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;

    // Use custom filename or format the filename
    const downloadFileName = customFilename || fileName;
    link.setAttribute('download', downloadFileName);
    
    document.body.appendChild(link);
    link.click();

    // Clean up
    window.URL.revokeObjectURL(downloadUrl);
    link.remove();
  } catch (error) {
    // Don't log AbortError as it's expected when component unmounts
    if (error.name !== 'AbortError') {
      console.error('Download failed:', error);
      alert(`Failed to download the file: ${error.message}`);
      throw error;
    }
    // Silently ignore AbortError - this is expected when navigating away
  }
};

/**
 * Download full song (mixed instrumental + vocal)
 * @param {string} instrumentalFileName - Instrumental filename
 * @param {string} vocalFileName - Vocal filename
 * @returns {Promise<void>}
 */
export const downloadMergedAudio = async ({
  instrumental,
  vocal,
  downloadName,
  format = "wav",
  abortSignal = null,
} = {}) => {
  try {
    if (!instrumental || !vocal) return;
    const response = await fetch("/api/audio/merge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: abortSignal,
      body: JSON.stringify({
        instrumental,
        vocal,
        downloadName,
        format,
      }),
    });

    if (!response.ok) {
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to download full song');
      } else {
        throw new Error(`Server error: ${response.status} ${response.statusText}`);
      }
    }

    const blob = await response.blob();
    const urlObj = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = urlObj;

    const fallbackName = downloadName || "merged.wav";
    a.download = fallbackName;

    document.body.appendChild(a);
    a.click();

    setTimeout(() => {
      document.body.removeChild(a);
      window.URL.revokeObjectURL(urlObj);
    }, 100);
  } catch (error) {
    // Don't log AbortError as it's expected when component unmounts
    if (error.name !== 'AbortError') {
      console.error('Error downloading merged audio:', error);
      alert(`Failed to download merged audio: ${error.message}`);
      throw error;
    }
    // Silently ignore AbortError - this is expected when navigating away
  }
};

/**
 * Download dataset as ZIP
 * @param {Object} selectedDataset - Object with processed and raw arrays
 * @returns {Promise<void>}
 */
export const downloadDataset = async (selectedDataset) => {
  try {
    const response = await fetch('/api/download/dataset', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(selectedDataset),
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || 'Failed to download dataset');
    }

    const contentDisposition = response.headers.get('Content-Disposition');
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;

    let filename = 'vocals_dataset.zip';
    if (contentDisposition) {
      const filenameMatch = contentDisposition.match(/filename="(.+)"/);
      if (filenameMatch && filenameMatch[1]) {
        filename = filenameMatch[1];
      }
    }
    a.download = filename;

    document.body.appendChild(a);
    a.click();

    setTimeout(() => {
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    }, 100);
  } catch (error) {
    console.error('Error downloading dataset:', error);
    alert(`Failed to download dataset: ${error.message}`);
    throw error;
  }
};
