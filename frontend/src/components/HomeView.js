import React, { useState, useEffect, useMemo } from "react";

// keep your existing icon set (NOT changing icons)
import LibraryMusicIcon from "@mui/icons-material/LibraryMusic";
import VoiceChatIcon from "@mui/icons-material/VoiceChat";
import AddIcon from "@mui/icons-material/Add";
import CloseIcon from "@mui/icons-material/Close";

import AudioTrackTable from "./AudioTrackTable";
import ErrorBoundary from "./ErrorBoundary";
import TabPanel from "./common/TabPanel";
import { useAudioPlayback } from "../hooks/useAudioPlayback";
import { useVocalMode } from "../hooks/useVocalMode";
import { useAvailableFiles } from "../hooks/useAvailableFiles";
import { downloadFile } from "../utils/audioUtils";
import { getAvailableTalkingDatasets } from "../utils/apiService";

function HomeView({
  onCreateSingingDataset,
  onCreateTalkingDataset,
  onInferenceWithTracks,
  handleTrainWithDataset,
  darkMode,
}) {
  // ---------- Theme tokens (same “new style”) ----------
  const isDark = useMemo(() => {
    if (typeof darkMode === "boolean") return darkMode;
    if (typeof window === "undefined") return false;
    return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ?? false;
  }, [darkMode]);

  const t = useMemo(() => {
    return {
      isDark,
      pageBg: isDark ? "#0B0B0F" : "#F4F5F7",
      text: isDark ? "rgba(255,255,255,0.92)" : "rgba(0,0,0,0.90)",
      subtext: isDark ? "rgba(255,255,255,0.62)" : "rgba(0,0,0,0.55)",
      hairline: isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.10)",
      glassA: isDark ? "rgba(18,18,20,0.62)" : "rgba(255,255,255,0.72)",
      glassB: isDark ? "rgba(26,26,28,0.56)" : "rgba(248,248,250,0.78)",
      cardA: isDark ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.86)",
      cardB: isDark ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.72)",
      shadow: isDark ? "0 18px 44px rgba(0,0,0,0.60)" : "0 18px 46px rgba(0,0,0,0.12)",
      shadowSoft: isDark ? "0 10px 24px rgba(0,0,0,0.45)" : "0 12px 26px rgba(0,0,0,0.10)",
      primary: isDark ? "rgba(10,132,255,1)" : "rgba(0,122,255,1)",
      primaryWash: isDark ? "rgba(10,132,255,0.20)" : "rgba(0,122,255,0.16)",
      primaryWash2: isDark ? "rgba(10,132,255,0.10)" : "rgba(0,122,255,0.08)",
      success: "rgba(52,199,89,1)",
      successWash: isDark ? "rgba(52,199,89,0.18)" : "rgba(52,199,89,0.14)",
      radiusLg: 22,
      radiusMd: 16,
      maxW: 1400,
      stickyTop: 12,
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
        backdropFilter: "blur(18px) saturate(140%)",
        WebkitBackdropFilter: "blur(18px) saturate(140%)",
        boxShadow: t.shadowSoft,
        padding: 14,
        ...style,
      }}
    >
      {children}
    </div>
  );

  const Hairline = ({ style }) => <div style={{ height: 1, background: t.hairline, ...style }} />;

  const Btn = ({ children, onClick, variant = "secondary", disabled, style, type = "button", title }) => {
    const v = {
      primary: {
        bg: `linear-gradient(180deg, rgba(10,132,255,0.95), rgba(10,132,255,0.78))`,
        fg: "white",
        bd: "rgba(10,132,255,0.45)",
      },
      secondary: { bg: `linear-gradient(180deg, ${t.cardA}, ${t.cardB})`, fg: t.text, bd: t.hairline },
      outline: { bg: "transparent", fg: t.text, bd: t.hairline },
      success: {
        bg: `linear-gradient(180deg, rgba(52,199,89,0.95), rgba(52,199,89,0.78))`,
        fg: "white",
        bd: "rgba(52,199,89,0.45)",
      },
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

  const Modal = ({ open, onClose, title, children, footer }) => {
    if (!open) return null;
    return (
      <div
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 2000,
          background: t.isDark ? "rgba(0,0,0,0.55)" : "rgba(0,0,0,0.30)",
          display: "grid",
          placeItems: "center",
          padding: 16,
        }}
      >
        <Glass style={{ width: "100%", maxWidth: 560, padding: 14 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <div style={{ fontWeight: 950, letterSpacing: -0.3, color: t.text }}>{title}</div>
            <IconBtn onClick={onClose} title="Close" style={{ width: 36, height: 36, boxShadow: "none" }}>
              <CloseIcon style={{ fontSize: 18 }} />
            </IconBtn>
          </div>
          <Hairline style={{ margin: "10px 0 12px 0" }} />
          <div style={{ color: t.text }}>{children}</div>
          {footer && (
            <>
              <Hairline style={{ margin: "12px 0 10px 0" }} />
              <div style={{ display: "flex", justifyContent: "center", gap: 10, flexWrap: "wrap" }}>{footer}</div>
            </>
          )}
        </Glass>
      </div>
    );
  };

  const Segmented = ({ value, onChange, options }) => (
    <div
      style={{
        display: "inline-flex",
        padding: 4,
        borderRadius: 16,
        border: `1px solid ${t.hairline}`,
        background: `linear-gradient(180deg, ${t.cardA}, ${t.cardB})`,
        boxShadow: t.shadowSoft,
        gap: 6,
      }}
    >
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            style={{
              border: `1px solid ${active ? "rgba(10,132,255,0.45)" : "transparent"}`,
              background: active ? `linear-gradient(135deg, ${t.primaryWash}, ${t.primaryWash2})` : "transparent",
              color: t.text,
              borderRadius: 12,
              padding: "10px 12px",
              fontWeight: 900,
              letterSpacing: -0.1,
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              cursor: "pointer",
              minWidth: 160,
              justifyContent: "center",
            }}
          >
            {opt.icon}
            {opt.label}
          </button>
        );
      })}
    </div>
  );

  // ---------- Local state ----------
  const [talkingDatasets, setTalkingDatasets] = useState([]);
  const [activeTab, setActiveTab] = useState(0); // 0 singing / 1 talking
  const [createDatasetModalOpen, setCreateDatasetModalOpen] = useState(false);

  // ---------- Hooks (unchanged logic) ----------
  const { availableFiles, rawVocals, loading } = useAvailableFiles();

  const { vocalMode, handleVocalModeChange, vocalsFileType } = useVocalMode("raw");

  const {
    playingFile,
    playingBoth,
    instrumentalWaveforms,
    vocalWaveforms,
    handlePlayPause,
    handlePlayBoth,
    handleInstrumentalWaveformReady,
    handleVocalWaveformReady,
    stopAllAudio,
  } = useAudioPlayback();

  // ---------- Handlers ----------
  const handleCreateDatasetClick = () => setCreateDatasetModalOpen(true);
  const handleCreateDatasetModalClose = () => setCreateDatasetModalOpen(false);

  const handleCreateSingingDataset = () => {
    setCreateDatasetModalOpen(false);
    onCreateSingingDataset?.();
  };

  const handleCreateTalkingDataset = () => {
    setCreateDatasetModalOpen(false);
    onCreateTalkingDataset?.();
  };

  const handleDownload = async (fileType, filePath) => {
    await downloadFile(fileType, filePath, vocalMode);
  };

  const handleVocalModeChangeWithCleanup = (event, newMode) => {
    if (newMode !== null) {
      stopAllAudio();
      handleVocalModeChange(event, newMode);
    }
  };

  const getTrackPairs = () => {
    const sourceFiles = vocalMode === "processed" ? availableFiles : rawVocals;
    const isProcessed = vocalMode === "processed";

    return sourceFiles.map((pair, index) => ({
      instrumental: pair.instrumentalPath ? pair.instrumentalPath.split("/").pop() : null,
      vocal: pair.vocalPath ? pair.vocalPath.split("/").pop() : null,
      name: pair.name,
      instrumentalUrl: pair.instrumentalUrl,
      vocalUrl: pair.vocalUrl,
      vocalMode,
      isProcessed,
      id: pair.id || pair.name || `${pair.instrumentalPath || ""}-${pair.vocalPath || ""}-${index}`,
    }));
  };

  // Fetch talking datasets on mount
  useEffect(() => {
    const fetchTalkingDatasets = async () => {
      try {
        const response = await getAvailableTalkingDatasets();
        if (response?.datasets) setTalkingDatasets(response.datasets);
      } catch (e) {
        console.error("Failed to fetch talking datasets:", e);
      }
    };
    fetchTalkingDatasets();
  }, []);

  // ---------- Render ----------
  return (
    <div style={{ minHeight: "100vh", padding: "18px 0 32px 0" }}>
      <div style={{ padding: "0 16px", maxWidth: t.maxW, margin: "0 auto" }}>
        {/* Sticky header */}
        <div style={{ position: "sticky", top: t.stickyTop, zIndex: 50 }}>
          <Glass style={{ padding: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 340px", minWidth: 240 }}>
                <div style={{ fontSize: 26, fontWeight: 950, letterSpacing: -0.6, color: t.text, lineHeight: 1.1 }}>
                  Your Data Files
                </div>
                <div style={{ marginTop: 4, fontSize: 13, fontWeight: 650, color: t.subtext }}>
                  Select files for training or inference, or create new datasets.
                </div>
              </div>

              <Btn
                variant="primary"
                onClick={handleCreateDatasetClick}
                style={{ height: 40, padding: "0 14px" }}
                title="Create Dataset"
              >
                <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                  <AddIcon style={{ fontSize: 18 }} />
                  Create Dataset
                </span>
              </Btn>
            </div>
          </Glass>
        </div>

        {/* Main */}
        <div style={{ marginTop: 16 }}>
          <Panel style={{ padding: 14 }}>
            {/* Dataset Toggle */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <Segmented
                value={activeTab}
                onChange={(v) => setActiveTab(v)}
                options={[
                  { value: 0, label: "Singing Data", icon: <LibraryMusicIcon style={{ fontSize: 18 }} /> },
                  { value: 1, label: "Talking Data", icon: <VoiceChatIcon style={{ fontSize: 18 }} /> },
                ]}
              />
              {/* optional right-side actions later */}
            </div>

            <Hairline style={{ margin: "14px 0" }} />

            {/* Singing Data Tab */}
            <TabPanel value={activeTab} index={0} sx={{ p: 0 }}>
              {loading ? (
                <div style={{ display: "grid", placeItems: "center", padding: "48px 12px", textAlign: "center" }}>
                  <Spinner size={34} />
                  <div style={{ marginTop: 12, fontSize: 14, fontWeight: 900, color: t.text }}>Loading singing data…</div>
                  <div style={{ marginTop: 6, fontSize: 13, fontWeight: 650, color: t.subtext }}>
                    Please wait while we fetch your audio files.
                  </div>
                </div>
              ) : (availableFiles?.length || 0) > 0 ? (
                <ErrorBoundary>
                  <div
                    style={{
                      borderRadius: t.radiusLg,
                      border: `1px solid ${t.hairline}`,
                      overflow: "hidden",
                      background: `linear-gradient(180deg, ${t.cardA}, ${t.cardB})`,
                    }}
                  >
                    <AudioTrackTable
                      trackPairs={getTrackPairs()}
                      vocalMode={vocalMode}
                      handleVocalModeChange={handleVocalModeChangeWithCleanup}
                      handlePlayPause={handlePlayPause}
                      handleDownload={handleDownload}
                      handlePlayBoth={handlePlayBoth}
                      handleInstrumentalWaveformReady={handleInstrumentalWaveformReady}
                      handleVocalWaveformReady={handleVocalWaveformReady}
                      playingFile={playingFile}
                      playingBoth={playingBoth}
                      instrumentalWaveforms={instrumentalWaveforms}
                      vocalWaveforms={vocalWaveforms}
                      showVocalToggle={true}
                      enablePlayBoth={true}
                      vocalsFileType={vocalsFileType}
                      showDatasetButton={false}
                      hasExports={(availableFiles?.length || 0) > 0}
                      stopAllAudio={stopAllAudio}
                      handleTrainWithDataset={handleTrainWithDataset}
                      showInferenceButton={true}
                      handleInferenceWithTracks={onInferenceWithTracks}
                    />
                  </div>
                </ErrorBoundary>
              ) : (
                <div style={{ textAlign: "center", padding: "44px 12px" }}>
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
                    <LibraryMusicIcon style={{ fontSize: 40, opacity: 0.75, color: t.text }} />
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 950, color: t.text }}>No Singing Data Files</div>
                  <div style={{ marginTop: 8, fontSize: 13, fontWeight: 650, color: t.subtext, maxWidth: 520, marginInline: "auto" }}>
                    Upload and process audio files to create singing datasets for voice training.
                  </div>

                  <div style={{ marginTop: 16, display: "flex", justifyContent: "center" }}>
                    <Btn variant="primary" onClick={handleCreateDatasetClick} style={{ height: 44, padding: "0 16px" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                        <AddIcon style={{ fontSize: 18 }} />
                        Create Singing Dataset
                      </span>
                    </Btn>
                  </div>
                </div>
              )}
            </TabPanel>

            {/* Talking Data Tab */}
            <TabPanel value={activeTab} index={1} sx={{ p: 0 }}>
              {(talkingDatasets?.length || 0) > 0 ? (
                <div style={{ textAlign: "center", padding: "44px 12px" }}>
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
                    <VoiceChatIcon style={{ fontSize: 40, opacity: 0.85, color: t.isDark ? t.success : t.success }} />
                  </div>

                  <div style={{ fontSize: 18, fontWeight: 950, color: t.text }}>Talking Datasets Available</div>
                  <div style={{ marginTop: 8, fontSize: 13, fontWeight: 650, color: t.subtext }}>
                    {talkingDatasets.length} talking dataset{talkingDatasets.length !== 1 ? "s" : ""} ready for training
                  </div>

                  <div style={{ marginTop: 16, display: "flex", justifyContent: "center" }}>
                    <Btn
                      variant="success"
                      onClick={() => onCreateTalkingDataset?.()}
                      style={{ height: 44, padding: "0 16px" }}
                    >
                      Manage Talking Datasets
                    </Btn>
                  </div>
                </div>
              ) : (
                <div style={{ textAlign: "center", padding: "44px 12px" }}>
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
                    <VoiceChatIcon style={{ fontSize: 40, opacity: 0.75, color: t.text }} />
                  </div>

                  <div style={{ fontSize: 18, fontWeight: 950, color: t.text }}>No Talking Data Files</div>
                  <div style={{ marginTop: 8, fontSize: 13, fontWeight: 650, color: t.subtext, maxWidth: 520, marginInline: "auto" }}>
                    Create talking datasets from conversation recordings for voice training.
                  </div>

                  <div style={{ marginTop: 16, display: "flex", justifyContent: "center" }}>
                    <Btn variant="primary" onClick={handleCreateDatasetClick} style={{ height: 44, padding: "0 16px" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                        <AddIcon style={{ fontSize: 18 }} />
                        Create Talking Dataset
                      </span>
                    </Btn>
                  </div>
                </div>
              )}
            </TabPanel>
          </Panel>
        </div>

        {/* Create Dataset Modal (no MUI) */}
        <Modal
          open={createDatasetModalOpen}
          onClose={handleCreateDatasetModalClose}
          title="Create New Dataset"
          footer={
            <>
              <Btn variant="outline" onClick={handleCreateDatasetModalClose} style={{ minWidth: 140 }}>
                Cancel
              </Btn>
            </>
          }
        >
          <div style={{ fontSize: 13, fontWeight: 700, color: t.subtext, marginBottom: 14 }}>
            Choose the type of dataset you want to create:
          </div>

          <div className="hv-cards">
            <button
              type="button"
              onClick={handleCreateSingingDataset}
              style={{
                textAlign: "left",
                borderRadius: t.radiusLg,
                border: `1px solid ${t.hairline}`,
                background: `linear-gradient(180deg, ${t.cardA}, ${t.cardB})`,
                boxShadow: t.shadowSoft,
                padding: 14,
                cursor: "pointer",
                color: t.text,
                display: "grid",
                gap: 6,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <div style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                  <LibraryMusicIcon style={{ fontSize: 26 }} />
                  <div style={{ fontSize: 16, fontWeight: 950, letterSpacing: -0.2 }}>Singing Dataset</div>
                </div>
                <div style={{ color: t.subtext, fontWeight: 900 }}>→</div>
              </div>
              <div style={{ fontSize: 13, fontWeight: 650, color: t.subtext }}>
                Process songs for voice training.
              </div>
            </button>

            <button
              type="button"
              onClick={handleCreateTalkingDataset}
              style={{
                textAlign: "left",
                borderRadius: t.radiusLg,
                border: `1px solid ${t.hairline}`,
                background: `linear-gradient(180deg, ${t.cardA}, ${t.cardB})`,
                boxShadow: t.shadowSoft,
                padding: 14,
                cursor: "pointer",
                color: t.text,
                display: "grid",
                gap: 6,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <div style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                  <VoiceChatIcon style={{ fontSize: 26 }} />
                  <div style={{ fontSize: 16, fontWeight: 950, letterSpacing: -0.2 }}>Talking Dataset</div>
                </div>
                <div style={{ color: t.subtext, fontWeight: 900 }}>→</div>
              </div>
              <div style={{ fontSize: 13, fontWeight: 650, color: t.subtext }}>
                Process conversations for voice training.
              </div>
            </button>
          </div>
        </Modal>

       
      </div>
    </div>
  );
}

export default HomeView;
