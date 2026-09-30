import React, { useEffect, useMemo, useRef, useState } from "react";
import PlayArrowIcon from "@mui/icons-material/PlayArrowOutlined";
import StopIcon from "@mui/icons-material/StopOutlined";
import AddIcon from "@mui/icons-material/AddOutlined";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlineOutlined";
import { ChevronDownIcon } from "./StudioIcons";
import { SearchIcon } from "../../next/icons";
import { uploadAudioFile } from "../api";

/* The browser already knows how to read a media file's own duration — no
   need to round-trip to the backend just to probe it before the asset can
   be registered. A hard timeout backstops this: a file the browser can't
   parse cleanly sometimes fires neither loadedmetadata nor error, and
   without this the upload button was stuck on "Uploading…" forever. */
const probeAudioDuration = (file) =>
  new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    let settled = false;
    const cleanup = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      resolve(value);
    };
    const timer = setTimeout(() => cleanup(0), 5000);
    audio.addEventListener("loadedmetadata", () => cleanup(Number.isFinite(audio.duration) ? audio.duration : 0));
    audio.addEventListener("error", () => cleanup(0));
    audio.src = url;
  });

const CATEGORY_ORDER = ["vocals", "drums", "bass", "music", "midi", "soundfont", "generated", "other"];

const CATEGORY_META = {
  vocals: { label: "Vocals", badge: "VOX" },
  drums: { label: "Drums", badge: "DRM" },
  bass: { label: "Bass", badge: "BAS" },
  music: { label: "Music", badge: "MUS" },
  midi: { label: "MIDI", badge: "MID" },
  soundfont: { label: "Soundfonts", badge: "SF2" },
  generated: { label: "Generated", badge: "GEN" },
  other: { label: "Other", badge: "ETC" },
};

