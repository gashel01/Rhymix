import { useCallback } from "react";
import type {
  DrumLabel,
  ReviewResponse,
  StartSessionRequest,
  StartSessionResponse,
  StatusResponse,
  TakeResponse,
  TrainResponse,
} from "./types";

const API_BASE = process.env.REACT_APP_API_BASE || "";

async function toJson<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || `Request failed (${res.status})`);
  }
  return data as T;
}

export function useSessionApi() {
  const startSession = useCallback(async (payload: StartSessionRequest): Promise<StartSessionResponse> => {
    const res = await fetch(`${API_BASE}/api/session/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return toJson<StartSessionResponse>(res);
  }, []);

  const uploadTake = useCallback(
    async ({
      sessionId,
      label,
      blob,
      meta,
    }: {
      sessionId: string;
      label: DrumLabel;
      blob: Blob;
      meta?: Record<string, unknown>;
    }): Promise<TakeResponse> => {
      const form = new FormData();
      form.append("label", label);
      form.append("audio", blob, `take-${Date.now()}.webm`);
      if (meta) form.append("meta", JSON.stringify(meta));
      const res = await fetch(`${API_BASE}/api/session/${sessionId}/take`, {
        method: "POST",
        body: form,
      });
      return toJson<TakeResponse>(res);
    },
    []
  );

  const train = useCallback(async (sessionId: string): Promise<TrainResponse> => {
    const res = await fetch(`${API_BASE}/api/session/${sessionId}/train`, { method: "POST" });
    return toJson<TrainResponse>(res);
  }, []);

  const review = useCallback(async (sessionId: string, label: DrumLabel, limit = 10): Promise<ReviewResponse> => {
    const res = await fetch(
      `${API_BASE}/api/session/${sessionId}/review?label=${encodeURIComponent(label)}&limit=${limit}`
    );
    return toJson<ReviewResponse>(res);
  }, []);

  const deleteSample = useCallback(async (sessionId: string, sampleId: string): Promise<{ ok: boolean }> => {
    const res = await fetch(`${API_BASE}/api/session/${sessionId}/sample/${sampleId}`, {
      method: "DELETE",
    });
    return toJson<{ ok: boolean }>(res);
  }, []);

  const status = useCallback(async (sessionId: string): Promise<StatusResponse> => {
    const res = await fetch(`${API_BASE}/api/session/${sessionId}/status`);
    return toJson<StatusResponse>(res);
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

