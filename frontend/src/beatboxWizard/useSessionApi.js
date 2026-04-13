import { useCallback } from "react";

const API_BASE = process.env.REACT_APP_API_BASE || "";

async function toJson(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || `Request failed (${res.status})`);
  }
  return data;
}

export function useSessionApi() {
  const startSession = useCallback(async (payload) => {
    const res = await fetch(`${API_BASE}/api/session/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return toJson(res);
  }, []);

  const uploadTake = useCallback(async ({ sessionId, label, blob, meta }) => {
    const form = new FormData();
    form.append("label", label);
    form.append("audio", blob, `take-${Date.now()}.webm`);
    if (meta) form.append("meta", JSON.stringify(meta));
    const res = await fetch(`${API_BASE}/api/session/${sessionId}/take`, {
      method: "POST",
      body: form,
    });
    return toJson(res);
  }, []);

  const train = useCallback(async (sessionId) => {
    const res = await fetch(`${API_BASE}/api/session/${sessionId}/train`, {
      method: "POST",
    });
    return toJson(res);
  }, []);

  const review = useCallback(async (sessionId, label, limit = 10, sort = "confidence") => {
    const res = await fetch(
      `${API_BASE}/api/session/${sessionId}/review?label=${encodeURIComponent(label)}&limit=${limit}&sort=${encodeURIComponent(sort)}`
    );
    return toJson(res);
  }, []);

  const deleteSample = useCallback(async (sessionId, sampleId) => {
    const res = await fetch(`${API_BASE}/api/session/${sessionId}/sample/${sampleId}`, {
      method: "DELETE",
    });
    return toJson(res);
  }, []);

  const status = useCallback(async (sessionId) => {
    const res = await fetch(`${API_BASE}/api/session/${sessionId}/status`);
    return toJson(res);
  }, []);

  return {
    startSession,
    uploadTake,
    train,
    review,
    deleteSample,
    status,
  };
}
