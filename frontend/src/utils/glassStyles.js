export const getGlassSurfaceStyles = (theme, options = {}) => {
  const {
    borderRadius = 20,
    borderWidth = 1,
    blur = 22,
    glowStrength = theme.palette.mode === "dark"
      ? "0 24px 50px rgba(0, 0, 0, 0.5)"
      : "0 18px 40px rgba(15, 23, 42, 0.14)",
    backgroundOpacity = theme.palette.mode === "dark" ? 0.66 : 0.9,
    borderGradient = theme.palette.mode === "dark"
      ? "linear-gradient(135deg, rgba(255,255,255,0.3), rgba(0,122,255,0.25), rgba(255,255,255,0.08))"
      : "linear-gradient(135deg, rgba(255,255,255,0.9), rgba(0,122,255,0.3), rgba(255,255,255,0.7))",
    highlightGradient = theme.palette.mode === "dark"
      ? "linear-gradient(180deg, rgba(255,255,255,0.18), rgba(255,255,255,0))"
      : "linear-gradient(180deg, rgba(255,255,255,0.7), rgba(255,255,255,0))",
    withBorder = true,
    withHighlight = true,
    overflow = "hidden",
  } = options;

  const background = theme.palette.mode === "dark"
    ? `linear-gradient(145deg, rgba(16,16,20,${backgroundOpacity}), rgba(28,28,34,${Math.min(backgroundOpacity + 0.18, 0.92)}))`
    : `linear-gradient(145deg, rgba(255,255,255,${backgroundOpacity}), rgba(248,250,255,${Math.min(backgroundOpacity + 0.08, 0.95)}))`;

  const baseStyles = {
    position: "relative",
    borderRadius,
    background,
    border: withBorder ? `${borderWidth}px solid transparent` : `${borderWidth}px solid ${theme.palette.divider}`,
    backdropFilter: `blur(${blur}px)`,
    boxShadow: glowStrength,
    overflow,
    isolation: "isolate",
  };

  const borderStyles = withBorder
    ? {
        "&::before": {
          content: '""',
          position: "absolute",
          inset: 0,
          borderRadius: "inherit",
          padding: `${borderWidth}px`,
          background: borderGradient,
          WebkitMask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
          WebkitMaskComposite: "xor",
          maskComposite: "exclude",
          pointerEvents: "none",
        },
      }
    : {};

  const highlightStyles = withHighlight
    ? {
        "&::after": {
          content: '""',
          position: "absolute",
          inset: `${borderWidth}px`,
          borderRadius: "inherit",
          background: highlightGradient,
          opacity: theme.palette.mode === "dark" ? 0.45 : 0.65,
          pointerEvents: "none",
        },
      }
    : {};

  return {
    ...baseStyles,
    ...borderStyles,
    ...highlightStyles,
  };
};
