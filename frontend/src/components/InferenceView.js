import React, { useState, useEffect, useRef, useMemo, useCallback, memo } from "react";
import { useVolume } from "../contexts/VolumeContext";

// keep your existing icon set (NOT changing icons)
import AudioFileIcon from "@mui/icons-material/AudioFile";
import PsychologyIcon from "@mui/icons-material/Psychology";
import CloseIcon from "@mui/icons-material/Close";

import AudioTrackTable from "./AudioTrackTable/AudioTrackTable";
import ErrorBoundary from "./ErrorBoundary";
import { useAudioPlayback } from "./InferenceView/useAudioPlayback";

function InferenceView({ onNavigate, darkMode }) {
  const { volumeRef } = useVolume();
  // ---------- Theme tokens (same “new style”) ----------
  const isDark = useMemo(() => {
    if (typeof darkMode === "boolean") return darkMode;
    if (typeof window === "undefined") return false;
    return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ?? false;
  }, [darkMode]);

  const t = useMemo(() => {
    const pageBg = isDark ? "#0B0B0F" : "#F4F5F7";
    const surfaceA = isDark ? "rgba(22,22,26,0.72)" : "rgba(255,255,255,0.74)";
    const surfaceB = isDark ? "rgba(28,28,34,0.62)" : "rgba(250,250,252,0.78)";
    const cardA = isDark ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.86)";
    const cardB = isDark ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.72)";

    return {
      isDark,
      pageBg,
      text: isDark ? "rgba(255,255,255,0.92)" : "rgba(0,0,0,0.90)",
      subtext: isDark ? "rgba(255,255,255,0.62)" : "rgba(0,0,0,0.55)",
      hairline: isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.10)",
      glassA: surfaceA,
      glassB: surfaceB,
      cardA,
      cardB,
      shadow: isDark ? "0 18px 44px rgba(0,0,0,0.60)" : "0 18px 46px rgba(0,0,0,0.12)",
      shadowSoft: isDark ? "0 10px 24px rgba(0,0,0,0.45)" : "0 12px 26px rgba(0,0,0,0.10)",
      primary: isDark ? "rgba(10,132,255,1)" : "rgba(0,122,255,1)",
      primaryWash: isDark ? "rgba(10,132,255,0.20)" : "rgba(0,122,255,0.16)",
      radiusLg: 22,
      radiusMd: 16,
      maxW: 1400,
      stickyTop: 12,
      danger: "rgba(255,59,48,1)",
      dangerWash: isDark ? "rgba(255,59,48,0.20)" : "rgba(255,59,48,0.14)",
    };
  }, [isDark]);

  // ---------- UI primitives ----------
  const Glass = ({ children, style }) => (
    <div
      style={{
        borderRadius: t.radiusLg,
        border: `1px solid ${t.hairline}`,
        background: `linear-gradient(180deg, ${t.glassA}, ${t.glassB})`,
        backdropFilter: "blur(22px) saturate(140%)",
        WebkitBackdropFilter: "blur(22px) saturate(140%)",
        boxShadow: t.shadow,
        ...style,
      }}
    >
      {children}
    </div>
  );

  const Panel = ({ children, style }) => (
    <div
      style={{
        borderRadius: t.radiusLg,
        border: `1px solid ${t.hairline}`,
        background: `linear-gradient(180deg, ${t.cardA}, ${t.cardB})`,
        // backdropFilter: "blur(18px) saturate(140%)",
        // WebkitBackdropFilter: "blur(18px) saturate(140%)",
        boxShadow: t.shadowSoft,
        padding: 18,
        ...style,
      }}
    >
      {children}
    </div>
  );

  const Btn = ({ children, onClick, variant = "secondary", disabled, style, type = "button", title }) => {
    const v = {
      primary: { bg: `linear-gradient(180deg, rgba(10,132,255,0.95), rgba(10,132,255,0.78))`, fg: "white", bd: "rgba(10,132,255,0.45)" },
      secondary: { bg: `linear-gradient(180deg, ${t.cardA}, ${t.cardB})`, fg: t.text, bd: t.hairline },
      outline: { bg: "transparent", fg: t.text, bd: t.hairline },
      danger: { bg: `linear-gradient(180deg, rgba(255,59,48,0.95), rgba(255,59,48,0.78))`, fg: "white", bd: "rgba(255,59,48,0.45)" },
    }[variant];

    return (
      <button
        type={type}
        title={title}
        onClick={onClick}
        disabled={disabled}
        style={{
          borderRadius: 14,
          border: `1px solid ${v.bd}`,
          background: v.bg,
          color: v.fg,
          padding: "10px 12px",
          fontWeight: 900,
          letterSpacing: -0.1,
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.55 : 1,
          boxShadow: disabled ? "none" : t.shadowSoft,
          transition: "transform 120ms ease, opacity 160ms ease",
          ...style,
        }}
        onMouseDown={(e) => {
          if (disabled) return;
          e.currentTarget.style.transform = "scale(0.985)";
        }}
        onMouseUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
        onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
      >
        {children}
      </button>
    );
  };

  const IconBtn = ({ onClick, title, children, disabled, style }) => (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled}
      style={{
        width: 40,
        height: 40,
        borderRadius: 14,
        border: `1px solid ${t.hairline}`,
        background: `linear-gradient(180deg, ${t.cardA}, ${t.cardB})`,
        color: t.text,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
        boxShadow: t.shadowSoft,
        ...style,
      }}
    >
      {children}
    </button>
  );

  const Spinner = ({ size = 18 }) => (
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

  const Alert = ({ kind = "error", children, onClose }) => {
    const isErr = kind === "error";
    return (
      <div
        style={{
          borderRadius: 16,
          border: `1px solid ${t.hairline}`,
          background: isErr ? t.dangerWash : t.primaryWash,
          padding: "10px 12px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          color: t.text,
          fontWeight: 800,
        }}
      >
        <div style={{ color: isErr ? t.danger : t.primary }}>{children}</div>
        {onClose && (
          <IconBtn
            onClick={onClose}
            title="Dismiss"
            style={{ width: 34, height: 34, boxShadow: "none" }}
          >
            <CloseIcon style={{ fontSize: 18 }} />
          </IconBtn>
        )}
      </div>
    );
  };

  // ---------- State ----------
  const [inferenceResults, setInferenceResults] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [selectedRows, setSelectedRows] = useState([]);
 

  const {
    pastInferenceTrackPairs,
  
    fetchInferenceResults,
  
    handleVocalModeChange,
    handleDownload,
    handleDownloadFullSong,
    handleConvertedWaveformReady,
    handleOriginalWaveformReady,
    instrumentalWaveforms,
    convertedWaveforms,
    originalWaveforms,
    

    vocalMode,
    handlePlayPause,
    playingFile,
    stopAllAudio,
  } = useAudioPlayback({inferenceResults, setLoading, setError, setInferenceResults});

  // Row selection
  const handleRowSelect = useCallback((resultId, isSelected) => {
    if (isSelected) setSelectedRows((prev) => [...prev, resultId]);
    else setSelectedRows((prev) => prev.filter((id) => id !== resultId));
  }, []);

  const handleSelectAllRows = useCallback(() => setSelectedRows(inferenceResults.map((r) => r.id)), [inferenceResults]);
  const handleDeselectAllRows = useCallback(() => setSelectedRows([]), []);

  // Navigation actions
  const handleReturnToModelSelection = useCallback(() => onNavigate?.("inference-model-selection"), [onNavigate]);
  const handleReturnToInferenceParams = useCallback(() => onNavigate?.("inference-params"), [onNavigate]);

  // ---------- UI states ----------
  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: t.pageBg, padding: "18px 0 32px 0" }}>
        <div style={{ padding: "0 16px", maxWidth: t.maxW, margin: "0 auto" }}>
          <Panel style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: 28 }}>
            <Spinner size={34} />
            <div style={{ marginTop: 12, fontSize: 14, fontWeight: 850, color: t.text }}>
              Loading inference results…
            </div>
            <div style={{ marginTop: 6, fontSize: 13, fontWeight: 650, color: t.subtext }}>
              This may take a few seconds.
            </div>
          </Panel>
        </div>

        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", padding: "18px 0 32px 0" }}>
      

        <div style={{ marginTop: 16 }}>
          {error && (
            <div style={{ marginBottom: 12 }}>
              <Alert kind="error" onClose={() => setError(null)}>
                {error}
              </Alert>
            </div>
          )}

          {inferenceResults.length === 0 ? (
            <Panel style={{ padding: 28 }}>
              <div style={{ textAlign: "center", padding: "26px 0" }}>
                <div
                  style={{
                    width: 84,
                    height: 84,
                    borderRadius: 999,
                    margin: "0 auto 14px auto",
                    display: "grid",
                    placeItems: "center",
                    border: `1px solid ${t.hairline}`,
                    background: t.isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.03)",
                  }}
                >
                  <AudioFileIcon style={{ fontSize: 40, opacity: 0.75, color: t.text }} />
                </div>

                <div style={{ fontSize: 18, fontWeight: 950, color: t.text }}>No Inference Results Yet</div>
                <div style={{ marginTop: 8, fontSize: 13, fontWeight: 650, color: t.subtext, maxWidth: 520, marginInline: "auto" }}>
                  Run your first voice inference using the models from the Models page. Your inference results will appear here.
                </div>

                <div style={{ marginTop: 16, display: "flex", justifyContent: "center" }}>
                  <Btn
                    variant="primary"
                    onClick={() => onNavigate?.("inference-model-selection")}
                    style={{ height: 44, padding: "0 16px" }}
                  >
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                      <PsychologyIcon style={{ fontSize: 18 }} />
                      Start Your First Inference
                    </span>
                  </Btn>
                </div>
              </div>
            </Panel>
          ) : (
          
                <ErrorBoundary>
                  <AudioTrackTable
                    trackPairs={pastInferenceTrackPairs}
                    vocalMode={vocalMode}
                    vocalModeType="inference"
                    handleVocalModeChange={handleVocalModeChange}
                    handlePlayPause={handlePlayPause}
                    handleDownload={handleDownload}
                    handleVocalWaveformReady={vocalMode === "converted" ? handleConvertedWaveformReady : handleOriginalWaveformReady}
                    playingFile={playingFile}
                    instrumentalWaveforms={instrumentalWaveforms}
                    vocalWaveforms={vocalMode === "converted" ? convertedWaveforms : originalWaveforms}
                    showVocalToggle={true}
                    enablePlayBoth={true}
                    vocalsFileType="inference"
                    showDatasetButton={false}
                    showInferenceButton={false}
                    stopAllAudio={stopAllAudio}
                    showInferenceResultsActions={true}
                    onReturnToModelSelection={handleReturnToModelSelection}
                    onReturnToInferenceParams={handleReturnToInferenceParams}
                    externalSelectedRows={selectedRows}
                    onRowSelect={handleRowSelect}
                    onSelectAll={handleSelectAllRows}
                    onDeselectAll={handleDeselectAllRows}
                    handleDownloadFullSong={handleDownloadFullSong}
                    defaultLabel=" "
                    volume={volumeRef.current}
                    header={  <div style={{ padding: 14 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                      <div
                        style={{
                          width: 52,
                          height: 52,
                          borderRadius: 16,
                          display: "grid",
                          placeItems: "center",
                          border: `1px solid ${t.hairline}`,
                          background: t.isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.03)",
                          flexShrink: 0,
                        }}
                      >
                        <AudioFileIcon style={{ color: t.text }} />
                      </div>
        
                      <div style={{ flex: "1 1 340px", minWidth: 240 }}>
                        <div style={{ fontSize: 26, fontWeight: 950, letterSpacing: -0.6, color: t.text, lineHeight: 1.1 }}>
                          Past Inference Results
                        </div>
                        <div style={{ marginTop: 4, fontSize: 13, fontWeight: 650, color: t.subtext }}>
                          View, play, and download your previous voice inference results.
                        </div>
                      </div>
        
                      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                        <Btn
                          variant="outline"
                          onClick={fetchInferenceResults}
                          style={{ height: 40, padding: "0 14px" }}
                          title="Refresh"
                        >
                          Refresh
                        </Btn>
                       
                      </div>
                    </div>
                  </div>}
                  />
                </ErrorBoundary>
            
          )}
        </div>

        <style>{`
          @keyframes spin{to{transform:rotate(360deg)}}
        `}</style>
     
    </div>
  );
}

// Memoize with custom comparison to ignore volume changes
// Volume is accessed via context ref, so it doesn't cause re-renders
export default memo(InferenceView, (prevProps, nextProps) => {
  return (
    prevProps.onNavigate === nextProps.onNavigate &&
    prevProps.darkMode === nextProps.darkMode
    // volume is intentionally excluded - accessed via context
  );
});
