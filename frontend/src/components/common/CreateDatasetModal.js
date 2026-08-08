import React from 'react';
import {
  Modal,
  Box,
  Typography,
  Divider,
  Grid,
  Card,
  CardContent,
  CardActions,
  Button
} from '@mui/material';
import MicIcon from '@mui/icons-material/MicOutlined';
import MusicNoteIcon from '@mui/icons-material/MusicNoteOutlined';

const modalStyle = {
  position: 'absolute',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  width: 500,
  bgcolor: 'background.paper',
  borderRadius: 2,
  boxShadow: 24,
  p: 4,
};

/**
 * Modal for creating new datasets (singing or talking)
 */
function CreateDatasetModal({
  open,
  onClose,
  onCreateSingingDataset,
  onCreateTalkingDataset,
}) {
  const handleCreateSinging = () => {
    onCreateSingingDataset();
    onClose();
  };

  const handleCreateTalking = () => {
    onCreateTalkingDataset();
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      aria-labelledby="modal-create-dataset"
    >
      <Box sx={modalStyle}>
        <Typography
          id="modal-create-dataset"
          variant="h6"
          component="h2"
          sx={{ mb: 3 }}
        >
          Create New Dataset
        </Typography>
        <Divider sx={{ mb: 3 }} />

        <Grid container spacing={3}>
          <Grid item xs={12} md={6}>
            <Card
              sx={{
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <CardContent sx={{ flexGrow: 1, textAlign: 'center', py: 4 }}>
                <MicIcon
                  sx={{ fontSize: 60, color: 'secondary.main', mb: 2 }}
                />
                <Typography variant="h6" gutterBottom>
                  Talking Dataset
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Create a dataset for speech processing and TTS models.
                </Typography>
              </CardContent>
              <CardActions sx={{ justifyContent: 'center', pb: 2 }}>
                <Button
                  variant="contained"
                  color="secondary"
                  onClick={handleCreateTalking}
                  sx={{ borderRadius: 50, px: 3 }}
                >
                  Create
                </Button>
              </CardActions>
            </Card>
          </Grid>

          <Grid item xs={12} md={6}>
            <Card
              sx={{
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <CardContent sx={{ flexGrow: 1, textAlign: 'center', py: 4 }}>
                <MusicNoteIcon
                  sx={{ fontSize: 60, color: 'secondary.main', mb: 2 }}
                />
                <Typography variant="h6" gutterBottom>
                  Singing Dataset
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Create a dataset for singing voice synthesis models.
                </Typography>
              </CardContent>
              <CardActions sx={{ justifyContent: 'center', pb: 2 }}>
                <Button
                  variant="contained"
                  color="secondary"
                  onClick={handleCreateSinging}
                  sx={{ borderRadius: 50, px: 3 }}
                >
                  Create
                </Button>
              </CardActions>
            </Card>
          </Grid>
        </Grid>
      </Box>
    </Modal>
  );
}

export default CreateDatasetModal;
