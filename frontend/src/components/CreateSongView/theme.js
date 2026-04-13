export function getTheme(isDark) {
  const pageBg = isDark ? "#0a0a0e" : "#f2f3f5";
  const surfaceA = isDark ? "rgba(20,20,24,0.85)" : "rgba(255,255,255,0.9)";
  const surfaceB = isDark ? "rgba(26,26,32,0.8)" : "rgba(248,249,251,0.95)";
  const cardA = isDark ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.95)";
  const cardB = isDark ? "rgba(255,255,255,0.02)" : "rgba(255,255,255,0.88)";

  return {
    isDark,
    pageBg,
    // maxW: 1100,
    text: isDark ? "rgba(255,255,255,0.95)" : "rgba(0,0,0,0.88)",
    subtext: isDark ? "rgba(255,255,255,0.55)" : "rgba(0,0,0,0.5)",
    hairline: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",
    glassA: surfaceA,
    glassB: surfaceB,
    cardA,
    cardB,
    shadow: isDark ? "0 24px 48px rgba(0,0,0,0.4)" : "0 20px 40px rgba(0,0,0,0.06)",
    shadowSoft: isDark ? "0 12px 28px rgba(0,0,0,0.3)" : "0 8px 24px rgba(0,0,0,0.04)",
    primary: isDark ? "rgba(0,122,255,1)" : "rgba(0,122,255,1)",
    primaryWash: isDark ? "rgba(0,122,255,0.15)" : "rgba(0,122,255,0.12)",
    primaryWash2: isDark ? "rgba(0,122,255,0.08)" : "rgba(0,122,255,0.06)",
    success: "rgba(52,199,89,1)",
    successWash: isDark ? "rgba(52,199,89,0.15)" : "rgba(52,199,89,0.12)",
    warning: "rgba(255,149,0,1)",
    danger: "rgba(255,59,48,1)",
    dangerWash: isDark ? "rgba(255,59,48,0.18)" : "rgba(255,59,48,0.12)",
    radiusLg: 24,
    radiusMd: 18,
    radiusSm: 14,
    stickyTop: 12,
  };
}
