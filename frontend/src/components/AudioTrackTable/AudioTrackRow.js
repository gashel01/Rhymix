import React, { useRef, useCallback, useEffect, useState } from "react";
import Select from "../common/Select";
import { Tooltip } from "@mui/material";
import ErrorIcon from "@mui/icons-material/ErrorOutlined";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDownOutlined";
import KeyboardArrowRightIcon from "@mui/icons-material/KeyboardArrowRightOutlined";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import MoreHorizIcon from "@mui/icons-material/MoreHorizOutlined";

// keep existing local components (NOT changing icons)
import TextOverflow from "../TextOverflow.tsx";
import WaveformCell from "./WaveformCell";
import TrackControls from "./TrackControls";
import { getFileNameFromPath } from "./utils";
import { getBaseNameAndExt, makeDownloadName } from "../../utils/audioUtils";
import { Theme } from "../Homeview/Theme";
import { Pill } from "../ModelView/Pill";
import { ThumbsUpIcon, ThumbsDownIcon, StarIcon, CornerDownRightIcon, ExternalLink, Fingerprint, SlidersHorizontal, Image, Trash2 } from "lucide-react";
import styles from "./AudioTrackRow.module.css";
import { trackGradient } from "../../utils/trackIdentity";

/* The played part of a waveform says which stem it is: orange for the
   instrumental, blue for the vocal. That is a legend the user already reads,
   and it is the same on Home and on Inference. It was previously written as
   Material's #ff9800 and #1976d2; these are the system equivalents.

   The unplayed part stays neutral, because the boundary between the two is
   the playhead — colour it as well and the waveform stops reporting
   progress at all. */
