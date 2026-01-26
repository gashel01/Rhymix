# Rhymix

A comprehensive audio processing application for voice conversion, vocal separation, speaker diarization, and AI-powered song generation. Built with Flask backend and React frontend, integrating Applio (RVC) for high-quality voice transformation and ACE-Step for music generation.

## Features

- **Song Generation**: Generate complete songs from text prompts and lyrics using ACE-Step AI foundation model
- **Vocal Separation**: Extract vocals and instrumentals from audio files
- **Speaker Diarization**: Separate multiple speakers in audio recordings
- **Voice Model Training**: Train custom voice models using Applio (RVC)
- **Voice Inference**: Convert voices using trained models
- **Audio Processing**: Clean and process audio files with various tools
- **Web Interface**: Modern React-based UI for easy interaction

## Prerequisites

- **Python 3.10** (required for backend)
- **Node.js** and **npm** (required for frontend)
- **CUDA 12.1** compatible GPU (recommended for PyTorch)
- **Windows** (current setup is optimized for Windows)

## Installation

### Backend Setup

1. **Create a virtual environment**:
   ```bash
   py -3.10 -m venv venv
   ```

2. **Activate the virtual environment**:
   ```bash
   venv\Scripts\activate
   ```

3. **Install Python dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

4. **Install PyTorch with CUDA 12.1 support**:
   ```bash
   pip install torch==2.4.1 torchvision==0.19.1 torchaudio==2.4.1 --index-url https://download.pytorch.org/whl/cu121
   ```

### Frontend Setup

1. **Navigate to the frontend directory**:
   ```bash
   cd frontend
   ```

2. **Install Node.js dependencies**:
   ```bash
   npm install
   ```

## Running the Application

### Backend

1. **Activate the virtual environment** (if not already activated):
   ```bash
   venv\Scripts\activate
   ```

2. **Start the Flask server**:
   ```bash
   python app.py
   ```

   The backend will typically run on `http://localhost:5000`

### Frontend

1. **Navigate to the frontend directory**:
   ```bash
   cd frontend
   ```

2. **Start the React development server**:
   ```bash
   npm start
   ```

   The frontend will typically run on `http://localhost:3001`

## Project Structure

```
Rhymix/
├── app.py                 # Main Flask application
├── applio/                # Applio (RVC) integration
│   ├── core.py           # Core Applio functions
│   ├── rvc/              # RVC model configurations
│   └── tabs/             # Applio UI components
├── ACE-Step/              # ACE-Step music generation model
│   ├── acestep/          # ACE-Step core modules
│   ├── checkpoints/      # Model checkpoints (if available)
│   └── venv/             # ACE-Step virtual environment (optional)
├── app/                   # Application modules
│   ├── config.py         # Configuration settings
│   ├── routes/           # API routes
│   └── utils/            # Utility functions
├── frontend/              # React frontend application
│   └── src/              # React source files
├── data/                  # Data directories (created at runtime)
│   ├── singing/          # Singing voice processing data
│   ├── talking/          # Speaker diarization data
│   └── generated_songs/  # ACE-Step generated songs
├── logs/                  # Trained models storage
├── diarization/           # Speaker diarization modules
└── requirements.txt       # Python dependencies
```

## API Endpoints

The Flask backend provides REST API endpoints for:

- `/api/song-generation/start` - Start a new song generation job (ACE-Step)
- `/api/song-generation/status/<job_id>` - Check song generation job status
- `/api/song-generation/jobs` - List all song generation jobs
- `/api/song-generation/audio/<job_id>` - Stream generated song audio
- `/api/upload` - Upload audio files
- `/api/process` - Process audio files (vocal separation)
- `/api/upload-talking` - Upload files for speaker diarization
- `/api/talking-status/<job_id>` - Check diarization job status
- `/api/train` - Train voice models
- `/api/inference` - Perform voice conversion
- `/api/download/<file_type>/<filename>` - Download processed files

## Technologies Used

- **Backend**: Flask, Python 3.10
- **Frontend**: React, Material-UI
- **Audio Processing**: librosa, soundfile, pydub, pyannote.audio
- **Machine Learning**: PyTorch, Applio (RVC)
- **Voice Conversion**: RVC (Retrieval-based Voice Conversion)
- **Music Generation**: ACE-Step (AI foundation model for music generation)

## Notes

- **ACE-Step Setup**: ACE-Step may require its own virtual environment and model checkpoints. The application will attempt to use ACE-Step's venv if available, otherwise falls back to the main Python environment
- **Song Generation**: Generated songs can be automatically processed through vocal separation and voice conversion workflows
- Ensure you have sufficient disk space for model training, audio processing, and generated songs
- GPU acceleration is recommended for faster processing, especially for ACE-Step song generation
- The application creates necessary directories automatically on first run

## Troubleshooting

- **CUDA errors**: Ensure you have CUDA 12.1 compatible drivers installed
- **Import errors**: Make sure the virtual environment is activated and all dependencies are installed
- **Port conflicts**: If ports 5000 or 3001 are in use, modify the configuration accordingly
- **Memory issues**: Large audio files may require significant RAM/VRAM

## License

Please refer to the individual component licenses:
- Applio: See `applio/TERMS_OF_USE.md`
- ACE-Step: See `ACE-Step/` directory for license information

## Contributing

This project integrates multiple open-source components. When contributing, please ensure compatibility with existing integrations.
