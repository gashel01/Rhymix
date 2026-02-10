import React from "react";

export function CreateSongHeader({ ui, t, isStuck, mode = "create" }) {
  const { Glass } = ui;
  const isCoverMode = mode === "cover";
  return (
    <div
      style={{
        backdropFilter: isStuck ? "blur(20px)" : "none",
        borderRadius: isStuck ? 0 : t.radiusLg,
        border: `1px solid ${t.hairline}`,
        margin: isStuck ? 0 : "20px 20px 0 20px",
        background: `linear-gradient(180deg, ${t.glassA}, ${t.glassB})`,
        position: "sticky",
        top: 0,
        zIndex: 1000,
        boxShadow: isStuck ? t.shadowSoft : t.shadow,
        overflow: "hidden",
        transition: "padding 180ms ease, border-radius 180ms ease, box-shadow 180ms ease",
      }}
    >
      <Glass style={{ border: "none", boxShadow: "none", background: "transparent", backgroundColor: "transparent", borderRadius: 0, backdropFilter: "none", padding: "20px 24px" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, letterSpacing: -0.5, color: t.text, lineHeight: 1.2 }}>
            {isCoverMode ? "Create Cover" : "Create a song"}
          </h1>
          <p style={{ margin: "6px 0 0 0", fontSize: 15, fontWeight: 500, color: t.subtext, lineHeight: 1.4 }}>
            {isCoverMode
              ? "Use an existing song as source and generate a new cover version."
              : "Give it a name, describe the vibe or paste lyrics. We’ll handle the rest."}
          </p>
        </div>
      </Glass>
    </div>
  );
}