const STEM_COLORS = { instrumental: "#FF9F0A", vocal: "#0A84FF" };
const UNPLAYED_COLOR = "#9e9e9e";
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
    reaction = "none",
    reactionRunId = null,
    reactionPending = false,
    onToggleGroup,
    onSetReaction,
    onOpenStudio,
    darkMode,
    showPerFileVocalToggle = false,
    vocalPathOverride,
    vocalUrlOverride,
    vocalSourceOptions = [],
    selectedVocalSource,
    activeConvertedLabel,
    onVocalSourceChange,
    onMenuModelSelection,
    onMenuInferenceParams,
    onMenuCover,
    onMenuDelete,
  } = props;
  const { t } = Theme({ darkMode });



  // ---------- Refs ----------
  const iwRef = useRef(null);
  const vwRef = useRef(null);
  const menuRef = useRef(null);
  const [menuOpen, setMenuOpen] = useState(false);

  // Compatibility: Handle different schemas
  const instPath = pair?.instrumental || pair?.original || "";
  const vocalPath = vocalPathOverride || pair?.vocal || pair?.converted || "";
  const vocalUrl = vocalUrlOverride || pair?.vocalUrl || "";
  const trackPairId = pair?.id || `${getFileNameFromPath(instPath)}-${getFileNameFromPath(vocalPath)}`;
  const instrumentalKey = pair?.instrumentalKey || `${trackPairId}-instrumental`;
  const vocalKey = pair?.vocalKey || `${trackPairId}-vocal`;
  const isCurrentlyPlayingBoth = Boolean(playingBoth && playingBoth.id === trackPairId);
  const hasConvertedChoices = Array.isArray(vocalSourceOptions) && vocalSourceOptions.length > 0;
  const inferredOptions = hasConvertedChoices
    ? vocalSourceOptions
    : [{ value: "inferred", label: "Inferred" }];
  const selectedVocalValue =
    selectedVocalSource || (vocalMode === "original" ? "original" : inferredOptions?.[0]?.value || "inferred");
  const isOriginalVocal = selectedVocalValue === "original";
  const convertedSelection = String(
    isOriginalVocal
      ? inferredOptions[0]?.value || "inferred"
      : selectedVocalValue || inferredOptions[0]?.value || "inferred"
  );
  const convertedLabel =
    activeConvertedLabel ||
    inferredOptions.find((option) => String(option.value) === String(convertedSelection))?.label ||
    modelUsed ||
    "Inferred";
  const leftLaneLabel = "Instrumental";

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setMenuOpen(false);
      }
    };
    const onEsc = (event) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onEsc);
    };
  }, [menuOpen]);

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
  const SpinnerBar = ({ color = "#0A84FF" }) => (
    <div
      className={styles.spinnerBar}
      style={{
        border: `1px solid ${t.hairline}`,
        background: t.cardA,
      }}
      aria-label="Processing"
    >
      <div
        className={styles.spinnerShimmer}
        style={{
          mixBlendMode: t.isDark ? "screen" : "multiply",
        }}
      />
      <div
        className={styles.spinnerProgress}
        style={{
          background: color,
        }}
      />
    </div>
  );

  const FailedCell = () => (
    <div
      className={styles.failedCell}
      style={{
        border: `1px solid ${t.hairline}`,
        background: t.cardA,
      }}
      aria-label="Failed"
    >
      <ErrorIcon style={{ color: t.danger }} />
    </div>
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
    const namingType = vocalModeType === "inference" ? "raw_vocal" : vocalsFileType || pair?.vocalFileType || "processed_vocals";
    const vocalType = isConverted ? "converted" : namingType;
    const downloadName = makeDownloadName({
      baseName,
      type: vocalType,
      modelName: modelUsed || pair?.modelName,
      ext,
    });
    const fileType = isConverted ? "inference" : vocalsFileType || pair?.vocalFileType;
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
    const mergedModelName = isConverted ? (modelUsed || pair?.modelName || "model") : "original";
    const downloadName = makeDownloadName({
      baseName,
      type: "merged",
      modelName: mergedModelName,
      ext,
    });
    const vocalType = isConverted ? "inference" : vocalsFileType || pair?.vocalFileType || "raw_vocals";
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

  const normaliseTitle = (title) => {

    // remove all special characters and replace with space . start with uppercase . remove file extension .mp3 .mp4 .wav etc.
    let normalisedTitle = title.replace(/[^a-zA-Z0-9]/g, " ").toLowerCase();
    normalisedTitle = normalisedTitle.charAt(0).toUpperCase() + normalisedTitle.slice(1);
    normalisedTitle = normalisedTitle.replace(/.mp3$/, "");
    normalisedTitle = normalisedTitle.replace(/.mp4$/, "");
    normalisedTitle = normalisedTitle.replace(/.wav$/, "");
    normalisedTitle = normalisedTitle.replace(/.m4a$/, "");
    normalisedTitle = normalisedTitle.replace(/.ogg$/, "");
    normalisedTitle = normalisedTitle.replace(/.flac$/, "");
    normalisedTitle = normalisedTitle.replace(/.aac$/, "");
    normalisedTitle = normalisedTitle.replace(/.wma$/, "");
    return normalisedTitle;
  };

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
        : vocalUrl || pair?.vocalUrl || `/api/download/${vocalsFileType}/${path}`;

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
        // Grey is the unplayed part. Tinting it as well destroyed the one
        // thing the waveform was saying: how far through the track you are.
        waveColor={UNPLAYED_COLOR}
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
  const effectiveReactionRunId = reactionRunId || pair?.runId || null;
  const canSetReaction = Boolean(onSetReaction && effectiveReactionRunId);
  const currentReaction = reaction || "none";
  const reactionDisabled = actionsDisabled || reactionPending || !canSetReaction;
  const handleReactionClick = useCallback(
    (value) => {
      if (!effectiveReactionRunId) return;
      const next = currentReaction === value ? "none" : value;
      onSetReaction?.(effectiveReactionRunId, next, currentReaction);
    },
    [currentReaction, effectiveReactionRunId, onSetReaction]
  );

  const ReactionButton = ({ value, label, icon }) => {
    const active = currentReaction === value;
    const iconColor = active ? t.flatIconActive : t.flatIconInactive;
    if (icon) {
      icon = React.cloneElement(icon, { stroke: iconColor, fill: iconColor, color: iconColor });
    }
    return (
      <Tooltip title={active ? `Clear ${label}` : `Set ${label}`} placement="top">
        <span>
          <button
            type="button"
            className={styles.reactionBtn}
            onClick={() => handleReactionClick(value)}
            disabled={reactionDisabled}
            aria-pressed={active}
            style={{
              background: active
                ? (t.isDark ? "rgba(0,194,255,0.14)" : "rgba(0,122,255,0.12)")
                : "transparent",
              color: active ? t.text : t.subtext,
              cursor: reactionDisabled ? "not-allowed" : "pointer",
              opacity: reactionDisabled ? 0.4 : 1,
            }}
          >
            {icon}
          </button>
        </span>
      </Tooltip>
    );
  };

  const handleGroupToggle = useCallback(() => {
    if (!groupKey) return;
    onToggleGroup?.(groupKey);
  }, [groupKey, onToggleGroup]);

  const runTimestamp =
    isGroupedVersion && createdAt && !Number.isNaN(Date.parse(createdAt))
      ? new Date(createdAt).toLocaleString()
      : null;
  const baseTimestamp =
    createdAt && !Number.isNaN(Date.parse(createdAt))
      ? new Date(createdAt).toLocaleString()
      : null;
  const metaLine = [paramsSummary, runTimestamp || baseTimestamp].filter(Boolean).join(" • ");

  return (
    <tr style={{ ...style }}>

      {/* Waveforms + controls + bare checkbox */}
      <td className={styles.tableCell}>
        <div
          className={styles.rowWrapper}
          style={{
            border: `1px solid ${isSelected ? t.primary : t.hairline}`,
            background: isSelected
              ? (t.isDark ? "rgba(24,24,31,0.92)" : "rgba(236,242,255,0.95)")
              : (t.isDark ? "rgba(20,20,26,0.72)" : t.cardA),
            boxShadow: isSelected
              ? (t.isDark ? "0 0 22px rgba(99,102,241,0.24)" : "0 10px 24px rgba(99,102,241,0.16)")
              : t.shadowSoft,
          }}
        >
          {/* Header */}
          <div className={styles.headerFlex} style={{ paddingLeft: isGroupedVersion ? 14 : 6 }}>
            <div className={styles.headerLeftFlex}>
              {vocalModeType !== "inference" && isGroupHeader && (
                <button
                  type="button"
                  onClick={handleGroupToggle}
                  aria-label={isGroupExpanded ? "Collapse group" : "Expand group"}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 20,
                    height: 20,
                    borderRadius: 6,
                    border: `1px solid ${t.hairline}`,
                    background: t.cardB,
                    color: t.text,
                    cursor: "pointer",
                    padding: 0,
                  }}
                >
                  {isGroupExpanded ? <KeyboardArrowDownIcon style={{ fontSize: 18 }} /> : <KeyboardArrowRightIcon style={{ fontSize: 18 }} />}
                </button>
              )}
              {vocalModeType !== "inference" && isGroupedVersion && (
                <span className={styles.cornerIcon} style={{ color: t.subtext }}><CornerDownRightIcon size={16} /></span>
              )}

              {/* The row's only piece of identity. A model card gets a whole
                  gradient header; a track row gets the same gradient in the
                  space it has. */}
              {!isGroupedVersion && (
                <span
                  aria-hidden="true"
                  style={{
                    flex: "none",
                    width: 26,
                    height: 26,
                    borderRadius: 8,
                    background: trackGradient(displayName),
                    boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.12)",
                  }}
                />
              )}
              <TextOverflow
                text={normaliseTitle(displayName)}
                className={styles.textOverflow}
                style={{ color: t.text }}
              />
            </div>
            <div className={styles.statusBadges}>


              {isGroupHeader && versionCount > 1 && <Pill tone="version" t={t} style={{ fontFamily: "Rubik", fontWeight: 500, borderRadius: "6px" }}>{versionCount} versions</Pill>}
              {isGroupHeader && favoriteCount > 0 && <Pill tone="favorite" t={t} style={{ fontFamily: "Rubik", fontWeight: 500, borderRadius: "6px" }}>{favoriteCount} fav</Pill>}
              {isProcessingRow && (
                <div className={styles.processingWrapper}>
                  <Pill t={t} tone="processing" style={{ fontFamily: "Rubik", fontWeight: 500, borderRadius: "6px" }}>{processingLabel}</Pill>
                  <Tooltip title={processingTooltip} placement="top">
                    <span className={styles.infoIconWrapper} style={{ color: t.subtext }}>
                      <InfoOutlinedIcon style={{ fontSize: 16 }} />
                    </span>
                  </Tooltip>
                </div>
              )}

              {isNew && (

                <Pill t={t} tone="new" style={{ borderRadius: "6px" }}>NEW</Pill>
              )}
              {vocalModeType === "inference" && versionCount > 1 && (
                <span style={{ fontSize: 10, fontWeight: 800, color: t.subtext, textTransform: "uppercase", letterSpacing: 0.7 }}>
                  {versionCount} versions
                </span>
              )}
              <div ref={menuRef} style={{ position: "relative" }}>
                <button
                  type="button"
                  aria-label="Row actions"
                  className={styles.menuToggleBtn}
                  onClick={() => setMenuOpen((prev) => !prev)}
                  style={{ color: t.subtext }}
                >
                  <MoreHorizIcon style={{ fontSize: 18 }} />
                </button>
                {menuOpen && (
                  <div
                    className={styles.menuDropdown}
                    style={{
                      border: `1px solid ${t.hairline}`,
                      background: t.isDark ? "rgba(24,24,28,0.98)" : t.cardA,
                      boxShadow: t.shadowSoft,
                    }}
                  >
                    <button
                      type="button"
                      disabled={!onOpenStudio || actionsDisabled}
                      className={styles.menuItemBtn}
                      onClick={() => {
                        setMenuOpen(false);
                        onOpenStudio?.(pair);
                      }}
                      style={{
                        color: t.text,
                        cursor: !onOpenStudio || actionsDisabled ? "not-allowed" : "pointer",
                        opacity: !onOpenStudio || actionsDisabled ? 0.5 : 1,
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                      }}
                    >
                      <ExternalLink size={16} /> Open in Studio
                    </button>
                    {onMenuModelSelection && (
                      <button
                        type="button"
                        className={styles.menuItemBtn}
                        onClick={() => {
                          setMenuOpen(false);
                          onMenuModelSelection();
                        }}
                        style={{
                          color: t.text,
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: 12,
                        }}
                      >
                        <Fingerprint size={16} /> Model Selection
                      </button>
                    )}
                    {onMenuInferenceParams && (
                      <button
                        type="button"
                        className={styles.menuItemBtn}
                        onClick={() => {
                          setMenuOpen(false);
                          onMenuInferenceParams();
                        }}
                        style={{
                          color: t.text,
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: 12,
                        }}
                      >
                        <SlidersHorizontal size={16} /> Inference Params
                      </button>
                    )}
                    {onMenuCover && (
                      <button
                        type="button"
                        className={styles.menuItemBtn}
                        onClick={() => {
                          setMenuOpen(false);
                          onMenuCover();
                        }}
                        style={{
                          color: t.text,
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: 12,
                        }}
                      >
                        <Image size={16} /> Cover
                      </button>
                    )}
                    {onMenuDelete && (
                      <button
                        type="button"
                        className={styles.menuItemBtn}
                        onClick={() => {
                          setMenuOpen(false);
                          onMenuDelete();
                        }}
                        style={{
                          color: t.isDark ? "rgba(255,95,87,0.98)" : "rgba(211,47,47,0.98)",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: 12,
                        }}
                      >
                        <Trash2 size={16} /> Delete
                      </button>
                    )}
                  </div>
                )}
              </div>

            </div>
          </div>
          {(metaLine || canSetReaction) && (
            <div className={styles.metaWrapper}>
              {metaLine && (
                <span className={styles.metaText} style={{ color: t.subtext }}>
                  {metaLine}
                </span>
              )}
              {canSetReaction && (
                <div className={styles.reactionsGroup}>
                  <ReactionButton value="like" label="Like" icon={<ThumbsUpIcon size={10} fill={t.flatIconActive} />} />
                  <ReactionButton value="dislike" label="Dislike" icon={<ThumbsDownIcon size={10} fill={t.flatIconActive} />} />
                  <ReactionButton value="favorite" label="Favorite" icon={<StarIcon size={10} fill={t.flatIconActive} />} />
                </div>
              )}
            </div>
          )}
          <div className={styles.divider} style={{ background: t.hairline }} />

          <div >
            <div className={`${styles.atrGrid} atr-grid`} style={{ marginTop: "10px" }}>

              <div className={`${styles.atrInst} atr-inst`} style={{ padding: "5px 0px" }}>

              </div>

              {/* Instrumental */}
              <div className={`${styles.atrInst} atr-inst`}>
                <div className={styles.laneHeader}>
                  <span className={styles.laneLabel} style={{ color: t.subtext }}>
                    {leftLaneLabel}
                  </span>
                </div>
                <div
                  className={styles.waveformWrapper}
                  style={{
                    background: t.isDark ? "rgba(10,12,20,0.72)" : t.cardB, // using cardB instead of darker
                    border: `1px solid ${t.hairline}`,
                  }}
                >
                  {renderWaveform(
                    "inst",
                    instPath,
                    isInstrumentalPlaying,
                    internalMutedInstrumentals?.[instPath],
                    STEM_COLORS.instrumental,
                    handleInstrumentalSeek
                  )}
                </div>
              </div>

              {/* Controls */}
              <div className="atr-controls" style={{ display: "flex", justifyContent: "center", alignItems: "center", boxSizing: "border-box", paddingTop: 32 }}>
                <TrackControls
                  instrumental={instPath}
                  vocal={vocalPath}
                  isPlaying={isCurrentlyPlayingBoth}
                  onPlayBoth={() => handlePlayBothModified(trackPairId)}
                  onDownloadFullSong={handleDownloadMerged}
                  disabled={actionsDisabled}
                  downloadDisabledReason={downloadDisabledReason}
                  downloading={isMerging}
                  darkMode={darkMode}
                />
              </div>

              {/* Vocal */}
              <div className="atr-vocal" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {showPerFileVocalToggle && onVocalSourceChange ? (
                  <div className={styles.vocalDropdownFlex}>
                    <span className={styles.laneLabel} style={{ color: t.subtext }}>
                      Vocals
                    </span>
                    <div
                      className={styles.vocalPillWrapper}
                      style={{
                        border: `1px solid ${t.hairline}`,
                        background: t.isDark ? "rgba(0,0,0,0.35)" : t.cardA,
                      }}
                    >
                      <button
                        type="button"
                        className={styles.vocalBtnBase}
                        onClick={() => onVocalSourceChange("original")}
                        style={{
                          background: isOriginalVocal ? (t.isDark ? "rgba(255,255,255,0.16)" : "rgba(0,0,0,0.08)") : "transparent",
                          color: isOriginalVocal ? t.text : t.subtext,
                        }}
                      >
                        original
                      </button>
                      {inferredOptions.length > 1 ? (
                        <Select
                          value={convertedSelection}
                          onChange={(next) => onVocalSourceChange(next)}
                          options={inferredOptions.map((option) => ({ value: option.value, label: option.label }))}
                          className={styles.vocalSelect}
                        />
                      ) : (
                        <button
                          type="button"
                          className={styles.vocalSingleBtn}
                          onClick={() => onVocalSourceChange(convertedSelection)}
                          style={{
                            background: !isOriginalVocal ? (t.isDark ? "rgba(10,132,255,0.75)" : "rgba(10,132,255,0.95)") : "transparent",
                            color: !isOriginalVocal ? "white" : t.subtext,
                          }}
                          title={convertedLabel}
                        >
                          {convertedLabel}
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className={styles.laneHeader}>
                    <span className={styles.laneLabel} style={{ color: t.subtext }}>
                      Vocals
                    </span>
                  </div>
                )}
                <div
                  className={styles.waveformWrapper}
                  style={{
                    background: t.isDark
                      ? (isOriginalVocal ? "rgba(10,12,20,0.72)" : "rgba(16,24,58,0.55)")
                      : (isOriginalVocal ? t.cardB : "rgba(240,245,255,0.96)"), // Light mode vocal backgrounds
                    border: `1px solid ${isOriginalVocal
                      ? t.hairline
                      : (t.isDark ? "rgba(56,139,253,0.42)" : "rgba(56,139,253,0.35)")
                      }`,
                  }}
                >
                  {renderWaveform(
                    "vocal",
                    vocalPath,
                    isVocalPlaying,
                    internalMutedVocals?.[vocalPath],
                    STEM_COLORS.vocal,
                    handleVocalSeek
                  )}
                </div>
              </div>
              <div className={styles.controlsWrapper}>
                <button
                  type="button"
                  disabled={actionsDisabled}
                  className={styles.checkboxBtn}
                  onClick={() => onRowSelect?.(pair.id, !isSelected)}
                  title={
                    actionsDisabled
                      ? "Available when processing completes"
                      : isSelected
                        ? "Deselect row"
                        : "Select row"
                  }
                  style={{
                    border: `2px solid ${isSelected ? t.primary : (t.isDark ? "rgba(255,255,255,0.34)" : "rgba(0,0,0,0.22)")}`,
                    background: isSelected
                      ? (t.isDark ? "rgba(56,139,253,0.28)" : "rgba(56,139,253,0.18)")
                      : "transparent",
                    color: isSelected ? (t.isDark ? "white" : t.primary) : "transparent",
                    cursor: actionsDisabled ? "not-allowed" : "pointer",
                    opacity: actionsDisabled ? 0.5 : 1,
                  }}
                >
                  {isSelected ? "✓" : ""}
                </button>
              </div>

            </div>
            {/* Bare checkbox (no container styling) */}

          </div>
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
  prev.reaction === next.reaction &&
  prev.reactionRunId === next.reactionRunId &&
  prev.reactionPending === next.reactionPending &&
  prev.processing === next.processing &&
  prev.onToggleGroup === next.onToggleGroup &&
  prev.onSetReaction === next.onSetReaction &&
  prev.onOpenStudio === next.onOpenStudio &&
  prev.showPerFileVocalToggle === next.showPerFileVocalToggle &&
  prev.vocalPathOverride === next.vocalPathOverride &&
  prev.vocalUrlOverride === next.vocalUrlOverride &&
  prev.vocalSourceOptions === next.vocalSourceOptions &&
  prev.selectedVocalSource === next.selectedVocalSource &&
  prev.activeConvertedLabel === next.activeConvertedLabel &&
  prev.onVocalSourceChange === next.onVocalSourceChange &&
  prev.onMenuModelSelection === next.onMenuModelSelection &&
  prev.onMenuInferenceParams === next.onMenuInferenceParams &&
  prev.onMenuCover === next.onMenuCover &&
  prev.onMenuDelete === next.onMenuDelete;

export default React.memo(AudioTrackRow, areEqual);
