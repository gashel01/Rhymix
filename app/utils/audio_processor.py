import subprocess
import logging
from pathlib import Path
from typing import Optional, Tuple

logger = logging.getLogger(__name__)


class AudioProcessor:
    """Utility class for audio processing operations"""
    
    @staticmethod
    def mix_audio_tracks(
        vocal_path: Path, 
        instrumental_path: Path, 
        output_path: Path,
        sample_rate: int = 44100,
        channels: int = 2
    ) -> None:
        """
        Mix vocal and instrumental tracks using ffmpeg
        Args:
            vocal_path: Path to vocal track
            instrumental_path: Path to instrumental track
            output_path: Output file path
            sample_rate: Output sample rate (default 44100)
            channels: Output channels (default 2)
        Raises:
            subprocess.CalledProcessError: If ffmpeg fails
        """
        cmd = [
            "ffmpeg", "-y",
            "-i", str(instrumental_path),
            "-i", str(vocal_path),
            "-filter_complex", "amix=inputs=2:duration=longest:dropout_transition=2",
            "-ar", str(sample_rate),
            "-ac", str(channels),
            str(output_path)
        ]
        
        logger.debug(f"Mixing audio with command: {' '.join(cmd)}")
        subprocess.run(cmd, check=True)
        logger.info(f"Successfully mixed audio to {output_path}")

    @staticmethod
    def extract_audio_segment(
        input_path: Path,
        output_path: Path,
        start_time: float,
        duration: float,
        sample_rate: int = 44100,
        channels: int = 1
    ) -> None:
        """
        Extract segment from audio file using ffmpeg
        Args:
            input_path: Input audio file
            output_path: Output segment file
            start_time: Start time in seconds
            duration: Segment duration in seconds
            sample_rate: Output sample rate (default 44100)
            channels: Output channels (default 1)
        Raises:
            subprocess.CalledProcessError: If ffmpeg fails
        """
        cmd = [
            "ffmpeg", "-y",
            "-ss", str(start_time),
            "-i", str(input_path),
            "-t", str(duration),
            "-acodec", "pcm_s16le",
            "-ar", str(sample_rate),
            "-ac", str(channels),
            str(output_path)
        ]
        
        logger.debug(f"Extracting audio segment with command: {' '.join(cmd)}")
        subprocess.run(cmd, check=True)
        logger.info(f"Extracted segment {start_time}-{start_time+duration}s to {output_path}")

    @staticmethod
    def get_audio_duration(file_path: Path) -> float:
        """
        Get duration of audio file in seconds
        Args:
            file_path: Path to audio file
        Returns:
            Duration in seconds
        """
        try:
            import wave
            with wave.open(str(file_path), 'rb') as wf:
                return wf.getnframes() / wf.getframerate()
        except Exception as e:
            logger.warning(f"Could not get duration for {file_path}: {e}")
            return 0.0

    @staticmethod
    def create_zip_archive(files: list[Path], output_path: Path) -> None:
        """
        Create zip archive of files
        Args:
            files: List of files to include
            output_path: Output zip file path
        """
        import zipfile
        with zipfile.ZipFile(output_path, 'w') as zipf:
            for file in files:
                if file.exists():
                    zipf.write(file, file.name)
                    logger.debug(f"Added {file} to archive")
        
        logger.info(f"Created zip archive at {output_path}")

    @staticmethod
    def handle_unknown_segments(
        original_audio_path: Path,
        speaker_segments: list[dict],
        output_dir: Path,
        sample_rate: int = 44100,
        min_gap_duration: float = 0.5  # Minimum gap duration to consider
    ) -> list[Path]:
        """
        Process gaps between speaker segments as unknown/non-speech segments
        Args:
            original_audio_path: Path to original audio file
            speaker_segments: List of speaker segments with 'start' and 'end' times
            output_dir: Directory to save unknown segments (will create speaker_unknown)
            sample_rate: Output sample rate (default 44100)
            min_gap_duration: Minimum gap duration to extract (default 0.5 seconds)
        Returns:
            List of paths to saved unknown segments
        """
        # Check if we have a valid audio file
        if not original_audio_path.exists():
            logger.error(f"Original audio file not found: {original_audio_path}")
            return []
            
        # Get the total duration of the audio file
        try:
            cmd = ["ffprobe", "-v", "error", "-show_entries", "format=duration", 
                   "-of", "default=noprint_wrappers=1:nokey=1", str(original_audio_path)]
            result = subprocess.run(cmd, capture_output=True, text=True, check=True)
            total_duration = float(result.stdout.strip())
            logger.info(f"Total audio duration: {total_duration} seconds")
        except Exception as e:
            logger.error(f"Error getting audio duration: {e}")
            # Fallback to maximum end time from segments
            if speaker_segments:
                total_duration = max(segment['end'] for segment in speaker_segments)
                logger.info(f"Using fallback duration from segments: {total_duration} seconds")
            else:
                logger.error("Cannot determine audio duration and no segments provided")
                return []
        
        # Sort segments by start time
        sorted_segments = sorted(speaker_segments, key=lambda x: x['start'])
        
        # Find gaps between segments
        gaps = []
        current_time = 0
        
        for segment in sorted_segments:
            start_time = segment['start']
            end_time = segment['end']
            
            # Check if there's a gap between current_time and this segment
            if start_time - current_time > min_gap_duration:
                gaps.append({
                    'start': current_time,
                    'end': start_time,
                    'duration': start_time - current_time
                })
            
            # Update current_time to the end of this segment
            current_time = max(current_time, end_time)
        
        # Check for final gap after the last segment
        if total_duration - current_time > min_gap_duration:
            gaps.append({
                'start': current_time,
                'end': total_duration,
                'duration': total_duration - current_time
            })
        
        # Create speaker_unknown directory inside the output directory
        unknown_dir = output_dir / "speaker_unknown"
        unknown_dir.mkdir(exist_ok=True, parents=True)
        
        # Extract and save each gap segment
        saved_files = []
        for i, gap in enumerate(gaps):
            try:
                # Create a meaningful filename with timestamp
                # Include both standard format and precise decimal format
                start_str = f"{int(gap['start'] // 60):02d}m{int(gap['start'] % 60):02d}s"
                end_str = f"{int(gap['end'] // 60):02d}m{int(gap['end'] % 60):02d}s"
                
                # Also include precise timestamp format with milliseconds
                precise_start = f"{gap['start']:.3f}s"
                precise_end = f"{gap['end']:.3f}s"
                
                # Combined filename with both formats
                output_path = unknown_dir / f"part{i+1}_{start_str}-{end_str}_{precise_start}-{precise_end}.wav"
                
                AudioProcessor.extract_audio_segment(
                    input_path=original_audio_path,
                    output_path=output_path,
                    start_time=gap['start'],
                    duration=gap['duration'],
                    sample_rate=sample_rate
                )
                
                saved_files.append(output_path)
                logger.info(f"Saved unknown segment {i+1} ({gap['start']:.3f}s - {gap['end']:.3f}s) to {output_path}")
            except Exception as e:
                logger.error(f"Error extracting unknown segment {i+1}: {e}")
                continue
        
        logger.info(f"Created {len(saved_files)} unknown segments in {unknown_dir}")
        return saved_files 