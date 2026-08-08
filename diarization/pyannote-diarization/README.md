# Speaker Diarization with Vocal Separation

This module performs speaker diarization on audio files using the PyAnnote speaker diarization model.

## Recent Enhancements

### Vocal Track Diarization

The system now performs diarization and segment extraction on the **separated vocal track** instead of the original mixed audio. This provides several benefits:

- **Improved Speech Detection**: Removes background music and noise that can interfere with speaker detection
- **Cleaner Speaker Segments**: Generated audio segments contain clearer speech with reduced background noise
- **More Accurate Speaker Boundaries**: Speaker boundaries are more precise when background sounds are removed

## How It Works

1. **Vocal Separation**: When an audio file is uploaded, the `clean_diarize.py` script first performs vocal separation using a deep learning model
2. **Diarization**: The system now automatically looks for the separated vocal track and uses it for speaker diarization
3. **Segment Extraction**: Speaker segments are extracted from the separated vocal track for cleaner playback

## Technical Details

- Separated vocal tracks are stored in both:
  - `data/talking/temp/{filename}_vocals.wav`
  - `diarization/pyannote-diarization/temp/{filename}_vocals.wav`
- Diarization scripts check multiple locations for vocal tracks before falling back to the original audio
- If a vocal track is not found, the system gracefully falls back to using the original mixed audio

## Scripts

- `diarize.py`: Main diarization script
- `direct_diarize.py`: Alternative implementation with direct API access
- `simple_diarize.py`: Simplified implementation for specific use cases
- `clean_diarize.py`: Performs vocal separation before diarization
