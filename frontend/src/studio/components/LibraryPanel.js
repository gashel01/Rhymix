import React, { useEffect, useMemo, useRef, useState } from "react";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import StopIcon from "@mui/icons-material/Stop";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import { ChevronDownIcon, SearchIcon } from "./StudioIcons";

const CATEGORY_ORDER = ["vocals", "drums", "bass", "music", "midi", "generated", "other"];

const CATEGORY_META = {
  vocals: { label: "Vocals", badge: "VOX" },
  drums: { label: "Drums", badge: "DRM" },
  bass: { label: "Bass", badge: "BAS" },
  music: { label: "Music", badge: "MUS" },
  midi: { label: "MIDI", badge: "MID" },
  generated: { label: "Generated", badge: "GEN" },
  other: { label: "Other", badge: "ETC" },
};

const getAssetCategory = (asset) => {
  const type = String(asset?.type || asset?.clipType || "").toLowerCase();
  const source = String(asset?.source || asset?.provider || "").toLowerCase();
  const text = `${asset?.label || ""} ${asset?.id || ""} ${asset?.name || ""}`.toLowerCase();
  if (type.includes("midi") || text.includes(".mid") || text.includes("midi")) return "midi";
  if (text.includes("vocal") || text.includes("vox") || text.includes("voice") || text.includes("acap")) return "vocals";
  if (text.includes("drum") || text.includes("kick") || text.includes("snare") || text.includes("hat") || text.includes("perc")) return "drums";
  if (text.includes("bass") || text.includes("sub")) return "bass";
  if (
    source.includes("foundation")
    || source.includes("stage")
    || source.includes("live_infer")
    || text.includes("generated")
    || text.includes("foundation")
    || text.includes("stage")
  ) {
    return "generated";
  }
  if (
    text.includes("music")
    || text.includes("inst")
    || text.includes("instrumental")
    || text.includes("keys")
    || text.includes("synth")
    || text.includes("guitar")
    || text.includes("piano")
    || text.includes("strings")
  ) {
    return "music";
  }
  return "other";
};

const formatAssetDuration = (asset) =>
  asset.durationSec != null ? `${Number(asset.durationSec).toFixed(2)}s` : "Unknown";

