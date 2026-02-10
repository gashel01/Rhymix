import React from "react";
import MusicNoteIcon from "@mui/icons-material/MusicNote";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import PauseIcon from "@mui/icons-material/Pause";
import DownloadIcon from "@mui/icons-material/Download";
import DeleteIcon from "@mui/icons-material/Delete";
import MicIcon from "@mui/icons-material/Mic";
import {
  API_BASE,
  SONG_ASSET_KEYS,
  SONG_ASSET_LABELS,
  isAssetReady,
  getBestAssetKey,
  resolveAssetUrl,
} from "./constants";

export const GeneratedPanel = React.memo(function GeneratedPanel({
  ui,
  t,
  songs,
  loadingSongs,
  error,
  playingId,
  onPlayPause,
  onDeleteSong,
  onSelectAsset,
  onClearError,
}) {
  const { Panel, Spinner, Alert, IconBtn, Segmented, ProgressBar, Wave } = ui;

  return (
    <Panel style={{ minHeight: 380, padding: 24 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, letterSpacing: -0.2, color: t.text }}>Your songs</h2>
        {loadingSongs && <Spinner size={14} />}
      </div>

      {error && (
        <Alert kind="error" onClose={onClearError}>
          {error}
        </Alert>
      )}

      {songs.length === 0 && !loadingSongs ? (
        <div style={{ padding: "48px 24px", textAlign: "center" }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: "50%",
              margin: "0 auto 16px auto",
              display: "grid",
              placeItems: "center",
              background: t.isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
            }}
          >
            <MusicNoteIcon style={{ fontSize: 28, opacity: 0.5, color: t.subtext }} />
          </div>
          <div style={{ fontSize: 16, fontWeight: 600, color: t.text, marginBottom: 6 }}>Nothing here yet</div>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 500, color: t.subtext, lineHeight: 1.5 }}>
            Create your first song above. It’ll show up here when it’s ready.
          </p>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 14 }}>
          {songs.map((s) => {
            const active = playingId === s.id;
            const assets = s.hasAssets ? s.assets || {} : null;
            const selectedAssetKey = assets ? s.selectedAssetKey || getBestAssetKey(assets) : null;
            const isAssetReadyNow = selectedAssetKey ? isAssetReady(assets?.[selectedAssetKey]) : false;
            const legacyReady = !!(s.vocalsUrl || s.instrumentalUrl || s.audioUrl);
            const isReady = assets ? isAssetReadyNow : legacyReady;
            const isGenerating = !isReady && s.status && s.status !== "failed";
            const isFailed = s.status === "failed";
            const durationStr = s.duration ? `${Math.floor(s.duration / 60)}:${String(s.duration % 60).padStart(2, "0")}` : "";

            return (
              <div
                key={s.id}
                style={{
                  borderRadius: t.radiusMd,
                  border: `1px solid ${isFailed ? "rgba(255,59,48,0.35)" : t.hairline}`,
                  background: t.isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.02)",
                  padding: 16,
                  opacity: isFailed ? 0.85 : 1,
                }}
              >
                <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                  {isGenerating ? (
                    <div style={{ width: 48, height: 48, borderRadius: t.radiusSm, display: "grid", placeItems: "center", background: t.isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)" }}>
                      <Spinner size={20} />
                    </div>
                  ) : (
                    <IconBtn
                      onClick={() => onPlayPause(s)}
                      disabled={!isReady}
                      title={isReady ? (active ? "Pause" : "Play") : "Not ready yet"}
                      style={{ width: 48, height: 48, borderRadius: t.radiusSm, background: t.isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)", boxShadow: "none" }}
                    >
                      {active ? <PauseIcon /> : <PlayArrowIcon />}
                    </IconBtn>
                  )}

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 600, color: t.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {s.title}
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: t.subtext, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginTop: 2 }}>
                      {isGenerating ? (
                        `Creating… ${s.progress || 0}%`
                      ) : isFailed ? (
                        <span style={{ color: t.danger }}>Something went wrong</span>
                      ) : (
                        [
                          s.derivationType === "cover" && s.sourceTitle ? `Cover of ${s.sourceTitle}` : "",
                          durationStr,
                          s.genres?.length ? s.genres.slice(0, 2).join(", ") : "",
                        ]
                          .filter(Boolean)
                          .join(" · ")
                      )}
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    {assets && (
                      <IconBtn
                        title="Download Selected"
                        disabled={!isReady}
                        onClick={() => {
                          const key = selectedAssetKey || getBestAssetKey(assets);
                          if (!key) return;
                          const a = document.createElement("a");
                          a.href = `${API_BASE}${resolveAssetUrl(s, key)}`;
                          a.download = `${s.title || "song"}_${key}.wav`;
                          a.click();
                        }}
                        style={{ width: 36, height: 36, borderRadius: 12, boxShadow: "none" }}
                      >
                        <DownloadIcon fontSize="small" />
                      </IconBtn>
                    )}
                    {!assets && s.vocalsUrl && (
                      <IconBtn
                        title="Download Vocals"
                        disabled={!isReady}
                        onClick={() => {
                          const a = document.createElement("a");
                          a.href = `${API_BASE}${s.vocalsUrl}`;
                          a.download = `${s.title || "song"}_vocals.wav`;
                          a.click();
                        }}
                        style={{ width: 36, height: 36, borderRadius: 12, boxShadow: "none" }}
                      >
                        <MicIcon fontSize="small" />
                      </IconBtn>
                    )}
                    {!assets && s.instrumentalUrl && (
                      <IconBtn
                        title="Download Instrumental"
                        disabled={!isReady}
                        onClick={() => {
                          const a = document.createElement("a");
                          a.href = `${API_BASE}${s.instrumentalUrl}`;
                          a.download = `${s.title || "song"}_instrumental.wav`;
                          a.click();
                        }}
                        style={{ width: 36, height: 36, borderRadius: 12, boxShadow: "none" }}
                      >
                        <MusicNoteIcon fontSize="small" />
                      </IconBtn>
                    )}
                    {!assets && !s.vocalsUrl && !s.instrumentalUrl && s.audioUrl && (
                      <IconBtn
                        title="Download"
                        disabled={!isReady}
                        onClick={() => {
                          const a = document.createElement("a");
                          a.href = `${API_BASE}${s.audioUrl}`;
                          a.download = `${s.title || "song"}.wav`;
                          a.click();
                        }}
                        style={{ width: 36, height: 36, borderRadius: 12, boxShadow: "none" }}
                      >
                        <DownloadIcon fontSize="small" />
                      </IconBtn>
                    )}
                    <IconBtn
                      title="Delete"
                      disabled={isGenerating}
                      onClick={() => onDeleteSong(s.id)}
                      style={{
                        width: 36, height: 36, borderRadius: 12, boxShadow: "none",
                        borderColor: isGenerating ? t.hairline : "rgba(255,59,48,0.35)",
                        color: isGenerating ? t.subtext : t.danger,
                      }}
                    >
                      <DeleteIcon fontSize="small" />
                    </IconBtn>
                  </div>
                </div>

                {assets && (
                  <div style={{ marginTop: 10 }}>
                    <Segmented
                      value={selectedAssetKey}
                      onChange={(v) => onSelectAsset(s.id, v)}
                      options={SONG_ASSET_KEYS.map((k) => ({
                        value: k,
                        label: SONG_ASSET_LABELS[k],
                        disabled: !isAssetReady(assets?.[k]),
                      }))}
                    />
                  </div>
                )}

                {isGenerating && (
                  <div style={{ marginTop: 12 }}>
                    <ProgressBar value={s.progress || 0} />
                  </div>
                )}

                {!isGenerating && <Wave active={active} />}
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
});
