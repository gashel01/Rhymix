import React, { useRef, useCallback, useMemo, useEffect, useState } from "react";
import { Tooltip } from "@mui/material";
import ErrorIcon from "@mui/icons-material/Error";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import KeyboardArrowRightIcon from "@mui/icons-material/KeyboardArrowRight";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import StarIcon from "@mui/icons-material/Star";
import StarBorderIcon from "@mui/icons-material/StarBorder";

// keep existing local components (NOT changing icons)
import TextOverflow from "../TextOverflow.tsx";
import WaveformCell from "./WaveformCell";
import TrackControls from "./TrackControls";
import { getFileNameFromPath } from "./utils";
import { getBaseNameAndExt, makeDownloadName } from "../../utils/audioUtils";

const STYLE_ID = "vf-audiotrackrow-css-v2";

const AudioTrackRow = (props) => {
  const {
    pair,
    index,
    vocalMode,
    vocalModeType,
    vocalsFileType,
    isInstrumentalPlaying,
    isVocalPlaying,
    internalMutedInstrumentals,
    internalMutedVocals,
    volume,
    name,
    isSelected,
    onRowSelect,
    modelUsed,
    handlePlayPauseModified,
    handlePlayBothModified,
    handleDownload,
    handleDownloadFullSong,
    handleInstrumentalWaveformReady,
    handleVocalWaveformReady,
    playingBoth,
    status = "completed",
    style,
    isNew = false,
    paramsSummary,
    createdAt,
    processing,
    groupKey,
    isGroupHeader = false,
    isGroupExpanded = false,
    isGroupedVersion = false,
    versionCount = 0,
    favoriteCount = 0,
    isFavorite = false,
    onToggleGroup,
    onToggleFavorite,
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
        grid-template-columns: 50px minmax(280px, 1fr) 60px minmax(280px, 1fr) 50px;
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
      waveColor: isDark ? "rgba(255,255,255,0.92)" : "#1C1C1E",
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
  const trackPairId = pair?.id || `${getFileNameFromPath(instPath)}-${getFileNameFromPath(vocalPath)}`;
  const instrumentalKey = pair?.instrumentalKey || `${trackPairId}-instrumental`;
  const vocalKey = pair?.vocalKey || `${trackPairId}-vocal`;
  const isCurrentlyPlayingBoth = Boolean(playingBoth && playingBoth.id === trackPairId);

  // Sync vocal position with instrumental when vocal ready
  const handleVocalReady = useCallback((wf) => {
    vwRef.current = wf;
    const key = vocalKey;
    handleVocalWaveformReady?.(key, wf);
    if (iwRef.current?.getCurrentTime) {
      const instTime = iwRef.current.getCurrentTime();
      if (instTime > 0 && wf?.setCurrentTime) wf.setCurrentTime(instTime);
    }
  }, [vocalKey, handleVocalWaveformReady]);

  const handleInstReady = useCallback((wf) => {
    iwRef.current = wf;
    const key = instrumentalKey;
    handleInstrumentalWaveformReady?.(key, wf);
  }, [instrumentalKey, handleInstrumentalWaveformReady]);

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

  const ProcessingPill = ({ label, tone }) => (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "4px 8px",
        borderRadius: 8,
        fontSize: 10,
        fontWeight: 800,
        letterSpacing: 0.3,
        color: tone?.fg || t.primary,
        background: tone?.bg || (t.isDark ? "rgba(10,132,255,0.22)" : "rgba(0,122,255,0.12)"),
        border: `1px solid ${t.hairline}`,
      }}
    >
      {label}
    </span>
  );

  const MetaPill = ({ children }) => (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "4px 8px",
        borderRadius: 8,
        fontSize: 10,
        fontWeight: 800,
        letterSpacing: 0.3,
        color: t.subtext,
        background: t.isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
        border: `1px solid ${t.hairline}`,
        width: "fit-content",
      }}
    >
      {children}
    </span>
  );

  const processingState = processing?.state;
  const isProcessingRow = processingState && processingState !== "ready";
  const processingLabelMap = {
    queued: "Queued",
    uploading: "Uploading",
    processing: "Processing",
    error: "Error",
  };
  const processingLabel = processingLabelMap[processingState] || "Processing";
  const processingTone =
    processingState === "error"
      ? { fg: t.danger, bg: t.isDark ? "rgba(255,59,48,0.2)" : "rgba(255,59,48,0.12)" }
      : { fg: t.primary, bg: t.isDark ? "rgba(10,132,255,0.2)" : "rgba(0,122,255,0.12)" };
  const processingParts = [];
  if (processing?.message) processingParts.push(processing.message);
  if (processing?.step && processing.step !== processing?.message) processingParts.push(`Step: ${processing.step}`);
  if (typeof processing?.progress === "number") processingParts.push(`Progress: ${processing.progress}%`);
  const processingTooltip = processingParts.length ? processingParts.join(" | ") : processingLabel;

  const handleInstrumentalPlayPause = useCallback(() => {
    handlePlayPauseModified("instrumental", instPath, { instrumental: iwRef.current, vocal: vwRef.current });
  }, [handlePlayPauseModified, instPath]);

  const handleVocalPlayPause = useCallback(() => {
    handlePlayPauseModified(vocalsFileType, vocalPath, { instrumental: iwRef.current, vocal: vwRef.current });
  }, [handlePlayPauseModified, vocalPath, vocalsFileType]);

  const handleInstrumentalDownload = useCallback(() => {
    const { baseName, ext } = getBaseNameAndExt({
      originalName: pair?.originalName,
      displayName: pair?.displayName || name,
    });
    const downloadName = makeDownloadName({ baseName, type: "instrumental", ext });
    handleDownload("instrumental", instPath, downloadName);
  }, [handleDownload, instPath, name, pair?.displayName, pair?.originalName]);

  const handleVocalDownload = useCallback(() => {
    const { baseName, ext } = getBaseNameAndExt({
      originalName: pair?.originalName,
      displayName: pair?.displayName || name,
    });
    const isConverted = vocalMode === "converted";
    const namingType = vocalModeType === "inference" ? "raw_vocal" : pair?.vocalFileType || vocalsFileType || "processed_vocals";
    const vocalType = isConverted ? "converted" : namingType;
    const downloadName = makeDownloadName({
      baseName,
      type: vocalType,
      modelName: pair?.modelName || modelUsed,
      ext,
    });
    const fileType = isConverted ? "inference" : pair?.vocalFileType || vocalsFileType;
    handleDownload(fileType, vocalPath, downloadName);
  }, [handleDownload, modelUsed, name, pair?.displayName, pair?.modelName, pair?.originalName, pair?.vocalFileType, vocalMode, vocalModeType, vocalPath, vocalsFileType]);

  const [isMerging, setIsMerging] = useState(false);
  const canMerge = Boolean(instPath && vocalPath);
  const downloadDisabledReason = !instPath
    ? "Instrumental missing"
    : !vocalPath
    ? "Vocal missing"
    : null;

  const handleDownloadMerged = useCallback(async () => {
    if (!handleDownloadFullSong || isMerging || !canMerge) return;
    const { baseName, ext } = getBaseNameAndExt({
      originalName: pair?.originalName,
      displayName: pair?.displayName || name,
    });
    const isConverted = vocalMode === "converted";
    const mergedModelName = isConverted ? (pair?.modelName || modelUsed || "model") : "original";
    const downloadName = makeDownloadName({
      baseName,
      type: "merged",
      modelName: mergedModelName,
      ext,
    });
    const vocalType = isConverted ? "inference" : pair?.vocalFileType || vocalsFileType || "raw_vocals";
    const instrumentalPayload = { type: "instrumental", id: instPath };
    const vocalPayload = { type: vocalType, id: vocalPath };

    setIsMerging(true);
    try {
      await handleDownloadFullSong({
        instrumental: instrumentalPayload,
        vocal: vocalPayload,
        downloadName,
        format: ext,
      });
    } finally {
      setIsMerging(false);
    }
  }, [
    canMerge,
    handleDownloadFullSong,
    instPath,
    isMerging,
    modelUsed,
    name,
    pair?.displayName,
    pair?.modelName,
    pair?.originalName,
    pair?.vocalFileType,
    vocalMode,
    vocalPath,
    vocalsFileType,
  ]);

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

    // Deterministic URLs only – no pair.instrumentalUrl/vocalUrl fallback (avoids instrumental remount on vocal mode change)
    const url =
      type === "inst"
        ? pair?.instrumentalUrl || `/api/download/instrumental/${path}`
        : pair?.vocalUrl || `/api/download/${vocalsFileType}/${path}`;

    // Instrumental key: file identity only (never changes with vocal mode). Vocal key: file + variant (remounts only vocal).
    const stableKey =
      type === "inst"
        ? `inst:${getFileNameFromPath(path)}`
        : `vocal:${vocalsFileType}:${getFileNameFromPath(path)}`;

    return (
      <WaveformCell
        key={stableKey}
        url={url}
        isPlaying={isPlaying}
        isMuted={isMuted}
        volume={volume}
        waveColor={t.waveColor}
        progressColor={color}
        onPlayPause={type === "inst" ? handleInstrumentalPlayPause : handleVocalPlayPause}
        onDownload={type === "inst" ? handleInstrumentalDownload : handleVocalDownload}
        onReady={type === "inst" ? handleInstReady : handleVocalReady}
        onSeek={onSeek}
        badgeText={type === "vocal" ? vocalMode : null}
        otherWaveform={type === "vocal" ? iwRef.current : undefined}
      />
    );
  };

  const displayName = name || `Track ${index + 1}`;
  const actionsDisabled = status === "processing" || status === "failed";
  const canToggleFavorite = Boolean(onToggleFavorite && pair?.runId);
  const handleFavoriteClick = useCallback(() => {
    if (!pair?.runId) return;
    onToggleFavorite?.(pair.runId, !isFavorite);
  }, [onToggleFavorite, pair?.runId, isFavorite]);

  const handleGroupToggle = useCallback(() => {
    if (!groupKey) return;
    onToggleGroup?.(groupKey);
  }, [groupKey, onToggleGroup]);

  const runTimestamp =
    isGroupedVersion && createdAt && !Number.isNaN(Date.parse(createdAt))
      ? new Date(createdAt).toLocaleString()
      : null;

  return (
    <tr style={{ ...style }}>

      {/* Waveforms + controls + bare checkbox */}
      <td style={{ borderBottom: `1px solid ${t.hairline}`, padding: "5px 10px 10px 10px", position: "relative" }}>
        {/* Name */}
        <div style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 6, paddingLeft: isGroupedVersion ? 14 : 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
            {isGroupHeader && (
              <button
                type="button"
                onClick={handleGroupToggle}
                aria-label={isGroupExpanded ? "Collapse group" : "Expand group"}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 22,
                  height: 22,
                  borderRadius: 6,
                  border: `1px solid ${t.hairline}`,
                  background: t.isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)",
                  color: t.text,
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                {isGroupExpanded ? <KeyboardArrowDownIcon style={{ fontSize: 18 }} /> : <KeyboardArrowRightIcon style={{ fontSize: 18 }} />}
              </button>
            )}
            {isGroupedVersion && (
              <span style={{ fontSize: 12, fontWeight: 800, color: t.subtext }}>{">"}</span>
            )}
            <TextOverflow
              text={displayName}
              style={{ fontWeight: 700, letterSpacing: -0.2, color: t.text, display: "flex", alignItems: "center" }}
            />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            {isGroupHeader && versionCount > 1 && <MetaPill>{versionCount} versions</MetaPill>}
            {isGroupHeader && favoriteCount > 0 && <MetaPill>{favoriteCount} fav</MetaPill>}
            {isProcessingRow && (
              <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <ProcessingPill label={processingLabel} tone={processingTone} />
                <Tooltip title={processingTooltip} placement="top">
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      color: t.subtext,
                      cursor: "help",
                    }}
                  >
                    <InfoOutlinedIcon style={{ fontSize: 16 }} />
                  </span>
                </Tooltip>
              </div>
            )}
            {isNew && (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  padding: "4px 8px",
                  borderRadius: 8,
                  fontSize: 10,
                  fontWeight: 800,
                  letterSpacing: 0.3,
                  color: t.primary,
                  background: t.isDark ? "rgba(0,122,255,0.2)" : "rgba(0,122,255,0.12)",
                  border: `1px solid ${t.hairline}`,
                }}
              >
                New
              </span>
            )}
            {modelUsed && <Pill>{modelUsed}</Pill>}
            {canToggleFavorite && (
              <button
                type="button"
                onClick={handleFavoriteClick}
                title={isFavorite ? "Unfavorite" : "Favorite"}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 26,
                  height: 26,
                  borderRadius: 8,
                  border: `1px solid ${t.hairline}`,
                  background: t.isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)",
                  color: isFavorite ? "#f5c542" : t.subtext,
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                {isFavorite ? <StarIcon style={{ fontSize: 16 }} /> : <StarBorderIcon style={{ fontSize: 16 }} />}
              </button>
            )}
          </div>
        </div>
        {(paramsSummary || runTimestamp) && (
          <div style={{ marginTop: 4, fontSize: 11, fontWeight: 600, color: t.subtext }}>
            {paramsSummary}
            {runTimestamp ? (paramsSummary ? ` • ${runTimestamp}` : runTimestamp) : ""}
          </div>
        )}

        <div >
          <div className="atr-grid" style={{ marginTop: "10px" }}>

            <div className="atr-inst" style={{ padding: "5px 0px" }}>

            </div>

            {/* Instrumental */}
            <div className="atr-inst" style={{ backgroundColor: "rgba(0,0,0,0.3)", borderRadius: 10, padding: "5px 0px" }}>



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
                onPlayBoth={() => handlePlayBothModified(trackPairId)}
                onDownloadFullSong={handleDownloadMerged}
                disabled={actionsDisabled}
                downloadDisabledReason={downloadDisabledReason}
                downloading={isMerging}
              />
            </div>

            {/* Vocal */}
            <div className="atr-vocal" style={{ backgroundColor: "rgba(0,0,0,0.3)", borderRadius: 10, padding: "5px 0px" }}>
              {renderWaveform(
                "vocal",
                vocalPath,
                isVocalPlaying,
                internalMutedVocals?.[vocalPath],
                "#1976d2",
                handleVocalSeek
              )}

            </div>
            <div style={{ display: "flex", justifyContent: "center", alignItems: "center" }}>
              <input
                type="checkbox"
                checked={!!isSelected}
                onChange={(e) => onRowSelect?.(pair.id, e.target.checked)}
                disabled={actionsDisabled}
                title={
                  actionsDisabled
                    ? "Available when processing completes"
                    : isSelected
                      ? "Deselect row"
                      : "Select row"
                }
                style={{

                  width: 16,
                  height: 16,
                  accentColor: t.primary,
                  cursor: actionsDisabled ? "not-allowed" : "pointer",
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  opacity: actionsDisabled ? 0.5 : 1,
                }}
              />
            </div>

          </div>
          {/* Bare checkbox (no container styling) */}

        </div>
      </td>
    </tr>
  );
};

