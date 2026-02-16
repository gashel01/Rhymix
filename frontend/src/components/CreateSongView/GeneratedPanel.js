import React, { useEffect, useMemo, useState } from "react";
import MusicNoteIcon from "@mui/icons-material/MusicNote";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import PauseIcon from "@mui/icons-material/Pause";
import DownloadIcon from "@mui/icons-material/Download";
import DeleteIcon from "@mui/icons-material/Delete";
import MicIcon from "@mui/icons-material/Mic";
import AudioWaveform from "../AudioWaveform";
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
  const { Panel, Spinner, Alert, IconBtn, Segmented, ProgressBar } = ui;
  const [page, setPage] = useState(1);
  const pageSize = 6;
  const totalPages = Math.max(1, Math.ceil(songs.length / pageSize));

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const visibleSongs = useMemo(() => {
    const start = (page - 1) * pageSize;
    return songs.slice(start, start + pageSize);
  }, [page, songs]);

  return (
    <Panel style={{ minHeight: 380, padding: 24 ,margin: "20px 20px 20px 0px"}}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
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
          {visibleSongs.map((s) => {
            const active = playingId === s.id;
            const assets = s.hasAssets ? s.assets || {} : null;
            const selectedAssetKey = assets ? s.selectedAssetKey || getBestAssetKey(assets) : null;
            const isAssetReadyNow = selectedAssetKey ? isAssetReady(assets?.[selectedAssetKey]) : false;
            const legacyReady = !!(s.vocalsUrl || s.instrumentalUrl || s.audioUrl);
            const isReady = assets ? isAssetReadyNow : legacyReady;
            const isGenerating = !isReady && s.status && s.status !== "failed";
            const isFailed = s.status === "failed";
            const durationStr = s.duration ? `${Math.floor(s.duration / 60)}:${String(s.duration % 60).padStart(2, "0")}` : "";
            const genreList = Array.isArray(s.genres) ? s.genres.filter(Boolean) : [];
            const genreLabel = genreList.length ? `Style: ${genreList.join(", ")}` : "";
            const personaLabel = (s.enhanceVocals && (s.personaName || s.modelName))
              ? `Persona: ${s.personaName || s.modelName}`
              : "";
            const extraMeta = [genreLabel, personaLabel].filter(Boolean).join(" · ");
            const fallbackAssetKey = assets ? getBestAssetKey(assets) : null;
            const assetKeyForUrl = isAssetReadyNow ? selectedAssetKey : fallbackAssetKey;
            const assetPath = assets && assetKeyForUrl && isAssetReady(assets?.[assetKeyForUrl])
              ? resolveAssetUrl(s, assetKeyForUrl)
              : null;
            const legacyPath = s.vocalsUrl || s.instrumentalUrl || s.audioUrl || null;
            const rawPath = assetPath || legacyPath;
            const waveformUrl = rawPath
              ? (rawPath.startsWith("http") ? rawPath : `${API_BASE}${rawPath}`)
              : null;

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
                    {extraMeta && !isGenerating && !isFailed && (
                      <div style={{ fontSize: 12, fontWeight: 600, color: t.subtext, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginTop: 4 }}>
                        {extraMeta}
                      </div>
                    )}
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

                {!isGenerating && (
                  <div style={{ marginTop: 12 }}>
                    <AudioWaveform
                      url={isReady ? waveformUrl : null}
                      isPlaying={active}
                      onRequestStop={() => onPlayPause(s)}
                      height={70}
                      showControls={false}
                      interactive={true}
                      minPxPerSec={1}
                      waveColor={t.isDark ? "rgba(255,255,255,0.28)" : "rgba(0,0,0,0.18)"}
                      progressColor={t.primary}
                      backgroundColor={t.isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)"}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {songs.length > 0 && totalPages > 1 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            style={{
              padding: "6px 10px",
              borderRadius: 10,
              border: `1px solid ${t.hairline}`,
              background: "transparent",
              color: page === 1 ? t.subtext : t.text,
              fontWeight: 700,
              cursor: page === 1 ? "not-allowed" : "pointer",
            }}
          >
            Prev
          </button>
          <div style={{ fontSize: 12, fontWeight: 700, color: t.subtext }}>
            Page {page} of {totalPages}
          </div>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            style={{
              padding: "6px 10px",
              borderRadius: 10,
              border: `1px solid ${t.hairline}`,
              background: "transparent",
              color: page === totalPages ? t.subtext : t.text,
              fontWeight: 700,
              cursor: page === totalPages ? "not-allowed" : "pointer",
            }}
          >
            Next
          </button>
        </div>
      )}
    </Panel>
  );
});
