import React from "react";
import {
  Box,
  Typography,
  FormControlLabel,
  Switch,
  FormGroup,
  Paper,
  Grid,
  Divider,
  FormHelperText,
  Alert,
} from "@mui/material";

function ConfigOptions({ config, setConfig }) {
  const handleChange = (event) => {
    setConfig({
      ...config,
      [event.target.name]: event.target.checked,
    });
  };

  return (
    <Box>
      <Typography variant="h5" gutterBottom>
        Configure Processing Options
      </Typography>

      <Alert severity="info" sx={{ mb: 3 }}>
        When you start processing, all previous files will be automatically
        removed to ensure clean results.
      </Alert>

      <Grid container spacing={3}>
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 3, height: "100%" }}>
            <Typography variant="h6" gutterBottom>
              Audio Processing
            </Typography>
            <Divider sx={{ mb: 2 }} />

            <FormGroup>
              <FormControlLabel
                control={
                  <Switch
                    checked={config.process}
                    onChange={handleChange}
                    name="process"
                    color="primary"
                  />
                }
                label="Apply audio processing (noise reduction, normalization)"
              />
              <FormHelperText>
                When enabled, the tool will clean up the extracted vocals and
                improve quality.
              </FormHelperText>
            </FormGroup>
          </Paper>
        </Grid>

        {/* Dataset export removed */}
      </Grid>
    </Box>
  );
}

export default ConfigOptions;
