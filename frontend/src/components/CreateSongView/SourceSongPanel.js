import React from "react";
import MusicNoteIcon from "@mui/icons-material/MusicNote";

export function SourceSongPanel({ ui, t, sourceSong, loading, error }) {
  const { Panel } = ui;
  const hasAudio = Boolean(sourceSong?.audioUrl || sourceSong?.instrumentalUrl || sourceSong?.vocalsUrl);

  return (
    <Panel style={{ padding: "0px 14px" , borderRadius: 12}}>
     <div style={{ fontSize: 11, fontWeight: 600, color: t.subtext }}>Source song</div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
       
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        
          <div style={{ width: 32, height: 32, borderRadius: 10, display: "grid", placeItems: "center", background: t.isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)" }}>
            <MusicNoteIcon style={{ fontSize: 18, color: t.subtext }} />
          </div>
          <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
           
            {loading && <div style={{ fontSize: 13, fontWeight: 600, color: t.subtext }}>Loading source song…</div>}
            {!loading && sourceSong && (
              <div style={{ display: "grid", gap: 2 }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: t.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {sourceSong.title || "Untitled source"}
                </div>
                <div style={{ fontSize: 12, fontWeight: 600, color: t.subtext, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {[sourceSong.artist, sourceSong.duration ? `${sourceSong.duration}s` : null].filter(Boolean).join(" · ") || "Audio source"}
                </div>
              </div>
            )}
            {!loading && !sourceSong && !error && (
              <div style={{ fontSize: 13, fontWeight: 600, color: t.subtext }}>No source song selected.</div>
            )}
          </div>
        </div>

        {/* {!loading && sourceSong && (
          <div
            style={{
              padding: "4px 10px",
              borderRadius: 999,
              border: `1px solid ${hasAudio ? "rgba(52,199,89,0.35)" : "rgba(255,69,58,0.35)"}`,
              background: hasAudio ? "rgba(52,199,89,0.12)" : "rgba(255,69,58,0.12)",
              color: hasAudio ? t.success : t.danger,
              fontSize: 11,
              fontWeight: 800,
              whiteSpace: "nowrap",
            }}
          >
            {hasAudio ? "Audio ready" : "Audio missing"}
          </div>
        )} */}
      </div>

      {error && <div style={{ marginTop: 8, fontSize: 12, fontWeight: 700, color: t.danger }}>{error}</div>}
    </Panel>
  );
}