const LibraryPanel = ({
  libraryQuery,
  setLibraryQuery,
  filteredAssets,
  clips,
  lanes,
  actions,
  currentTime,
  onOpenProjectManager,
  embedded = false,
}) => {
  const audioRef = useRef(null);
  const [previewingId, setPreviewingId] = useState(null);
  const [collapsedCategories, setCollapsedCategories] = useState({});

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = "";
      }
    };
  }, []);

  const handleTogglePreview = (asset) => {
    const previewUrl = asset?.url || "";
    if (!previewUrl) return;
    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.addEventListener("ended", () => setPreviewingId(null));
      audioRef.current.addEventListener("pause", () => {
        if (audioRef.current?.ended || !audioRef.current?.src) {
          setPreviewingId(null);
        }
      });
    }
    if (previewingId === asset.id) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setPreviewingId(null);
      return;
    }
    try {
      audioRef.current.pause();
      audioRef.current.src = previewUrl;
      audioRef.current.currentTime = 0;
      const playPromise = audioRef.current.play();
      setPreviewingId(asset.id);
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch(() => setPreviewingId(null));
      }
    } catch (error) {
      setPreviewingId(null);
    }
  };

  const groupedAssets = useMemo(() => {
    const groups = CATEGORY_ORDER.map((category) => ({
      id: category,
      items: [],
    }));
    const groupMap = Object.fromEntries(groups.map((group) => [group.id, group]));
    filteredAssets.forEach((asset) => {
      const category = getAssetCategory(asset);
      (groupMap[category] || groupMap.other).items.push(asset);
    });
    return groups.filter((group) => group.items.length);
  }, [filteredAssets]);

  const assetsInUse = useMemo(() => {
    const used = new Set();
    (clips || []).forEach((clip) => {
      if (clip?.sourceAssetId) used.add(clip.sourceAssetId);
    });
    return used;
  }, [clips]);

  const toggleCategory = (categoryId) => {
    setCollapsedCategories((prev) => ({
      ...prev,
      [categoryId]: !prev[categoryId],
    }));
  };

  return (
    <div className={embedded ? "studio-library-panel studio-library-panel-embedded" : "studio-panel studio-library-panel"}>
      <div className="studio-library-header">
        <div className="studio-actions-row">
          <button className="studio-btn ghost" onClick={onOpenProjectManager}>Project Switcher</button>
        </div>
        <div className="studio-panel-title">{embedded ? "Assets" : "Library & Workspace"}</div>
        {/* A bare rounded box gave no clue what it searched; the glyph says it
            before the placeholder is read. */}
        <div className="studio-field studio-search-field">
          <SearchIcon size={15} />
          <input
            placeholder="Search assets"
            value={libraryQuery}
            onChange={(e) => setLibraryQuery(e.target.value)}
          />
        </div>
        
        <div className="studio-subtext">
          {filteredAssets.length} asset{filteredAssets.length === 1 ? "" : "s"} in this project
        </div>
      </div>
      <div className="studio-library-list">
        {groupedAssets.length ? (
          groupedAssets.map((group) => (
            <div key={group.id} className="studio-library-group">
              <button
                type="button"
                className="studio-library-group-head"
                onClick={() => toggleCategory(group.id)}
              >
                <div className="studio-library-group-title">
                  <span className="studio-library-group-badge">{CATEGORY_META[group.id]?.badge || "ETC"}</span>
                  <span>{CATEGORY_META[group.id]?.label || group.id}</span>
                </div>
                <div className="studio-library-group-right">
                  <div className="studio-library-group-count">{group.items.length}</div>
                  {/* Was a literal "+" / "-" character, which reads as add and
                      remove rather than expand and collapse. */}
                  <div
                    className={`studio-library-group-chevron${collapsedCategories[group.id] ? " collapsed" : ""}`}
                  >
                    <ChevronDownIcon size={14} />
                  </div>
                </div>
              </button>
              <div className={`studio-library-group-list ${collapsedCategories[group.id] ? "collapsed" : ""}`}>
                {group.items.map((asset) => {
                  const isInUse = assetsInUse.has(asset.id);
                  return (
                    <div
                      key={asset.id}
                      className="studio-library-item"
                      draggable
                      onDragStart={(event) => {
                        event.dataTransfer.setData("application/x-rhymix-asset", asset.id);
                        event.dataTransfer.effectAllowed = "copy";
                      }}
                      onDoubleClick={() => {
                        const laneId = lanes[0]?.id;
                        if (!laneId) return;
                        actions.addClip(laneId, asset.id, currentTime || 0, asset.durationSec);
                      }}
                    >
                      <div className="studio-library-item-head">
                        <div className="studio-library-item-main">
                          <span className="studio-library-kind-chip">{CATEGORY_META[group.id]?.badge || "ETC"}</span>
                          <div className="studio-library-title">{asset.label || asset.id}</div>
                        </div>
                        <div className="studio-library-item-right">
                          <div className="studio-library-meta">{formatAssetDuration(asset)}</div>
                          <div className="studio-library-item-actions">
                            <button
                              className={`studio-library-icon-btn ${previewingId === asset.id ? "active" : ""}`}
                              disabled={!asset.url}
                              title={previewingId === asset.id ? "Stop preview" : "Preview asset"}
                              aria-label={previewingId === asset.id ? "Stop preview" : "Preview asset"}
                              onClick={(event) => {
                                event.stopPropagation();
                                handleTogglePreview(asset);
                              }}
                            >
                              {previewingId === asset.id ? <StopIcon fontSize="inherit" /> : <PlayArrowIcon fontSize="inherit" />}
                            </button>
                            <button
                              className="studio-library-icon-btn"
                              title="Add to timeline"
                              aria-label="Add to timeline"
                              onClick={() => {
                                const laneId = lanes[0]?.id;
                                if (!laneId) return;
                                actions.addClip(laneId, asset.id, currentTime || 0, asset.durationSec);
                              }}
                            >
                              <AddIcon fontSize="inherit" />
                            </button>
                            <button
                              className="studio-library-icon-btn danger"
                              disabled={isInUse}
                              title={isInUse ? "This asset is used by one or more clips in the project." : "Delete unused asset"}
                              aria-label={isInUse ? "Asset is in use and cannot be deleted" : "Delete asset"}
                              onClick={(event) => {
                                event.stopPropagation();
                                if (isInUse) return;
                                actions.removeAsset(asset.id);
                                if (previewingId === asset.id && audioRef.current) {
                                  audioRef.current.pause();
                                  audioRef.current.currentTime = 0;
                                  setPreviewingId(null);
                                }
                              }}
                            >
                              <DeleteOutlineIcon fontSize="inherit" />
                            </button>
                          </div>
                        </div>
                      </div>
                      <div className="studio-library-id">
                        {asset.id}
                        {isInUse ? " · in use" : ""}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        ) : (
          <div className="studio-empty">No assets yet.</div>
        )}
      </div>
    </div>
  );
};

export default LibraryPanel;
