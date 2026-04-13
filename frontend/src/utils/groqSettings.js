export const GROQ_API_KEY_STORAGE_KEY = "rhymix:groqApiKey";

export const getStoredGroqApiKey = () => {
  if (typeof window === "undefined") return "";
  return String(window.localStorage.getItem(GROQ_API_KEY_STORAGE_KEY) || "").trim();
};

export const setStoredGroqApiKey = (value) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(GROQ_API_KEY_STORAGE_KEY, String(value || "").trim());
};

export const clearStoredGroqApiKey = () => {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(GROQ_API_KEY_STORAGE_KEY);
};

export const looksLikeGroqApiKey = (value) => {
  const text = String(value || "").trim();
  return text.startsWith("gsk_") && text.length >= 24;
};
