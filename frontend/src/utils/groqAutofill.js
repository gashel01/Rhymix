import { getStoredGroqApiKey } from "./groqSettings";

export const requestGroqAutofill = async (task, context = {}) => {
  const apiKey = getStoredGroqApiKey();
  const response = await fetch("/api/llm/autofill", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Groq-Api-Key": apiKey,
    },
    body: JSON.stringify({
      task,
      context,
    }),
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch (error) {
    payload = null;
  }

  if (!response.ok) {
    throw new Error(payload?.error || "Groq autofill request failed.");
  }

  if (!payload?.suggestion || typeof payload.suggestion !== "object") {
    throw new Error("Groq autofill returned an invalid suggestion.");
  }

  return payload;
};
