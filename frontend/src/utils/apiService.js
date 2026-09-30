/**
 * Centralized API service for all backend calls
 */

import axios from 'axios';
import { API_BASE } from './apiBase';

/**
 * Get available singing files
 * @returns {Promise<Object>} - Response with files array
 */
export const getAvailableFiles = async () => {
  const response = await axios.get(`${API_BASE}/api/available-files`);
  return response.data;
};

/**
 * Get available talking datasets
 * @returns {Promise<Object>} - Response with datasets array
 */
export const getAvailableTalkingDatasets = async () => {
  const response = await axios.get(`${API_BASE}/api/available-talking-datasets`);
  return response.data;
};

/**
 * Upload files
 * @param {File[]} files - Array of files to upload
 * @param {Function} onProgress - Optional progress callback
 * @returns {Promise<Object>} - Response data
 */
export const uploadFiles = async (files, onProgress = null) => {
  const formData = new FormData();
  files.forEach((file) => {
    formData.append('files', file);
  });

  const config = {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  };

  if (onProgress) {
    config.onUploadProgress = (progressEvent) => {
      const percentCompleted = Math.round(
        (progressEvent.loaded * 100) / progressEvent.total
      );
      onProgress(percentCompleted);
    };
  }

  const response = await axios.post(`${API_BASE}/api/upload`, formData, config);
  return response.data;
};

/**
 * Start processing files
 * @param {Object} config - Processing configuration
 * @returns {Promise<Object>} - Response with job_id
 */
export const startProcessing = async (config) => {
  const response = await axios.post(`${API_BASE}/api/process`, config);
  return response.data;
};

/**
 * Get job status
 * @param {string} jobId - Job ID
 * @returns {Promise<Object>} - Job status data
 */
export const getJobStatus = async (jobId) => {
  const response = await axios.get(`${API_BASE}/api/job/${jobId}`);
  return response.data;
};

/**
 * Get processing status for multiple tracks
 * @param {string[]} ids - Track IDs to check
 * @returns {Promise<Object[]>} - Array of { trackId, processing }
 */
export const getTrackStatuses = async (ids) => {
  const response = await axios.get(`${API_BASE}/api/tracks/status`, {
    params: { ids: (ids || []).join(",") },
  });
  return response.data;
};

/**
 * Delete audio files for selected tracks
 * @param {string[]} filenames - Array of filenames to delete
 * @returns {Promise<Object>} - Delete operation results
 */
export const deleteFiles = async (filenames) => {
  const response = await axios.post(`${API_BASE}/api/delete-files`, {
    filenames: filenames
  });
  return response.data;
};

/**
 * Delete inference runs
 * @param {string[]} runIds - Array of inference run IDs to delete
 * @returns {Promise<Object>} - Delete operation results
 */
export const deleteInferenceRuns = async (runIds) => {
  const response = await axios.post(`${API_BASE}/api/delete-inference-runs`, {
    runIds
  });
  return response.data;
};

/**
 * Clean directories
 * @param {Object} options - Clean options { include_input, force }
 * @returns {Promise<Object>} - Response data
 */
export const cleanDirectories = async (options = {}) => {
  const response = await axios.post(`${API_BASE}/api/clean`, {
    include_input: options.includeInput ?? true,
    force: options.force ?? true,
  });
  return response.data;
};

/**
 * Upload talking dataset
 * @param {File[]} files - Array of files to upload
 * @returns {Promise<Object>} - Response data
 */
