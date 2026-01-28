import React, { useRef, useCallback, useMemo, useEffect } from "react";
import ErrorIcon from "@mui/icons-material/Error";

// keep existing local components (NOT changing icons)
import TextOverflow from "../TextOverflow.tsx";
import WaveformCell from "./WaveformCell";
import TrackControls from "./TrackControls";
import { getCleanFileName, getFileNameFromPath } from "./utils";

const STYLE_ID = "vf-audiotrackrow-css-v2";

const AudioTrackRow = (props) => {
  const {
    pair,
    index,
    vocalMode,
    vocalsFileType,
    isInstrumentalPlaying,
    isVocalPlaying,
    internalMutedInstrumentals,
    internalMutedVocals,
    volume,
    isSelected,
    onRowSelect,
    modelUsed,
    handlePlayPauseModified,
    handlePlayBothModified,
    handleDownload,
    playingBoth,
    status = "completed",
  } = props;

  // inject CSS once (don’t render <style> inside <tbody>)
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      @keyframes atr-shimmer {
        0% { transform: translateX(-60%); }
        100% { transform: translateX(60%); }
      }

      /* 3-column grid: instrumental | controls | vocal  */
      .atr-grid{
        display:grid;
        grid-template-columns: minmax(280px, 1fr) 74px minmax(280px, 1fr);
        gap: 10px;
        align-items: center;
        width: 100%;
      }

      /* keep side-by-side on most screens; stack only on small */
      @media (max-width: 900px){
        .atr-grid{
          grid-template-columns: 1fr;
        }
        .atr-controls{ order: 2; display:flex; justify-content:center; }
        .atr-inst{ order: 1; }
        .atr-vocal{ order: 3; }
      }
    `;
    document.head.appendChild(style);
  }, []);

  // ---------- Theme tokens ----------
  const t = useMemo(() => {
    const isDark =
      typeof window !== "undefined"
        ? window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ?? false
        : false;

    return {
      isDark,
      text: isDark ? "rgba(255,255,255,0.92)" : "rgba(0,0,0,0.90)",
      subtext: isDark ? "rgba(255,255,255,0.62)" : "rgba(0,0,0,0.55)",
      hairline: isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.10)",
      cardA: isDark ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.86)",
      cardB: isDark ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.72)",
      shadowSoft: isDark ? "0 10px 24px rgba(0,0,0,0.35)" : "0 12px 26px rgba(0,0,0,0.08)",
      primary: isDark ? "rgba(10,132,255,1)" : "rgba(0,122,255,1)",
      success: "rgba(52,199,89,1)",
      successWash: isDark ? "rgba(52,199,89,0.18)" : "rgba(52,199,89,0.14)",
      danger: "rgba(255,59,48,1)",
      radiusLg: 18,
    };
  }, []);

  // ---------- Refs ----------
  const iwRef = useRef(null);
  const vwRef = useRef(null);

  // Compatibility: Handle different schemas
  const instPath = pair?.instrumental || pair?.original || "";
  const vocalPath = pair?.vocal || pair?.converted || "";

  const trackPairId = `${getFileNameFromPath(instPath)}-${getFileNameFromPath(vocalPath)}`;
  const isCurrentlyPlayingBoth = Boolean(playingBoth && playingBoth.id === trackPairId);

  // Sync vocal position with instrumental when vocal ready
  const handleVocalReady = useCallback((wf) => {
    vwRef.current = wf;
    if (iwRef.current?.getCurrentTime) {
      const instTime = iwRef.current.getCurrentTime();
      if (instTime > 0 && wf?.setCurrentTime) wf.setCurrentTime(instTime);
    }
  }, []);

  const handleInstReady = useCallback((wf) => {
    iwRef.current = wf;
  }, []);

  // ---------- UI bits ----------
  const SpinnerBar = ({ color = "#1976d2" }) => (
    <div
      style={{
        width: "100%",
        height: 70,
        borderRadius: 10,
        border: `1px solid ${t.hairline}`,
        background: t.isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.03)",
        overflow: "hidden",
        position: "relative",
      }}
      aria-label="Processing"
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.18), transparent)",
          transform: "translateX(-40%)",
          animation: "atr-shimmer 1.2s ease-in-out infinite",
          mixBlendMode: t.isDark ? "screen" : "multiply",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: "36%",
          background: color,
          opacity: 0.22,
        }}
      />
    </div>
  );

  const FailedCell = () => (
    <div
      style={{
        height: 60,
        borderRadius: 10,
        border: `1px solid ${t.hairline}`,
        background: t.isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.03)",
        display: "grid",
        placeItems: "center",
      }}
      aria-label="Failed"
    >
      <ErrorIcon style={{ color: t.danger }} />
    </div>
  );

  const Pill = ({ children }) => (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "6px 9px",
        borderRadius: 10,
        fontSize: 11,
        fontWeight: 900,
        letterSpacing: 0.2,
        color: t.success,
        background: t.successWash,
        border: `1px solid ${t.hairline}`,
        width: "fit-content",
        marginTop: 8,
      }}
    >
      {children}
    </span>
  );

  const handleInstrumentalPlayPause = useCallback(() => {
    handlePlayPauseModified("instrumental", instPath, { instrumental: iwRef.current, vocal: vwRef.current });
  }, [handlePlayPauseModified, instPath]);

  const handleVocalPlayPause = useCallback(() => {
    handlePlayPauseModified(vocalsFileType, vocalPath, { instrumental: iwRef.current, vocal: vwRef.current });
  }, [handlePlayPauseModified, vocalPath, vocalsFileType]);

  const handleInstrumentalDownload = useCallback(() => {
    handleDownload("instrumental", instPath);
  }, [handleDownload, instPath]);

  const handleVocalDownload = useCallback(() => {
    handleDownload(vocalsFileType, vocalPath);
  }, [handleDownload, vocalPath, vocalsFileType]);

  const handleInstrumentalSeek = useCallback((time) => {
    vwRef.current?.setCurrentTime?.(time);
  }, []);

  const handleVocalSeek = useCallback((time) => {
    iwRef.current?.setCurrentTime?.(time);
  }, []);

  const renderWaveform = (type, path, isPlaying, isMuted, color, onSeek) => {
    if (status === "processing") return <SpinnerBar color={color} />;
    if (status === "failed") return <FailedCell />;
    if (!path) return <FailedCell />;

    const url =
      type === "inst"
        ? pair?.instrumentalUrl || `/api/download/instrumental/${path}`
        : pair?.vocalUrl || `/api/download/${vocalsFileType}/${path}`;

    return (
      <WaveformCell
        url={url}
        isPlaying={isPlaying}
        isMuted={isMuted}
        volume={volume}
        progressColor={color}
        onPlayPause={type === "inst" ? handleInstrumentalPlayPause : handleVocalPlayPause}
        onDownload={type === "inst" ? handleInstrumentalDownload : handleVocalDownload}
        onReady={type === "inst" ? handleInstReady : handleVocalReady}
        onSeek={onSeek}
        badgeText={type === "vocal" ? vocalMode : null}
      />
    );
  };

  const displayName = props?.name || getCleanFileName(props?.name) || `Track ${index + 1}`;

  return (
    <tr style={{ borderBottom: `1px solid ${t.hairline}` }}>
      {/* Name */}
      <td style={{ width: "18%", minWidth: 180, padding: 12, alignContent: "center" }}>
        <TextOverflow
          text={displayName}
          style={{ fontWeight: 900, letterSpacing: -0.2, color: t.text, display: "flex", alignItems: "center" }}
        />
        {modelUsed && <Pill>{modelUsed}</Pill>}
      </td>

      {/* Waveforms + controls + bare checkbox */}
      <td style={{ padding: 10, position: "relative" }}>
        <div
          style={{
            borderRadius: t.radiusLg,
            border: `1px solid ${t.hairline}`,
            background: `linear-gradient(180deg, ${t.cardA}, ${t.cardB})`,
            boxShadow: t.shadowSoft,
            padding: 10,
            position: "relative",
          }}
        >
          <div className="atr-grid" style={{ paddingRight: 42 }}>
            {/* Instrumental */}
            <div className="atr-inst">
              {renderWaveform(
                "inst",
                instPath,
                isInstrumentalPlaying,
                internalMutedInstrumentals?.[instPath],
                "#ff9800",
                handleInstrumentalSeek
              )}
            </div>

            {/* Controls */}
            <div className="atr-controls" style={{ display: "flex", justifyContent: "center" }}>
              <TrackControls
                instrumental={instPath}
                vocal={vocalPath}
                isPlaying={isCurrentlyPlayingBoth}
                onPlayBoth={() => handlePlayBothModified(instPath, vocalPath, vocalsFileType)}
                onDownloadFullSong={props.handleDownloadFullSong}
                disabled={status === "processing"}
              />
            </div>

            {/* Vocal */}
            <div className="atr-vocal">
              {renderWaveform(
                "vocal",
                vocalPath,
                isVocalPlaying,
                internalMutedVocals?.[vocalPath],
                "#1976d2",
                handleVocalSeek
              )}
            </div>
          </div>

          {/* Bare checkbox (no container styling) */}
          <input
            type="checkbox"
            checked={!!isSelected}
            onChange={(e) => onRowSelect?.(pair.id, e.target.checked)}
            title={isSelected ? "Deselect row" : "Select row"}
            style={{
              position: "absolute",
              right: 12,
              top: "50%",
              transform: "translateY(-50%)",
              width: 16,
              height: 16,
              accentColor: t.primary,
              cursor: "pointer",
              background: "transparent",
              border: "none",
              outline: "none",
            }}
          />
        </div>
      </td>
    </tr>
  );
};

export default AudioTrackRow;
