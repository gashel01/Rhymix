import { useMemo } from "react";


export function Theme({ darkMode }) {

  const isDark = useMemo(() => {
    if (typeof darkMode === "boolean") return darkMode;
    if (typeof window === "undefined") return false;
    return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ?? false;
  }, [darkMode]);


  const t = useMemo(() => {
    return {
      isDark,
      pageBg: isDark ? "#0B0B0F" : "#F8FAFC",
      text: isDark ? "rgba(255,255,255,0.92)" : "#0F172A",
      subtext: isDark ? "rgba(255,255,255,0.62)" : "#64748B",
      hairline: isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.06)",
      glassA: isDark ? "rgba(18,18,20,0.62)" : "rgba(255,255,255,0.85)",
      glassB: isDark ? "rgba(26,26,28,0.56)" : "rgba(255,255,255,0.65)",
      cardA: isDark ? "rgba(255,255,255,0.06)" : "#FFFFFF",
      cardB: isDark ? "rgba(255,255,255,0.03)" : "#F8FAFC",
      shadow: isDark ? "0 18px 44px rgba(0,0,0,0.60)" : "0 20px 48px rgba(15,23,42,0.08)",
      shadowSoft: isDark ? "0 10px 24px rgba(0,0,0,0.45)" : "0 8px 24px rgba(15,23,42,0.04)",
      primary: isDark ? "rgba(10,132,255,1)" : "#2563EB",
      primaryWash: isDark ? "rgba(10,132,255,0.20)" : "rgba(37,99,235,0.1)",
      primaryWash2: isDark ? "rgba(10,132,255,0.10)" : "rgba(37,99,235,0.05)",
      success: isDark ? "rgba(52,199,89,1)" : "#10B981",
      successWash: isDark ? "rgba(52,199,89,0.18)" : "rgba(16,185,129,0.1)",
      radiusLg: 22,
      radiusMd: 16,
      maxW: 1400,
      stickyTop: 12,
      flatIconActive: isDark ? "#ffffff" : "#0F172A",
      flatIconInactive: isDark ? "#3d3d3d" : "#94A3B8",
    };
  }, [isDark]);

  return {
    t,
    isDark,
  }
}

export default Theme;