const getAssetCategory = (asset) => {
  if (asset?.kind === "soundfont") return "soundfont";
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

const formatAssetDuration = (asset) => {
  if (asset.kind === "soundfont") return "Soundfont";
  return asset.durationSec != null ? `${Number(asset.durationSec).toFixed(2)}s` : "Unknown";
};

/* Saved filters are a user-level convenience ("all my 140bpm loops"), reusable across projects —
   not project state, so localStorage rather than the autosaved EDL (state.metadata) is the right
   home for them. */
const SAVED_FILTERS_KEY = "rhymix.studio.libraryFilters";

const loadSavedFilters = () => {
  try {
    const raw = window.localStorage?.getItem(SAVED_FILTERS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const persistSavedFilters = (filters) => {
  try {
    window.localStorage?.setItem(SAVED_FILTERS_KEY, JSON.stringify(filters));
  } catch {
    // Storage unavailable/full — saved filters just won't survive reload, not worth surfacing.
  }
};

const LibraryPanel = ({
  libraryQuery,
  setLibraryQuery,
  filteredAssets,
  selectedTags = [],
  onSelectedTagsChange,
  allLibraryTags = [],
  clips,
  lanes,
  actions,
  currentTime,
  onOpenProjectManager,
  embedded = false,
}) => {
  const audioRef = useRef(null);
  const previewTokenRef = useRef(null);
  const fileInputRef = useRef(null);
  const soundfontInputRef = useRef(null);
  const [previewingId, setPreviewingId] = useState(null);
  const [collapsedCategories, setCollapsedCategories] = useState({});
  const [uploading, setUploading] = useState(false);
  const [uploadingSoundfont, setUploadingSoundfont] = useState(false);

  const handleFileUpload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const [record] = await uploadAudioFile(file);
      if (!record?.fileId) throw new Error("Upload failed");
      const durationSec = await probeAudioDuration(file);
      actions.registerAsset({
        id: `upload:${record.fileId}`,
        kind: "upload",
        label: record.safeDisplayName || file.name,
        url: `/api/download/input/${encodeURIComponent(record.storedName)}`,
        durationSec,
      });
    } catch (err) {
      window.alert(err?.response?.data?.error || err?.message || "Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  /* A real instrument sound bank, not a playable clip: reuses the same
     generic /api/upload the audio button does (it just stores raw bytes,
     nothing audio-specific), but registers a "soundfont" kind asset instead
     of "upload" so it's assignable to a lane (TrackList's Instrument picker)
     rather than draggable onto the timeline. */
  const handleSoundfontUpload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploadingSoundfont(true);
    try {
      const [record] = await uploadAudioFile(file);
      if (!record?.fileId) throw new Error("Upload failed");
      actions.registerAsset({
        id: `soundfont:${record.fileId}`,
        kind: "soundfont",
        label: record.safeDisplayName || file.name,
        url: `/api/download/input/${encodeURIComponent(record.storedName)}`,
      });
    } catch (err) {
      window.alert(err?.response?.data?.error || err?.message || "Soundfont import failed.");
    } finally {
      setUploadingSoundfont(false);
    }
  };

  const [tagDraft, setTagDraft] = useState({}); // { [assetId]: string } — the in-progress "+ tag" input per asset
  const [savedFilters, setSavedFilters] = useState(loadSavedFilters);

  const toggleSelectedTag = (tag) => {
    if (!onSelectedTagsChange) return;
    onSelectedTagsChange(
      selectedTags.includes(tag) ? selectedTags.filter((t) => t !== tag) : [...selectedTags, tag]
    );
  };

  const addAssetTag = (asset, rawTag) => {
    const tag = rawTag.trim();
    if (!tag) return;
    const existing = Array.isArray(asset.tags) ? asset.tags : [];
    if (existing.includes(tag)) return;
    actions.setAssetTags(asset.id, [...existing, tag]);
  };

  const removeAssetTag = (asset, tag) => {
    const existing = Array.isArray(asset.tags) ? asset.tags : [];
    actions.setAssetTags(asset.id, existing.filter((t) => t !== tag));
  };

  const applySavedFilter = (filter) => {
    setLibraryQuery(filter.query || "");
    onSelectedTagsChange?.(Array.isArray(filter.tags) ? filter.tags : []);
  };

  const saveCurrentFilter = () => {
    if (!libraryQuery && !selectedTags.length) return;
    const name = window.prompt("Name this filter (e.g. \"140bpm loops\"):");
    if (!name || !name.trim()) return;
    const next = [
      ...savedFilters.filter((f) => f.name !== name.trim()),
      { id: `filter:${Date.now()}`, name: name.trim(), query: libraryQuery, tags: selectedTags },
    ];
    setSavedFilters(next);
    persistSavedFilters(next);
  };

  const deleteSavedFilter = (filterId) => {
    const next = savedFilters.filter((f) => f.id !== filterId);
    setSavedFilters(next);
    persistSavedFilters(next);
  };

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
    }
    if (previewingId === asset.id) {
      previewTokenRef.current = null;
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setPreviewingId(null);
      return;
    }
    // Rapid clicking across previews shares this one <audio> element, so an earlier click's
    // play() rejection or "ended"/"pause" event can resolve after a later click has already
    // moved the element on to a different track - previewTokenRef is who's actually meant to
    // be active right now, so a stale callback checking against it (rather than unconditionally
    // clearing state) can't stomp on a newer click's state anymore. Handlers are reassigned
    // fresh per click (not addEventListener) so only the latest click's closure is ever live.
    previewTokenRef.current = asset.id;
    audioRef.current.onended = () => {
      if (previewTokenRef.current === asset.id) setPreviewingId(null);
    };
    audioRef.current.onpause = () => {
      if (previewTokenRef.current === asset.id && (audioRef.current?.ended || !audioRef.current?.src)) {
        setPreviewingId(null);
      }
    };
    try {
      audioRef.current.pause();
      audioRef.current.src = previewUrl;
      audioRef.current.currentTime = 0;
      const playPromise = audioRef.current.play();
      setPreviewingId(asset.id);
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch(() => {
          if (previewTokenRef.current === asset.id) setPreviewingId(null);
        });
      }
    } catch (error) {
      if (previewTokenRef.current === asset.id) setPreviewingId(null);
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
    (lanes || []).forEach((lane) => {
      if (typeof lane?.instrument === "string" && lane.instrument.startsWith("soundfont:")) {
        used.add(lane.instrument);
      }
    });
    return used;
  }, [clips, lanes]);

  const toggleCategory = (categoryId) => {
    setCollapsedCategories((prev) => ({
      ...prev,
      [categoryId]: !prev[categoryId],
    }));
  };

  return (
    <div className={embedded ? "studio-library-panel studio-library-panel-embedded" : "studio-panel studio-library-panel"}>
      <div className="studio-library-header">
        {/* The switcher is for opening a *different* saved project — a rare
            action, and not what this panel is for day to day. It rode above
            the panel's own title as if it were the main event; now it's an
            inline, secondary link beside it, same relationship "Advanced"
            has to a section in Create. */}
        <div className="studio-library-header-row">
          <div className="studio-panel-title">{embedded ? "Assets" : "Library & Workspace"}</div>
          <div className="studio-library-header-links">
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*"
              style={{ display: "none" }}
              onChange={handleFileUpload}
            />
            <button
              className="studio-library-switch-link"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? "Uploading…" : "Upload"}
            </button>
            <input
              ref={soundfontInputRef}
              type="file"
              accept=".sf2,.sf3,.dls"
              style={{ display: "none" }}
              onChange={handleSoundfontUpload}
            />
            <button
              className="studio-library-switch-link"
              onClick={() => soundfontInputRef.current?.click()}
              disabled={uploadingSoundfont}
              title="Import a .sf2/.sf3/.dls sound bank, assignable to a MIDI lane as its instrument"
            >
              {uploadingSoundfont ? "Importing…" : "Import soundfont"}
            </button>
            <button className="studio-library-switch-link" onClick={onOpenProjectManager}>
              Switch project
            </button>
          </div>
        </div>
        {/* Same component as the top bar's own search field — the app-wide
            one has nothing to search inside a single Studio project, so it
            hides itself here (see NextApp.js) and this is the closest thing
            to it in the same screen, reusing its exact look. */}
        <div className="rx-search">
          <SearchIcon className="ic" />
          <input
            type="search"
            placeholder="Search assets"
            value={libraryQuery}
            onChange={(e) => setLibraryQuery(e.target.value)}
            aria-label="Search assets"
          />
        </div>
        <div className="studio-subtext">
          {filteredAssets.length} asset{filteredAssets.length === 1 ? "" : "s"} in this project
        </div>
        {allLibraryTags.length > 0 && (
          <div className="studio-library-tag-filters">
            {allLibraryTags.map((tag) => (
              <button
                type="button"
                key={tag}
                className={`studio-library-tag-chip ${selectedTags.includes(tag) ? "active" : ""}`}
                onClick={() => toggleSelectedTag(tag)}
              >
                {tag}
              </button>
            ))}
          </div>
        )}
        <div className="studio-library-saved-filters">
          {savedFilters.map((filter) => (
            <span key={filter.id} className="studio-library-saved-filter-chip">
              <button type="button" onClick={() => applySavedFilter(filter)}>
                {filter.name}
              </button>
              <button
                type="button"
                className="studio-library-saved-filter-remove"
                title="Delete saved filter"
                aria-label={`Delete saved filter ${filter.name}`}
                onClick={() => deleteSavedFilter(filter.id)}
              >
                ×
              </button>
            </span>
          ))}
          {(libraryQuery || selectedTags.length > 0) && (
            <button type="button" className="studio-library-save-filter-btn" onClick={saveCurrentFilter}>
              + Save filter
            </button>
          )}
        </div>
      </div>
      <div className="studio-library-list">
        {groupedAssets.length ? (
          groupedAssets.map((group) => (
            <div key={group.id} className="studio-library-group" data-category={group.id}>
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
                      data-category={group.id}
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
                            {asset.kind !== "soundfont" && (
                              <>
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
                              </>
                            )}
                            {asset.kind === "soundfont" && (
                              <span className="studio-library-meta" title="Assign this to a MIDI lane's Instrument picker (lane ⋯ menu)">
                                Assign via lane ⋯
                              </span>
                            )}
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
                                  previewTokenRef.current = null;
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
                      <div className="studio-library-tags" onClick={(event) => event.stopPropagation()}>
                        {(asset.tags || []).map((tag) => (
                          <span key={tag} className="studio-library-item-tag">
                            <button type="button" onClick={() => toggleSelectedTag(tag)}>{tag}</button>
                            <button
                              type="button"
                              className="studio-library-item-tag-remove"
                              title={`Remove tag "${tag}"`}
                              aria-label={`Remove tag ${tag}`}
                              onClick={() => removeAssetTag(asset, tag)}
                            >
                              ×
                            </button>
                          </span>
                        ))}
                        <input
                          className="studio-library-tag-input"
                          placeholder="+ tag"
                          value={tagDraft[asset.id] || ""}
                          onChange={(event) =>
                            setTagDraft((prev) => ({ ...prev, [asset.id]: event.target.value }))
                          }
                          onKeyDown={(event) => {
                            if (event.key !== "Enter") return;
                            addAssetTag(asset, tagDraft[asset.id] || "");
                            setTagDraft((prev) => ({ ...prev, [asset.id]: "" }));
                          }}
                        />
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
