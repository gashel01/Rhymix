import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Select from "../../components/common/Select";
import { filterUsableVstPlugins } from "../vst3Utils";
import { INSTRUMENT_CHOICES } from "../audioMath";
import { PlusIcon } from "lucide-react";
const LANE_TYPES = [
  { value: "midi", label: "MIDI" },
  { value: "custom", label: "Custom" },
  { value: "mix", label: "Mix" },
  { value: "vocal", label: "Vocals" },
  { value: "instrumental", label: "Instrumental" },
  { value: "stem", label: "Stem" },
  { value: "generated", label: "Generated" },
  { value: "airgen", label: "AI Regen" },
];

const TrackList = ({
  lanes,
  assets,
  onUpdateLane,
  onAddLane,
  onRemoveLane,
  onDuplicateLane,
  onReorderLanes,
  onSelectLane,
  onFocusLane,
  activeLaneId,
  onOpenLaneFx,
  onDeleteAllLanes,
  showHeader = true,
  showAdd = true,
  compact = false,
  embeddedVstInstanceId,
  embeddedVstPluginPath,
  onOpenEmbeddedVst,
  onCloseEmbeddedVst,
  fallbackVstInstances,
  onCloseFallbackVst,
}) => {
  const [editingLaneId, setEditingLaneId] = useState(null);
  const [draftName, setDraftName] = useState("");
  const [menuLaneId, setMenuLaneId] = useState(null);
  const [newType, setNewType] = useState("custom");
  const [newName, setNewName] = useState("");
  const [dragLaneId, setDragLaneId] = useState(null);
  const [dragOver, setDragOver] = useState(null);
  const [showAddLane, setShowAddLane] = useState(false);
  const [addLanePos, setAddLanePos] = useState(null);
  const addLaneTriggerRef = useRef(null);
  const addLanePanelRef = useRef(null);

  /* VST3 plugin browsing/hosting only exists inside the native Electron shell
     (native/shell/) — window.rhymixNative is the bridge its preload.js exposes;
     it's simply absent in the browser build, where this whole section renders
     as nothing rather than a broken button. See native/shell/README.md for the
     exact window.rhymixNative.vst3.{scan,open,close} contract this calls. */
  const hasNativeVst3 = typeof window !== "undefined" && !!window.rhymixNative?.vst3;
  const [vstPlugins, setVstPlugins] = useState([]);
  const [vstScanning, setVstScanning] = useState(false);
  const [vstScanError, setVstScanError] = useState(null);
  const [openVstInstances, setOpenVstInstances] = useState({});
  /* Embedded (shown in the Inspector's right panel) is the default a plugin opens into — this
     just opts a click back into the older standalone-OS-window behavior, still useful for e.g. a
     plugin whose own GUI wants more room than the panel gives it. */
  const [vstSeparateWindow, setVstSeparateWindow] = useState(false);

  const scanVstPlugins = async () => {
    if (!hasNativeVst3 || vstScanning) return;
    setVstScanning(true);
    setVstScanError(null);
    try {
      const found = await window.rhymixNative.vst3.scan(["C:\\Program Files\\Common Files\\VST3"]);
      setVstPlugins(filterUsableVstPlugins(found));
    } catch (err) {
      setVstScanError(err?.message || "Scan failed.");
    } finally {
      setVstScanning(false);
    }
  };

  const toggleVstPlugin = async (plugin) => {
    if (!hasNativeVst3) return;

    if (!vstSeparateWindow) {
      // A plugin whose fixed GUI didn't fit the panel got auto-opened as its own standalone
      // window instead (see StudioView.js's onEmbedDoesNotFit) — closing it from here means
      // closing that fallback window, there's no embedded slot for it to begin with.
      const fallbackId = fallbackVstInstances?.[plugin.path];
      if (fallbackId) {
        try {
          await window.rhymixNative.vst3.close(fallbackId);
        } catch {}
        onCloseFallbackVst?.(plugin.path);
        return;
      }
      // Embedded: Inspector.js owns the actual open()/close() calls (it's the one that knows
      // the placeholder element's real screen position) — this just tells it which plugin to
      // show, via the parent (StudioView.js) callbacks.
      if (embeddedVstPluginPath === plugin.path && embeddedVstInstanceId) {
        onCloseEmbeddedVst?.();
      } else {
        onOpenEmbeddedVst?.(plugin);
      }
      return;
    }

    const openId = openVstInstances[plugin.path];
    if (openId) {
      try {
        await window.rhymixNative.vst3.close(openId);
      } catch {}
      setOpenVstInstances((prev) => {
        const next = { ...prev };
        delete next[plugin.path];
        return next;
      });
      return;
    }
    try {
      const result = await window.rhymixNative.vst3.open(plugin.path);
      const instanceId = result?.instanceId;
      if (instanceId) {
        setOpenVstInstances((prev) => ({ ...prev, [plugin.path]: instanceId }));
      }
    } catch (err) {
      // createView(kEditor) returning null means the plugin genuinely has no GUI (e.g. built
      // without VSTGUI) — not a real failure, worth saying plainly instead of surfacing the raw
      // IPC/C++ exception text.
      const raw = err?.message || "";
      setVstScanError(
        raw.includes("createView")
          ? `${plugin.name || "This plugin"} has no GUI to open.`
          : raw || "Could not open plugin window."
      );
    }
  };

  const instrumentOptions = useMemo(() => {
    const soundfontAssets = Object.values(assets || {}).filter((asset) => asset?.kind === "soundfont");
    return [
      { value: "", label: "Auto (from lane name)" },
      ...INSTRUMENT_CHOICES,
      ...soundfontAssets.map((asset) => ({ value: asset.id, label: `Imported: ${asset.label || asset.id}` })),
    ];
  }, [assets]);

  /* Named shortcuts into the same instrument dropdown above — a lane's "instrument" is just a
     soundfont pick, so a "preset" here is nothing more than a favourite worth naming, stored per
     browser/user rather than per project (it's a personal shortcut, not project data). */
  const INSTRUMENT_PRESETS_KEY = "rhymix.studio.instrumentPresets";
  const [instrumentPresets, setInstrumentPresets] = useState(() => {
    try {
      const raw = window.localStorage?.getItem(INSTRUMENT_PRESETS_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  const persistInstrumentPresets = (next) => {
    setInstrumentPresets(next);
    try {
      window.localStorage?.setItem(INSTRUMENT_PRESETS_KEY, JSON.stringify(next));
    } catch {
      // Storage unavailable/full — presets just won't survive reload, not worth surfacing.
    }
  };
  const saveInstrumentPreset = (lane) => {
    if (!lane.instrument?.startsWith("soundfont:")) return;
    const name = window.prompt("Name this instrument preset:");
    if (!name || !name.trim()) return;
    const next = [
      ...instrumentPresets.filter((p) => p.name !== name.trim()),
      { id: `preset:${Date.now()}`, name: name.trim(), instrument: lane.instrument },
    ];
    persistInstrumentPresets(next);
  };
  const deleteInstrumentPreset = (presetId) => {
    persistInstrumentPresets(instrumentPresets.filter((p) => p.id !== presetId));
  };

  useEffect(() => {
    if (!menuLaneId) return;
    const handleClick = (event) => {
      if (!event.target.closest(".studio-track-menu-wrap")) {
        setMenuLaneId(null);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuLaneId]);

  // Portaled (see below) so the popover can't be clipped by
  // .studio-track-headers' own overflow:auto — a click inside it is no
  // longer a DOM descendant of the trigger button, so it needs its own ref
  // checked here too, or the popover would close itself before "Add" ever
  // ran. The type <Select> inside it has exactly the same problem one level
  // deeper: its own options list is *also* portaled straight to document.body
  // (Select.js, for the same clipping reason), so a click on an option was
  // never inside addLaneTriggerRef or addLanePanelRef either — picking a type
  // closed the whole popover before onChange ever fired. Select.js's listbox
  // has no ref this component can reach, but it always carries role="listbox"
  // (Select.js sets it explicitly), which is what's checked for instead.
  useEffect(() => {
    if (!showAddLane) return;
    const handleClick = (event) => {
      if (addLaneTriggerRef.current?.contains(event.target)) return;
      if (addLanePanelRef.current?.contains(event.target)) return;
      if (event.target.closest('[role="listbox"]')) return;
      setShowAddLane(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showAddLane]);

  useEffect(() => {
    if (!dragLaneId) return;
    const handleWindowDrop = () => {
      setDragLaneId(null);
      setDragOver(null);
    };
    window.addEventListener("drop", handleWindowDrop);
    window.addEventListener("dragend", handleWindowDrop);
    return () => {
      window.removeEventListener("drop", handleWindowDrop);
      window.removeEventListener("dragend", handleWindowDrop);
    };
  }, [dragLaneId]);

  return (
    <div className={`studio-tracklist ${compact ? "compact" : ""}`}>
      {(showHeader || showAdd) && (
        <div className="studio-tracklist-top">
          {showHeader && (
            <div className="studio-tracklist-header">
              <div className="studio-panel-title">Lanes</div>
              <button
                ref={addLaneTriggerRef}
                className="studio-btn"
                style={{ width: "18px", height: "18px", padding: 0, borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center" }}
                onClick={() => {
                  if (showAddLane) {
                    setShowAddLane(false);
                    return;
                  }
                  // .studio-track-headers scrolls its own overflow — a popover
                  // positioned relative to this button, inside that same box,
                  // used to render as an absolutely-positioned element with no
                  // offsets at all (position:absolute with nothing to anchor
                  // it to just sits at its static position, out of flow,
                  // overlapping whatever came after it instead of opening
                  // below the button). Positioned from the button's own
                  // screen coordinates and portaled out past the scroll
                  // container instead — the same fix the clip's ⋯ menu got.
                  const rect = addLaneTriggerRef.current?.getBoundingClientRect();
                  if (!rect) return;
                  const panelWidth = 220;
                  let left = rect.left;
                  left = Math.max(8, Math.min(left, window.innerWidth - panelWidth - 8));
                  setAddLanePos({ left, top: rect.bottom + 6 });
                  setShowAddLane(true);
                }}
              >
                <PlusIcon size={16} style={{ fontSize: 16 }} />
              </button>
              <button
                className="studio-mini danger"
                disabled={!lanes.length}
                onClick={() => {
                  if (!lanes.length) return;
                  if (!window.confirm("Delete all lanes and clips?")) return;
                  onDeleteAllLanes?.();
                }}
              >
                Delete All
              </button>
            </div>
          )}

          {showAdd && showAddLane && addLanePos
            ? createPortal(
                <div
                  className="studio-track-menu studio-add-lane-panel"
                  ref={addLanePanelRef}
                  style={{ position: "fixed", left: addLanePos.left, top: addLanePos.top, right: "auto" }}
                >
                  <div className="studio-context-eyebrow">Add lane</div>
                  <Select
                    value={newType}
                    onChange={setNewType}
                    options={LANE_TYPES.map((type) => ({ value: type.value, label: type.label }))}
                  />
                  <input
                    type="text"
                    placeholder="Lane name"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setShowAddLane(false);
                    }}
                  />
                  <button
                    className="studio-btn accent"
                    onClick={() => {
                      const baseLabel = LANE_TYPES.find((t) => t.value === newType)?.label || "Lane";
                      const existingCount = lanes.filter((lane) => lane.type === newType).length;
                      const fallbackName = existingCount > 0 ? `${baseLabel} ${existingCount + 1}` : baseLabel;
                      const name = newName.trim() || fallbackName;
                      onAddLane?.({ type: newType, name });
                      setNewName("");
                      setShowAddLane(false);
                    }}
                  >
                    Add lane
                  </button>
                </div>,
                document.body
              )
            : null}
        </div>
      )}
      {lanes.map((lane) => {
        const fxActive = Object.values(lane.fx || {}).some((fx) => fx?.enabled);
        return (
        <div
          key={lane.id}
          className={`studio-track-row ${activeLaneId === lane.id ? "active" : ""} ${
            dragOver?.id === lane.id ? `drag-over ${dragOver.position}` : ""
          }`}
          onClick={(e) => {
            // Clicking the row itself (not one of its controls) picks the lane — its effects
            // then show in the right panel.
            if (e.target.closest("button, input, select, label, .studio-track-menu-wrap")) return;
            onFocusLane?.(lane.id);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            if (dragLaneId === lane.id) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const position = e.clientY < rect.top + rect.height / 2 ? "before" : "after";
            setDragOver({ id: lane.id, position });
          }}
          onDragLeave={() => {
            setDragOver((prev) => (prev?.id === lane.id ? null : prev));
          }}
          onDrop={(e) => {
            e.preventDefault();
            const sourceId = dragLaneId || e.dataTransfer.getData("text/plain");
            if (!sourceId || sourceId === lane.id) {
              setDragOver(null);
              return;
            }
            const ids = lanes.map((l) => l.id);
            const sourceIndex = ids.indexOf(sourceId);
            let targetIndex = ids.indexOf(lane.id);
            if (sourceIndex === -1 || targetIndex === -1) {
              setDragOver(null);
              return;
            }
            ids.splice(sourceIndex, 1);
            if (dragOver?.position === "after") {
              targetIndex += 1;
            }
            ids.splice(targetIndex, 0, sourceId);
            onReorderLanes?.(ids);
            setDragOver(null);
            setDragLaneId(null);
          }}
          onDragEnd={() => {
            setDragLaneId(null);
            setDragOver(null);
          }}
        >
          <div className="studio-track-header">
            <span
              className="studio-track-grip"
              title="Drag to reorder"
              draggable
              onDragStart={(e) => {
                setDragLaneId(lane.id);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", lane.id);
              }}
            >
              ≡
            </span>
            <label
              className="studio-lane-color"
              style={{ background: lane.color || "#2b3a45" }}
              title="Lane color"
            >
              <input
                type="color"
                value={lane.color || "#2b3a45"}
                onChange={(e) => onUpdateLane(lane.id, { color: e.target.value })}
              />
            </label>
            <div className="studio-track-title">
              {editingLaneId === lane.id ? (
                <input
                  className="studio-track-input"
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  onBlur={() => {
                    onUpdateLane(lane.id, { name: draftName.trim() || lane.name });
                    setEditingLaneId(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      onUpdateLane(lane.id, { name: draftName.trim() || lane.name });
                      setEditingLaneId(null);
                    }
                    if (e.key === "Escape") {
                      setEditingLaneId(null);
                      setDraftName("");
                    }
                  }}
                />
              ) : (
                <button
                  className="studio-track-name-btn"
                  onClick={() => {
                    setEditingLaneId(lane.id);
                    setDraftName(lane.name || "");
                  }}
                >
                  {lane.name}
                </button>
              )}
              {fxActive && <span className="studio-tag">FX</span>}
            </div>
            <div className="studio-track-menu-wrap">
              <button
                className="studio-track-menu-btn"
                onClick={() => setMenuLaneId(menuLaneId === lane.id ? null : lane.id)}
              >
                ⋯
              </button>
              {menuLaneId === lane.id && (
                <div className="studio-track-menu">
                  {/* Rename and colour dropped from here — both are already a
                      direct click away on the row itself (the name button,
                      the colour swatch), so a second path to the same two
                      actions was just a longer way to do what was already
                      one click. */}
                  <button
                    className="studio-track-menu-item"
                    onClick={() => {
                      onOpenLaneFx?.(lane.id);
                      setMenuLaneId(null);
                    }}
                  >
                    Lane FX
                  </button>
                  {lane.type === "midi" && (
                    <div className="studio-track-menu-instrument" onClick={(e) => e.stopPropagation()}>
                      <span className="studio-track-menu-label">Instrument</span>
                      <Select
                        value={lane.instrument || ""}
                        onChange={(value) => onUpdateLane?.(lane.id, { instrument: value || null })}
                        options={instrumentOptions}
                      />
                      <div className="studio-track-menu-instrument-presets">
                        {instrumentPresets.map((preset) => (
                          <span key={preset.id} className="studio-track-menu-preset-chip">
                            <button
                              type="button"
                              className="studio-mini"
                              onClick={() => onUpdateLane?.(lane.id, { instrument: preset.instrument })}
                              title={`Apply preset: ${preset.name}`}
                            >
                              {preset.name}
                            </button>
                            <button
                              type="button"
                              className="studio-track-menu-preset-remove"
                              onClick={() => deleteInstrumentPreset(preset.id)}
                              title="Delete preset"
                            >
                              ×
                            </button>
                          </span>
                        ))}
                        {lane.instrument?.startsWith("soundfont:") && (
                          <button type="button" className="studio-mini" onClick={() => saveInstrumentPreset(lane)}>
                            + Save preset
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                  {hasNativeVst3 && (
                    <div className="studio-track-menu-vst3" onClick={(e) => e.stopPropagation()}>
                      <div className="studio-track-menu-vst3-head">
                        <span className="studio-track-menu-label">VST3 Plugins</span>
                        <button
                          type="button"
                          className="studio-mini"
                          onClick={scanVstPlugins}
                          disabled={vstScanning}
                        >
                          {vstScanning ? "Scanning…" : vstPlugins.length ? "Rescan" : "Scan"}
                        </button>
                      </div>
                      <label className="studio-track-menu-vst3-toggle">
                        <input
                          type="checkbox"
                          checked={vstSeparateWindow}
                          onChange={(e) => setVstSeparateWindow(e.target.checked)}
                        />
                        Open in separate window
                      </label>
                      {vstScanError && <div className="studio-track-menu-vst3-error">{vstScanError}</div>}
                      {vstPlugins.length > 0 && (
                        <div className="studio-track-menu-vst3-list">
                          {vstPlugins.map((plugin) => {
                            const isOpen = vstSeparateWindow
                              ? !!openVstInstances[plugin.path]
                              : embeddedVstPluginPath === plugin.path || !!fallbackVstInstances?.[plugin.path];
                            return (
                              <button
                                type="button"
                                key={plugin.path}
                                className={`studio-track-menu-vst3-item ${isOpen ? "active" : ""}`}
                                onClick={() => toggleVstPlugin(plugin)}
                                title={plugin.vendor ? `${plugin.name} — ${plugin.vendor}` : plugin.name}
                              >
                                <span className="studio-track-menu-vst3-name">{plugin.name || plugin.path}</span>
                                <span className="studio-track-menu-vst3-state">{isOpen ? "Close" : "Open"}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                  <button
                    className="studio-track-menu-item"
                    onClick={() => {
                      onSelectLane?.(lane.id);
                      setMenuLaneId(null);
                    }}
                  >
                    Select Lane Clips
                  </button>
                  {lane.type === "midi" && (
                    <button
                      className="studio-track-menu-item"
                      onClick={() => {
                        onDuplicateLane?.(lane.id);
                        setMenuLaneId(null);
                      }}
                    >
                      Duplicate MIDI Lane
                    </button>
                  )}
                  <button
                    className="studio-track-menu-item danger"
                    onClick={() => {
                      onRemoveLane?.(lane.id);
                      setMenuLaneId(null);
                    }}
                  >
                    Delete Lane
                  </button>
                </div>
              )}
            </div>
          </div>
          <div className="studio-track-controls">
          <input
                  type="range"
                  min="-12"
                  max="12"
                  step="0.5"
                  value={lane.gainDb ?? 0}
                  onChange={(e) => onUpdateLane(lane.id, { gainDb: Number(e.target.value) })}
                />
            <div style={{ display: "flex", gap: 6 , flexDirection: "row", alignItems: "center", justifyContent: "space-between"}}>
               
                <span className="studio-db">{lane.gainDb ?? 0} dB</span>

                <div style={{ display: "flex", gap: 6 , flexDirection: "row"}}>
                  <button
                    className={`studio-mini ${lane.mute ? "active" : ""}`}
                    onClick={() => onUpdateLane(lane.id, { mute: !lane.mute, solo: false })}
                  >
                    M
                  </button>
                  <button
                    className={`studio-mini ${lane.solo ? "active" : ""}`}
                    onClick={() => onUpdateLane(lane.id, { solo: !lane.solo, mute: false })}
                  >
                    S
                  </button>
                </div>
            </div>
          </div>
        </div>
        );
      })}
    </div>
  );
};

export default TrackList;
