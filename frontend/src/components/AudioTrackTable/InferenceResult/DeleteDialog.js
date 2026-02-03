import { Dialog, DialogTitle, DialogContent, DialogActions, DialogContentText, Button } from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";

const DeleteDialog = ({ deleteDialogOpen, setDeleteDialogOpen, selectedRows, isDeleting, confirmDelete }) => {
  return (
    
    <Dialog
open={deleteDialogOpen}
onClose={() => setDeleteDialogOpen(false)}
aria-labelledby="delete-dialog-title"
aria-describedby="delete-dialog-description"
>
<DialogTitle id="delete-dialog-title">
  Delete Selected Results
</DialogTitle>
<DialogContent>
  <DialogContentText id="delete-dialog-description">
    Are you sure you want to delete {selectedRows.length} inference result{selectedRows.length !== 1 ? 's' : ''}?
    This will permanently remove the converted audio files.
    This action cannot be undone.
  </DialogContentText>
</DialogContent>
<DialogActions>
  <Button
    onClick={() => setDeleteDialogOpen(false)}
    color="primary"
    disabled={isDeleting}
  >
    Cancel
  </Button>
  <Button
    onClick={confirmDelete}
    color="error"
    variant="contained"
    disabled={isDeleting}
    startIcon={isDeleting ? null : <DeleteIcon />}
  >
    {isDeleting ? 'Deleting...' : 'Delete'}
  </Button>
</DialogActions>
</Dialog>
  );
}
export default DeleteDialog;