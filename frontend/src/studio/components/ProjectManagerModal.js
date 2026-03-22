import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  CircularProgress,
  IconButton,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  Typography,
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import { getProjectsByAssetList, deleteProject, createProject, getProjectById } from "../api";

/** Each item from the list API is the full payload:
 *  { project: {id, name, assetId, createdAt, updatedAt, ...}, lanes, clips, assets, metadata }
 *  We use a small helper to pull the inner project meta.
 */
const projMeta = (item) => item?.project || {};

const ProjectManagerModal = ({ open, onClose, assetId, currentProjectId, onSwitchProject }) => {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open && assetId) {
      loadProjects();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, assetId]);

  const loadProjects = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getProjectsByAssetList(assetId);
      // data is an array of full payloads; sort by updatedAt desc
      const sorted = (data || []).sort((a, b) => {
        const aTime = projMeta(a).updatedAt || projMeta(a).createdAt || "";
        const bTime = projMeta(b).updatedAt || projMeta(b).createdAt || "";
        return bTime.localeCompare(aTime);
      });
      setProjects(sorted);
    } catch (err) {
      console.error(err);
      setError("Failed to load projects.");
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    setActionLoading(true);
    setError(null);
    try {
      const data = await createProject(assetId);
      onSwitchProject(data);
      onClose();
    } catch (err) {
      console.error(err);
      setError("Failed to create project.");
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
      const remaining = projects.filter(p => projMeta(p).id !== projectId);
      setProjects(remaining);
      // If we deleted the currently open project, switch to the next available one
      if (projectId === currentProjectId) {
        if (remaining.length > 0) {
          await handleSwitch(projMeta(remaining[0]).id);
        } else {
          await handleCreate();
        }
      }
    } catch (err) {
      console.error(err);
      setError("Failed to delete project.");
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <Dialog open={open} onClose={() => !actionLoading && onClose()} maxWidth="sm" fullWidth>
      <DialogTitle>Project Manager</DialogTitle>
      <DialogContent dividers>
        {error && <Typography color="error" gutterBottom>{error}</Typography>}
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 20 }}>
            <CircularProgress />
          </div>
        ) : (
          <List>
            {projects.map((item) => {
              const meta = projMeta(item);
              const projId = meta.id;
              const isActive = projId === currentProjectId;
              const label = meta.name || (projId ? `Project ${projId.substring(0, 6)}` : "Unnamed");
              const timestamp = meta.updatedAt || meta.createdAt;
              return (
                <ListItem
                  key={projId}
                  sx={{
                    border: '1px solid',
                    borderColor: isActive ? 'primary.main' : 'divider',
                    borderRadius: '8px',
                    mb: 1,
                    bgcolor: isActive ? 'action.selected' : 'transparent',
                  }}
                >
                  <ListItemText
                    primary={label}
                    secondary={timestamp ? new Date(timestamp).toLocaleString() : null}
                  />
                  <ListItemSecondaryAction>
                    <Button
                      variant={isActive ? "outlined" : "contained"}
                      color="primary"
                      size="small"
                      onClick={() => handleSwitch(projId)}
                      disabled={actionLoading || isActive}
                      sx={{ mr: 1 }}
                    >
                      {isActive ? "Active" : "Switch"}
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
                  </ListItemSecondaryAction>
                </ListItem>
              );
            })}
            {projects.length === 0 && !loading && (
              <Typography variant="body2" color="textSecondary" align="center" sx={{ py: 2 }}>
                No projects yet. Create one to get started!
              </Typography>
            )}
          </List>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={actionLoading}>Cancel</Button>
        <Button onClick={handleCreate} color="primary" variant="contained" disabled={actionLoading}>
          Create New Project
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ProjectManagerModal;
