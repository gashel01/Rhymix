import React from "react";
  
export const Spinner = ({ size = 18 ,t}) => (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        border: `2px solid ${t.isDark ? "rgba(255,255,255,0.20)" : "rgba(0,0,0,0.18)"}`,
        borderTopColor: t.primary,
        display: "inline-block",
        animation: "spin 0.9s linear infinite",
      }}
    />
  );

  

export default Spinner;