const areEqual = (prev, next) =>
  prev.pair === next.pair &&
  prev.index === next.index &&
  prev.vocalMode === next.vocalMode &&
  prev.vocalModeType === next.vocalModeType &&
  prev.vocalsFileType === next.vocalsFileType &&
  prev.isInstrumentalPlaying === next.isInstrumentalPlaying &&
  prev.isVocalPlaying === next.isVocalPlaying &&
  prev.internalMutedInstrumentals === next.internalMutedInstrumentals &&
  prev.internalMutedVocals === next.internalMutedVocals &&
  prev.volume === next.volume &&
  prev.name === next.name &&
  prev.isSelected === next.isSelected &&
  prev.modelUsed === next.modelUsed &&
  prev.handlePlayPauseModified === next.handlePlayPauseModified &&
  prev.handlePlayBothModified === next.handlePlayBothModified &&
  prev.handleInstrumentalWaveformReady === next.handleInstrumentalWaveformReady &&
  prev.handleVocalWaveformReady === next.handleVocalWaveformReady &&
  prev.handleDownload === next.handleDownload &&
  prev.handleDownloadFullSong === next.handleDownloadFullSong &&
  prev.playingBoth === next.playingBoth &&
  prev.status === next.status &&
  prev.onRowSelect === next.onRowSelect &&
  prev.style === next.style &&
  prev.isNew === next.isNew &&
  prev.paramsSummary === next.paramsSummary &&
  prev.createdAt === next.createdAt &&
  prev.groupKey === next.groupKey &&
  prev.isGroupHeader === next.isGroupHeader &&
  prev.isGroupExpanded === next.isGroupExpanded &&
  prev.isGroupedVersion === next.isGroupedVersion &&
  prev.versionCount === next.versionCount &&
  prev.favoriteCount === next.favoriteCount &&
  prev.isFavorite === next.isFavorite &&
  prev.processing === next.processing &&
  prev.onToggleGroup === next.onToggleGroup &&
  prev.onToggleFavorite === next.onToggleFavorite;

export default React.memo(AudioTrackRow, areEqual);
