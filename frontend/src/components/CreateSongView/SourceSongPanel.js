import React from "react";
import MusicNoteIcon from "@mui/icons-material/MusicNote";

export function SourceSongPanel({ ui, t, sourceSong, loading, error }) {
  const { Panel } = ui;
  const hasAudio = Boolean(sourceSong?.audioUrl || sourceSong?.instrumentalUrl || sourceSong?.vocalsUrl);

  return (
    <Panel style={{ padding: 18 }}>
      <div style={{ display: "grid", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <MusicNoteIcon style={{ fontSize: 18, color: t.subtext }} />
          <div style={{ fontSize: 14, fontWeight: 700, color: t.text }}>Source Song</div>
        </div>

        {loading && <div style={{ fontSize: 13, fontWeight: 600, color: t.subtext }}>Loading source song…</div>}

        {!loading && sourceSong && (
          <div style={{ display: "grid", gap: 4 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: t.text }}>{sourceSong.title || "Untitled source"}</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: t.subtext }}>
              {[sourceSong.artist, sourceSong.duration ? `${sourceSong.duration}s` : null].filter(Boolean).join(" · ") || "Audio source"}
            </div>
            <div style={{ fontSize: 12, fontWeight: 700, color: hasAudio ? t.success : t.danger }}>
              {hasAudio ? "Audio available" : "Source audio missing"}
            </div>
          </div>
        )}

        {!loading && !sourceSong && !error && (
          <div style={{ fontSize: 13, fontWeight: 600, color: t.subtext }}>No source song selected.</div>
        )}

        {error && <div style={{ fontSize: 12, fontWeight: 700, color: t.danger }}>{error}</div>}
      </div>
    </Panel>
  );
}
