/* Resolves the base URL every axios/fetch call in the app is built against.
   - REACT_APP_API_BASE, if set at build time, always wins (custom deploys).
   - The native Electron shell (native/shell/) loads the built app over file://,
     which has no same-origin Flask server for a relative "/api/..." path to
     resolve against — those requests would resolve to file:///api/... and
     fail. Detect that origin and target the backend directly instead.
   - Otherwise (normal web deploy, dev server), stay relative — same behavior
     every part of the app already relied on. */
const resolveApiBase = () => {
  if (process.env.REACT_APP_API_BASE) return process.env.REACT_APP_API_BASE;
  if (typeof window !== "undefined" && window.location?.protocol === "file:") {
    return "http://localhost:5000";
  }
  return "";
};

export const API_BASE = resolveApiBase();

/* Most call sites across the app build their own `${API_BASE}/api/...` string
   from a local, separately-declared "" constant, and a good number just
   fetch("/api/...") directly with no constant at all — auditing and editing
   every one of those call sites individually is exactly the kind of sweeping,
   easy-to-get-subtly-wrong change to avoid. Patching axios' default baseURL
   and window.fetch once, here, at app boot, makes every existing and future
   relative "/api/..." call resolve against the real backend when API_BASE is
   set (Electron's file:// origin), while being a complete no-op in the
   normal web build (API_BASE === "" there, both patches below skip). Axios
   already leaves absolute URLs (the few call sites that now import API_BASE
   directly and build an absolute string) untouched when baseURL is set, so
   there is no double-prefixing. */
export const installApiBaseInterceptors = (axiosInstance) => {
  if (!API_BASE) return;

  if (axiosInstance && !axiosInstance.defaults.baseURL) {
    axiosInstance.defaults.baseURL = API_BASE;
  }

  if (typeof window !== "undefined" && window.fetch && !window.fetch.__rhymixApiBasePatched) {
    const originalFetch = window.fetch.bind(window);
    const patchedFetch = (input, init) => {
      if (typeof input === "string" && input.startsWith("/api")) {
        return originalFetch(`${API_BASE}${input}`, init);
      }
      return originalFetch(input, init);
    };
    patchedFetch.__rhymixApiBasePatched = true;
    window.fetch = patchedFetch;
  }
};
