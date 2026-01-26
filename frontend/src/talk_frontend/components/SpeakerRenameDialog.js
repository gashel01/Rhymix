import React from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  TextField,
} from "@mui/material";

const SpeakerRenameDialog = ({
  open,
  onClose,
  speakerToRename,
  newSpeakerName,
  setNewSpeakerName,
  handleSaveNewName,
}) => {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Rename Speaker</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}>
          Enter a new name for{" "}
          {speakerToRename === "Unknown" ? "No Speech" : speakerToRename}
        </Typography>
        <TextField
          autoFocus
          margin="dense"
          label="Speaker Name"
          type="text"
          fullWidth
          value={newSpeakerName}
          onChange={(e) => setNewSpeakerName(e.target.value)}
          variant="outlined"
        />
        <Typography
          variant="caption"
          color="textSecondary"
          sx={{ mt: 1, display: "block" }}
        >
          Note: This will only change the name in the user interface.
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={handleSaveNewName} color="primary" variant="contained">
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default SpeakerRenameDialog;
