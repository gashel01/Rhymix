import React, { useMemo } from "react";


  export function Theme({ darkMode }) {

    const isDark = useMemo(() => {
        if (typeof darkMode === "boolean") return darkMode;
        if (typeof window === "undefined") return false;
        return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ?? false;
      }, [darkMode]);
    
    
     const t =  useMemo(() => {
        return {
          isDark,
          pageBg: isDark ? "#0B0B0F" : "#F4F5F7",
          text: isDark ? "rgba(255,255,255,0.92)" : "rgba(0,0,0,0.90)",
          subtext: isDark ? "rgba(255,255,255,0.62)" : "rgba(0,0,0,0.55)",
          hairline: isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.10)",
          glassA: isDark ? "rgba(18,18,20,0.62)" : "rgba(255,255,255,0.72)",
          glassB: isDark ? "rgba(26,26,28,0.56)" : "rgba(248,248,250,0.78)",
          cardA: isDark ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.86)",
          cardB: isDark ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.72)",
          shadow: isDark ? "0 18px 44px rgba(0,0,0,0.60)" : "0 18px 46px rgba(0,0,0,0.12)",
          shadowSoft: isDark ? "0 10px 24px rgba(0,0,0,0.45)" : "0 12px 26px rgba(0,0,0,0.10)",
          primary: isDark ? "rgba(10,132,255,1)" : "rgba(0,122,255,1)",
          primaryWash: isDark ? "rgba(10,132,255,0.20)" : "rgba(0,122,255,0.16)",
          primaryWash2: isDark ? "rgba(10,132,255,0.10)" : "rgba(0,122,255,0.08)",
          success: "rgba(52,199,89,1)",
          successWash: isDark ? "rgba(52,199,89,0.18)" : "rgba(52,199,89,0.14)",
          radiusLg: 22,
          radiusMd: 16,
          maxW: 1400,
          stickyTop: 12,
          flatIconActive: isDark ? "#ffffff" : "#000000",
          //light gray
          flatIconInactive: isDark ? "#3d3d3d" : "#888",
        };
      }, [isDark]);

    return {
      t,
      isDark,
    }
  }

  export default Theme;