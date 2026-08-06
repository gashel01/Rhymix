import React, { useEffect, useState } from "react";
import Select from "../../components/common/Select";
import { PlusIcon } from "lucide-react";
const LANE_TYPES = [
  { value: "midi", label: "MIDI" },
  { value: "custom", label: "Custom" },
  { value: "mix", label: "Mix" },
  { value: "vocal", label: "Vocals" },
  { value: "instrumental", label: "Instrumental" },
  { value: "stem", label: "Stem" },
  { value: "generated", label: "Generated" },
];

const TrackList = ({
  lanes,
  onUpdateLane,
  onAddLane,
  onRemoveLane,
  onDuplicateLane,
  onReorderLanes,
  onSelectLane,
  onDeleteAllLanes,
  showHeader = true,
  showAdd = true,
  compact = false,
}) => {
  const [editingLaneId, setEditingLaneId] = useState(null);
  const [draftName, setDraftName] = useState("");
  const [menuLaneId, setMenuLaneId] = useState(null);
  const [newType, setNewType] = useState("custom");
  const [newName, setNewName] = useState("");
  const [dragLaneId, setDragLaneId] = useState(null);
  const [dragOver, setDragOver] = useState(null);
  const [showAddLane, setShowAddLane] = useState(false);
  
  
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
              <button className="studio-btn" style={{ width: "18px", height: "18px" ,padding:0, borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center"}} onClick={() => setShowAddLane?.(!showAddLane)}>
                <PlusIcon  size={16} style={{ fontSize: 16 }} />
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

          
          {showAdd && showAddLane && (
            <div className="studio-track-add">
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
              />
              <button
                className="studio-mini"
                onClick={() => {
                  const baseLabel = LANE_TYPES.find((t) => t.value === newType)?.label || "Lane";
                  const existingCount = lanes.filter((lane) => lane.type === newType).length;
                  const fallbackName = existingCount > 0 ? `${baseLabel} ${existingCount + 1}` : baseLabel;
                  const name = newName.trim() || fallbackName;
                  onAddLane?.({ type: newType, name });
                  setNewName("");
                }}
              >
                Add
              </button>
            </div>
          )}
        </div>
      )}
      {lanes.map((lane) => {
        const fxActive = Object.values(lane.fx || {}).some((fx) => fx?.enabled);
        return (
        <div
          key={lane.id}
          className={`studio-track-row ${
            dragOver?.id === lane.id ? `drag-over ${dragOver.position}` : ""
          }`}
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
                  <button
                    className="studio-track-menu-item"
                    onClick={() => {
                      setEditingLaneId(lane.id);
                      setDraftName(lane.name || "");
                      setMenuLaneId(null);
                    }}
                  >
                    Rename Lane
                  </button>
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
                  <div className="studio-track-menu-item">
                    <span>Lane Color</span>
                    <input
                      type="color"
                      value={lane.color || "#2b3a45"}
                      onChange={(e) => onUpdateLane(lane.id, { color: e.target.value })}
                    />
                  </div>
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
