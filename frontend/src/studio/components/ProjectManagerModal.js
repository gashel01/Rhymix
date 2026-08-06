import React, { useEffect, useMemo, useState } from "react";
import {
  createProject,
  deleteProject,
  getAllProjects,
  getProjectById,
  getProjectsByAssetList,
} from "../api";
import { getAvailableFiles } from "../../utils/apiService";

/* Same six gradients the Models view cycles through, so a project card and a
   model card are visibly the same kind of object. */
const CARD_GRADIENTS = [
  "linear-gradient(135deg, #6366f1 0%, #06b6d4 100%)",
  "linear-gradient(135deg, #ec4899 0%, #9333ea 100%)",
  "linear-gradient(135deg, #f59e0b 0%, #ea580c 100%)",
  "linear-gradient(135deg, #10b981 0%, #0d9488 100%)",
  "linear-gradient(135deg, #8b5cf6 0%, #c026d3 100%)",
  "linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)",
];

const cardGradient = (index) => CARD_GRADIENTS[index % CARD_GRADIENTS.length];

const projMeta = (item) => item?.project || {};

/* Neither of these may fall back to an id. `Project 983882` is a slice of a
   uuid wearing a label, and getSourceLabel used to return the raw 32-character
   assetId whenever a project's source was no longer in the catalogue — which
   is also what titled every group in the list. */
const getProjectLabel = (item, sourceMap) => {
  const meta = projMeta(item);
  if (meta.name) return meta.name;
  if (!meta.assetId) return "Blank project";
  return sourceMap?.get(meta.assetId)?.label || "Untitled project";
};

const getSourceLabel = (assetId, sourceMap) => {
  if (!assetId) return "Blank";
  return sourceMap?.get(assetId)?.label || "Unavailable";
};

const buildSourceCatalog = (filesResponse, inferenceResponse) => {
  const uploadSources = (filesResponse?.files || []).map((file) => ({
    assetId: `upload:${file.fileId}`,
    label: file.safeDisplayName || file.originalName || file.fileId,
    kind: "Track",
    subtext: file.instrumentalUrl ? "Processed upload" : "Upload",
  }));
  const inferenceSources = (inferenceResponse?.results || []).map((run) => ({
    assetId: `run:${run.runId || run.id}`,
    label:
      run.inputDisplayName ||
      run.inputOriginalName ||
      run.track?.displayName ||
      run.track?.name ||
      run.runId ||
      "Inference result",
    kind: "Inference",
    subtext: run.modelName || run.model?.name || "Converted vocal",
  }));
  const merged = [...uploadSources, ...inferenceSources];
  const unique = new Map();
  merged.forEach((source) => {
    if (!source.assetId || unique.has(source.assetId)) return;
    unique.set(source.assetId, source);
  });
  return Array.from(unique.values()).sort((a, b) => a.label.localeCompare(b.label));
};