export const uploadTalkingDataset = async (files) => {
  const formData = new FormData();
  files.forEach((file) => {
    formData.append('files', file);
  });

  const response = await axios.post(`${API_BASE}/api/upload-talking`, formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
  return response.data;
};

/**
 * Process talking dataset
 * @param {Object} config - Processing configuration
 * @returns {Promise<Object>} - Response with job_id
 */
export const processTalkingDataset = async (config) => {
  const response = await axios.post(`${API_BASE}/api/process-talking`, config);
  return response.data;
};

/**
 * Get talking job status
 * @param {string} jobId - Job ID
 * @returns {Promise<Object>} - Job status data
 */
export const getTalkingJobStatus = async (jobId) => {
  const response = await axios.get(`${API_BASE}/api/talking-status/${jobId}`);
  return response.data;
};

/**
 * Start training
 * @param {Object} config - Training configuration
 * @returns {Promise<Object>} - Response with jobId
 */
export const startTraining = async (config, abortSignal = null) => {
  try {
    const response = await fetch(`${API_BASE}/api/start-training`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(config),
      signal: abortSignal
    });
    return await response.json();
  } catch (error) {
    if (error.name === 'AbortError') {
      // Silently ignore - this is expected when component unmounts
      throw error;
    }
    throw error;
  }
};

/**
 * Get training status
 * @param {string} jobId - Job ID
 * @returns {Promise<Object>} - Training status data
 */
export const getTrainingStatus = async (jobId, abortSignal = null) => {
  try {
    const response = await fetch(`${API_BASE}/api/training-status/${jobId}`, {
      signal: abortSignal
    });
    return await response.json();
  } catch (error) {
    if (error.name === 'AbortError') {
      // Silently ignore - this is expected when component unmounts
      throw error;
    }
    throw error;
  }
};

/**
 * Prepare training dataset
 * @param {FormData} formData - Form data with vocal files
 * @returns {Promise<Object>} - Response data
 */
export const prepareTrainingDataset = async (formData, abortSignal = null) => {
  try {
    const response = await fetch(`${API_BASE}/api/prepare-training-dataset`, {
      method: 'POST',
      body: formData,
      signal: abortSignal
    });
    return await response.json();
  } catch (error) {
    if (error.name === 'AbortError') {
      // Silently ignore - this is expected when component unmounts
      throw error;
    }
    throw error;
  }
};

/**
 * Get available models
 * @returns {Promise<Object>} - Response with models array
 */
export const getAvailableModels = async (abortSignal = null) => {
  try {
    const response = await fetch(`${API_BASE}/api/available-models`, {
      signal: abortSignal
    });
    return await response.json();
  } catch (error) {
    if (error.name === 'AbortError') {
      // Silently ignore - this is expected when component unmounts
      throw error;
    }
    throw error;
  }
};

/**
 * Process audio for inference
 * @param {FormData} formData - Form data with audio and config
 * @returns {Promise<Object>} - Response data
 */
export const processAudio = async (formData, abortSignal = null) => {
  try {
    const response = await fetch(`${API_BASE}/api/process-audio`, {
      method: 'POST',
      body: formData,
      signal: abortSignal
    });
    return await response.json();
  } catch (error) {
    if (error.name === 'AbortError') {
      // Silently ignore - this is expected when component unmounts
      throw error;
    }
    throw error;
  }
};

/**
 * Get source song details for cover mode
 * @param {string} sourceSongId - Namespaced source id (e.g. upload:abc, run:xyz)
 * @param {AbortSignal|null} abortSignal
 * @returns {Promise<Object>}
 */
export const getCoverSourceSong = async (sourceSongId, abortSignal = null) => {
  const response = await fetch(`${API_BASE}/api/covers/source/${encodeURIComponent(sourceSongId)}`, {
    signal: abortSignal,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error || "Failed to load source song");
  }
  return data;
};

/**
 * Start an async cover generation job
 * @param {Object} payload - cover request payload
 * @returns {Promise<Object>}
 */
export const startCoverGeneration = async (payload) => {
  const response = await fetch(`${API_BASE}/api/covers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error || "Failed to start cover generation");
  }
  return data;
};

/**
 * Get cover job status
 * @param {string} jobId
 * @param {AbortSignal|null} abortSignal
 * @returns {Promise<Object>}
 */
export const getCoverGenerationStatus = async (jobId, abortSignal = null) => {
  const response = await fetch(`${API_BASE}/api/covers/${encodeURIComponent(jobId)}`, {
    signal: abortSignal,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error || "Failed to get cover status");
  }
  return data;
};

