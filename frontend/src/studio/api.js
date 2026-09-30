import axios from "axios";
import { API_BASE } from "../utils/apiBase";

export const getOrCreateProjectByAsset = async (assetId) => {
  const response = await axios.get(
    `${API_BASE}/api/studio/projects/by-asset/${encodeURIComponent(assetId)}`
  );
  return response.data;
};

export const createProject = async (assetId = null, templateId = null) => {
  const payload = {};
  if (assetId) payload.assetId = assetId;
  if (templateId) payload.templateId = templateId;
  const response = await axios.post(`${API_BASE}/api/studio/projects`, payload);
  return response.data;
};

export const getProjectTemplates = async () => {
  const response = await axios.get(`${API_BASE}/api/studio/project-templates`);
  return response.data;
};

export const getAllProjects = async () => {
  const response = await axios.get(`${API_BASE}/api/studio/projects`);
  return response.data;
};

export const getProjectsByAssetList = async (assetId) => {
  const response = await axios.get(`${API_BASE}/api/studio/projects/by-asset/${encodeURIComponent(assetId)}/list`);
  return response.data;
};

export const deleteProject = async (projectId) => {
  const response = await axios.delete(`${API_BASE}/api/studio/projects/${projectId}`);
  return response.data;
};

export const updateProject = async (projectId, payload) => {
  const response = await axios.patch(`${API_BASE}/api/studio/projects/${projectId}`, payload);
  return response.data;
};

export const getProjectById = async (projectId) => {
  const response = await axios.get(`${API_BASE}/api/studio/projects/${projectId}`);
  return response.data;
};

export const startRender = async (projectId, master) => {
  const response = await axios.post(`${API_BASE}/api/studio/projects/${projectId}/render`, { master });
  return response.data;
};

export const startStemsRender = async (projectId) => {
  const response = await axios.post(`${API_BASE}/api/studio/projects/${projectId}/render/stems`);
  return response.data;
};

export const resetProject = async (projectId) => {
  const response = await axios.post(`${API_BASE}/api/studio/projects/${projectId}/reset`);
  return response.data;
};

export const startAiJob = async (projectId, jobType, payload) => {
  const response = await axios.post(
    `${API_BASE}/api/studio/projects/${projectId}/jobs/${jobType}`,
    payload || {}
  );
  return response.data;
};

export const importFoundationVoiceInput = async (projectId, { blob, filename, insertSec, label, laneName } = {}) => {
  const formData = new FormData();
  formData.append("audio", blob, filename || "foundation-voice-input.webm");
  formData.append("insertSec", String(Number(insertSec) || 0));
  if (label) formData.append("label", label);
  if (laneName) formData.append("laneName", laneName);
  const response = await axios.post(
    `${API_BASE}/api/studio/projects/${projectId}/foundation-voice-input`,
    formData,
    {
      headers: {
        "Content-Type": "multipart/form-data",
      },
    }
  );
  return response.data;
};

/* Shared with the rest of the app rather than a studio-scoped route — the
   file isn't project material yet, just something on disk with a fileId;
   it only becomes a project asset once the caller registers it (see
   LibraryPanel.js), the same two-step shape uploading into the standalone
   Create flow already uses. */
export const uploadAudioFile = async (file) => {
  const formData = new FormData();
  formData.append("files", file);
  const response = await axios.post(`${API_BASE}/api/upload`, formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return response.data?.files || [];
};

export const startMidiExport = async (projectId) => {
  const response = await axios.post(`${API_BASE}/api/studio/projects/${projectId}/export/midi`);
  return response.data;
};

export const cancelJob = async (jobId) => {
  const response = await axios.post(`${API_BASE}/api/jobs/${jobId}/cancel`);
  return response.data;
};

export const getJobStatus = async (jobId) => {
  const response = await axios.get(`${API_BASE}/api/jobs/${jobId}`);
  return response.data;
};

export const subscribeJobEvents = (jobId, onEvent) => {
  const source = new EventSource(`${API_BASE}/api/jobs/${jobId}/events`);
  source.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      onEvent?.(data);
    } catch (err) {
      console.error("Failed to parse job event", err);
    }
  };
  source.onerror = () => {
    source.close();
  };
  return () => source.close();
};

/* Bring an audio asset onto the project's tempo, key and bar grid (backend/features/studio/
   loop_match.py). Resolves to { asset, info } — asset is a new, already-registered derived asset. */
export const matchAsset = async (projectId, assetId, payload = {}) => {
  const response = await axios.post(
    `${API_BASE}/api/studio/projects/${projectId}/assets/${encodeURIComponent(assetId)}/match`,
    payload
  );
  return response.data;
};