const ProjectManagerModal = ({
  open,
  onClose,
  assetId,
  currentProjectId,
  onSwitchProject,
  scope = "asset",
}) => {
  const [projects, setProjects] = useState([]);
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const projectPromise =
          scope === "all" ? getAllProjects() : assetId ? getProjectsByAssetList(assetId) : Promise.resolve([]);
        const sourcesPromise =
          scope === "all"
            ? Promise.all([
                getAvailableFiles(),
                fetch("/api/past-inference-results").then((response) => {
                  if (!response.ok) throw new Error("Failed to load inference sources");
                  return response.json();
                }),
              ])
            : Promise.resolve([null, null]);
        const [projectData, sourceData] = await Promise.all([projectPromise, sourcesPromise]);
        if (cancelled) return;
        setProjects(Array.isArray(projectData) ? projectData : []);
        if (scope === "all") {
          const [filesResponse, inferenceResponse] = sourceData;
          setSources(buildSourceCatalog(filesResponse, inferenceResponse));
        } else {
          setSources([]);
        }
      } catch (err) {
        if (cancelled) return;
        console.error(err);
        setError("Failed to load Studio projects.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [open, assetId, scope]);

  const sourceMap = useMemo(() => {
    const next = new Map();
    sources.forEach((source) => {
      if (source?.assetId) next.set(source.assetId, source);
    });
    return next;
  }, [sources]);

  const groupedSources = useMemo(() => {
    if (scope !== "all") return [];
    const projectsByAssetId = new Map();
    projects.forEach((project) => {
      const meta = projMeta(project);
      const key = meta.assetId || "";
      const current = projectsByAssetId.get(key) || [];
      current.push(project);
      projectsByAssetId.set(key, current);
    });
    return sources.map((source) => ({
      ...source,
      projectCount: (projectsByAssetId.get(source.assetId) || []).length,
    }));
  }, [projects, scope, sources]);

  const sortedProjects = useMemo(() => {
    return [...projects].sort((a, b) => {
      const aTime = projMeta(a).updatedAt || projMeta(a).createdAt || "";
      const bTime = projMeta(b).updatedAt || projMeta(b).createdAt || "";
      return bTime.localeCompare(aTime);
    });
  }, [projects]);

  const handleCreate = async (nextAssetId = null) => {
    setActionLoading(true);
    setError(null);
    try {
      const data = await createProject(nextAssetId || null);
      onSwitchProject(data);
      onClose();
    } catch (err) {
      console.error(err);
      setError(nextAssetId ? "Failed to create a project from this track." : "Failed to create project.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleSwitch = async (projectId) => {
    if (projectId === currentProjectId) {
      onClose();
      return;
    }
    setActionLoading(true);
    setError(null);
    try {
      const data = await getProjectById(projectId);
      onSwitchProject(data);
      onClose();
    } catch (err) {
      console.error(err);
      setError("Failed to switch project.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async (projectId) => {
    const ok = window.confirm("Are you sure you want to delete this project? This cannot be undone.");
    if (!ok) return;
    setActionLoading(true);
    setError(null);
    try {
      await deleteProject(projectId);
      setProjects((prev) => prev.filter((project) => projMeta(project).id !== projectId));
      if (projectId === currentProjectId) {
        onClose();
      }
    } catch (err) {
      console.error(err);
      setError("Failed to delete project.");
    } finally {
      setActionLoading(false);
    }
  };

  if (!open) return null;

  const title = scope === "all" ? "Studio Projects" : "Project Switcher";

  return (
    <div className="studio-modal-backdrop" onClick={() => !actionLoading && onClose()}>
      <div
        className="studio-modal-panel wide"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="studio-modal-head">
          <div>
            <div className="studio-panel-title">{title}</div>
            <div className="studio-subtext">
              {scope === "all"
                ? "Open a project, or start a new one from a track."
                : "Projects created from this source track."}
            </div>
          </div>
          <button className="studio-mini" onClick={onClose} disabled={actionLoading}>
            Close
          </button>
        </div>

        <div className="studio-modal-body">
          {error ? <div className="studio-modal-error">{error}</div> : null}

          {loading ? (
            <div className="studio-empty">Loading projects...</div>
          ) : (
            <>
              <section className="studio-modal-section">
                <div className="studio-modal-section-title">
                  {scope === "all" ? "All projects" : "Existing projects"}
                </div>
                {sortedProjects.length ? (
                  /* One flat grid. Grouping by source track put every project
                     in a group of its own — each headed by the source's raw
                     assetId — so the list was one card per row with a uuid
                     above it. The Models view this borrows from is flat too. */
                  <div className="studio-card-grid">
                    {sortedProjects.map((item, index) => {
                      const meta = projMeta(item);
                      const projId = meta.id;
                      const isActive = projId === currentProjectId;
                      const timestamp = meta.updatedAt || meta.createdAt;
                      return (
                        <article
                          key={projId}
                          className={`studio-card${isActive ? " active" : ""}`}
                        >
                          <div
                            className="studio-card-head"
                            style={{ background: cardGradient(index) }}
                          >
                            <span className="studio-card-glyph" aria-hidden="true">
                              &#9835;
                            </span>
                            {isActive ? <span className="studio-card-badge">Open</span> : null}
                          </div>
                          <div className="studio-card-body">
                            <div>
                              <h3
                                className="studio-card-title"
                                title={getProjectLabel(item, sourceMap)}
                              >
                                {getProjectLabel(item, sourceMap)}
                              </h3>
                              <p className="studio-card-kicker">Studio Project</p>
                            </div>
                            <div className="studio-card-meta">
                              <div className="studio-card-stat">
                                <p className="studio-card-stat-label">Source</p>
                                <p className="studio-card-stat-value">
                                  {getSourceLabel(meta.assetId, sourceMap)}
                                </p>
                              </div>
                              <div className="studio-card-stat">
                                <p className="studio-card-stat-label">Updated</p>
                                <p className="studio-card-stat-value">
                                  {timestamp ? new Date(timestamp).toLocaleDateString() : "\u2014"}
                                </p>
                              </div>
                            </div>
                            <div className="studio-card-actions">
                              <button
                                className="studio-card-btn"
                                onClick={() => handleSwitch(projId)}
                                disabled={actionLoading || isActive}
                              >
                                {isActive ? "Current" : "Open"}
                              </button>
                              <button
                                className="studio-card-btn danger"
                                aria-label="Delete project"
                                title="Delete project"
                                disabled={actionLoading}
                                onClick={() => handleDelete(projId)}
                              >
                                &#10005;
                              </button>
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <div className="studio-empty">No projects yet.</div>
                )}
              </section>

              {scope === "all" ? (
                <section className="studio-modal-section">
                  <div className="studio-modal-section-title">Start something new</div>
                  <div className="studio-subtext">
                    Begin from a track or an inference result, or open a blank project.
                  </div>
                  <div className="studio-picker-list">
                    <div className="studio-picker-row">
                      <div className="studio-picker-main">
                        <div className="studio-picker-name">Blank project</div>
                        <div className="studio-picker-meta">No source track attached</div>
                      </div>
                      <button
                        className="studio-picker-action"
                        onClick={() => handleCreate(null)}
                        disabled={actionLoading}
                      >
                        Create
                      </button>
                    </div>
                    {groupedSources.map((source) => (
                      <div key={source.assetId} className="studio-picker-row">
                        <div className="studio-picker-main">
                          <div className="studio-picker-name">{source.label}</div>
                          <div className="studio-picker-meta">
                            {source.kind}
                            {" \u00b7 "}
                            {source.subtext}
                            {source.projectCount
                              ? ` \u00b7 ${source.projectCount} project${source.projectCount === 1 ? "" : "s"}`
                              : ""}
                          </div>
                        </div>
                        <button
                          className="studio-picker-action"
                          onClick={() => handleCreate(source.assetId)}
                          disabled={actionLoading}
                        >
                          New Project
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}
            </>
          )}
        </div>

        {scope !== "all" ? (
          <div className="studio-modal-foot">
            <button
              className="studio-btn accent"
              onClick={() => handleCreate(assetId)}
              disabled={actionLoading}
            >
              New Project From Track
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default ProjectManagerModal;
