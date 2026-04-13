import React, { useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Typography,
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import {
  createProject,
  deleteProject,
  getAllProjects,
  getProjectById,
  getProjectsByAssetList,
} from "../api";
import { getAvailableFiles } from "../../utils/apiService";

const projMeta = (item) => item?.project || {};

const getProjectLabel = (item) => {
  const meta = projMeta(item);
  if (meta.name) return meta.name;
  if (!meta.assetId) return "Blank Studio Project";
  return meta.id ? `Project ${meta.id.substring(0, 6)}` : "Unnamed Project";
};

const getSourceLabel = (assetId, sourceMap) => {
  if (!assetId) return "Blank project";
  return sourceMap.get(assetId)?.label || assetId;
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

  const groupedProjects = useMemo(() => {
    if (scope !== "all") {
      return [
        {
          key: assetId || "current",
          label: assetId ? getSourceLabel(assetId, sourceMap) : "Current track",
          projects: sortedProjects,
        },
      ];
    }
    const groups = new Map();
    sortedProjects.forEach((project) => {
      const meta = projMeta(project);
      const key = meta.assetId || "__blank__";
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          label: meta.assetId ? getSourceLabel(meta.assetId, sourceMap) : "Blank projects",
          projects: [],
        });
      }
      groups.get(key).projects.push(project);
    });
    return Array.from(groups.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [assetId, scope, sortedProjects, sourceMap]);

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

  return (
    <Dialog open={open} onClose={() => !actionLoading && onClose()} maxWidth="md" fullWidth>
      <DialogTitle>{scope === "all" ? "Studio Projects" : "Project Switcher"}</DialogTitle>
      <DialogContent dividers>
        {error && (
          <Typography color="error" gutterBottom>
            {error}
          </Typography>
        )}
        {loading ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
            <CircularProgress />
          </Box>
        ) : (
          <Box sx={{ display: "grid", gap: 3 }}>
            {scope === "all" ? (
              <>
                <Box>
                  <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
                    Start from scratch
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                    Open a completely blank Studio project with no source track attached.
                  </Typography>
                  <Button
                    variant="contained"
                    onClick={() => handleCreate(null)}
                    disabled={actionLoading}
                  >
                    New Blank Project
                  </Button>
                </Box>

                <Box>
                  <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
                    Start from track
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                    Pick any available track or inference result and start a fresh Studio project from it.
                  </Typography>
                  {groupedSources.length ? (
                    <List sx={{ display: "grid", gap: 1 }}>
                      {groupedSources.map((source) => (
                        <ListItem
                          key={source.assetId}
                          sx={{
                            border: "1px solid",
                            borderColor: "divider",
                            borderRadius: 2,
                            alignItems: "center",
                            gap: 2,
                          }}
                        >
                          <ListItemText
                            primary={source.label}
                            secondary={`${source.kind} · ${source.subtext}${source.projectCount ? ` · ${source.projectCount} existing project${source.projectCount === 1 ? "" : "s"}` : ""}`}
                          />
                          <Button
                            variant="outlined"
                            size="small"
                            onClick={() => handleCreate(source.assetId)}
                            disabled={actionLoading}
                          >
                            New Project
                          </Button>
                        </ListItem>
                      ))}
                    </List>
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      No track sources are available yet.
                    </Typography>
                  )}
                </Box>
              </>
            ) : null}

            <Box>
              <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
                Existing projects
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                {scope === "all"
                  ? "All Studio projects across every source track."
                  : "Projects already created from this source track."}
              </Typography>
              {sortedProjects.length ? (
                <Box sx={{ display: "grid", gap: 2 }}>
                  {groupedProjects.map((group) => (
                    <Box key={group.key}>
                      {scope === "all" ? (
                        <Typography variant="body2" sx={{ fontWeight: 700, mb: 1, color: "text.secondary" }}>
                          {group.label}
                        </Typography>
                      ) : null}
                      <List sx={{ display: "grid", gap: 1 }}>
                        {group.projects.map((item) => {
                          const meta = projMeta(item);
                          const projId = meta.id;
                          const isActive = projId === currentProjectId;
                          const timestamp = meta.updatedAt || meta.createdAt;
                          return (
                            <ListItem
                              key={projId}
                              sx={{
                                border: "1px solid",
                                borderColor: isActive ? "primary.main" : "divider",
                                borderRadius: 2,
                                bgcolor: isActive ? "action.selected" : "transparent",
                                alignItems: "center",
                                gap: 2,
                              }}
                            >
                              <ListItemText
                                primary={getProjectLabel(item)}
                                secondary={timestamp ? new Date(timestamp).toLocaleString() : null}
                              />
                              <Button
                                variant={isActive ? "outlined" : "contained"}
                                size="small"
                                onClick={() => handleSwitch(projId)}
                                disabled={actionLoading || isActive}
                              >
                                {isActive ? "Active" : "Open"}
                              </Button>
                              <IconButton
                                edge="end"
                                aria-label="delete"
                                color="error"
                                disabled={actionLoading}
                                onClick={() => handleDelete(projId)}
                              >
                                <DeleteIcon />
                              </IconButton>
                            </ListItem>
                          );
                        })}
                      </List>
                    </Box>
                  ))}
                </Box>
              ) : (
                <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
                  No projects yet.
                </Typography>
              )}
            </Box>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={actionLoading}>
          Close
        </Button>
        {scope !== "all" ? (
          <Button onClick={() => handleCreate(assetId)} color="primary" variant="contained" disabled={actionLoading}>
            New Project From Track
          </Button>
        ) : null}
      </DialogActions>
    </Dialog>
  );
};

export default ProjectManagerModal;
