import os
import re
import logging
import subprocess
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Any

from app.utils.audio_processor import AudioProcessor
from app.utils.file_handling import FileHandler

logger = logging.getLogger(__name__)


class DiarizationProcessor:
    """Utility class for processing speaker diarization results"""
    
    @staticmethod
    def parse_diarization_output(output_file: Path) -> List[Dict[str, Any]]:
        """
        Parse the diarization output file containing segment information
        Args:
            output_file: Path to the diarization output file
        Returns:
            List of segment dictionaries with speaker, start, and end times
        """
        segments = []
        
        # Check if the file exists
        if not output_file.exists():
            logger.error(f"Diarization output file not found: {output_file}")
            return segments
        
        # Parse the file
        try:
            with open(output_file, 'r') as f:
                for line in f:
                    # Parse the line, expected format: "[start_time - end_time] SPEAKER_XX"
                    match = re.match(r'\[(\d+\.\d+)\s*-\s*(\d+\.\d+)\]\s*(\S+)', line.strip())
                    if match:
                        start_time = float(match.group(1))
                        end_time = float(match.group(2))
                        speaker = match.group(3)
                        
                        segments.append({
                            'speaker': speaker,
                            'start': start_time,
                            'end': end_time
                        })
            
            logger.info(f"Parsed {len(segments)} segments from {output_file}")
            return segments
            
        except Exception as e:
            logger.error(f"Error parsing diarization output: {e}")
            return segments
    
    @staticmethod
    def process_speaker_segments(
        original_audio_path: Path,
        segments: List[Dict[str, Any]],
        output_base_dir: Path,
        include_unknown_segments: bool = True,
        min_gap_duration: float = 0.5
    ) -> Dict[str, Any]:
        """
        Process all speaker segments and unknown segments
        Args:
            original_audio_path: Path to the original audio file
            segments: List of speaker segments
            output_base_dir: Base directory for output
            include_unknown_segments: Whether to extract unknown segments (default True)
            min_gap_duration: Minimum duration for unknown segments (default 0.5 seconds)
        Returns:
            Dictionary with processing results
        """
        if not segments:
            logger.error("No segments provided for processing")
            return {"success": False, "error": "No segments provided"}
        
        # Group segments by speaker
        speakers = {}
        for segment in segments:
            speaker = segment["speaker"]
            if speaker not in speakers:
                speakers[speaker] = []
            speakers[speaker].append(segment)
        
        # Ensure the base output directory exists
        FileHandler.ensure_directory_exists(output_base_dir)
        
        # Process each speaker's segments
        speaker_results = {}
        for speaker, speaker_segments in speakers.items():
            try:
                # Create speaker directory
                speaker_dir = output_base_dir / speaker.lower()
                FileHandler.ensure_directory_exists(speaker_dir)
                
                # Extract each segment for this speaker
                segment_files = []
                for i, segment in enumerate(speaker_segments):
                    # Format timestamps for filename - include both formats
                    start_mins = int(segment['start'] // 60)
                    start_secs = int(segment['start'] % 60)
                    end_mins = int(segment['end'] // 60)
                    end_secs = int(segment['end'] % 60)
                    
                    # Also include precise timestamp format with milliseconds
                    precise_start = f"{segment['start']:.3f}s"
                    precise_end = f"{segment['end']:.3f}s"
                    
                    # Create filename with both standard and precise formats
                    start_str = f"{start_mins:02d}m{start_secs:02d}s"
                    end_str = f"{end_mins:02d}m{end_secs:02d}s"
                    
                    # Combined format matching the unknown segments pattern
                    output_path = speaker_dir / f"{speaker}_{i+1}_{start_str}-{end_str}_{precise_start}-{precise_end}.wav"
                    
                    AudioProcessor.extract_audio_segment(
                        input_path=original_audio_path,
                        output_path=output_path,
                        start_time=segment['start'],
                        duration=segment['end'] - segment['start']
                    )
                    
                    segment_files.append(output_path)
                
                # Store results for this speaker
                speaker_results[speaker] = {
                    "directory": str(speaker_dir),
                    "segment_count": len(segment_files),
                    "segment_files": [str(f) for f in segment_files]
                }
                
                logger.info(f"Processed {len(segment_files)} segments for {speaker}")
                
            except Exception as e:
                logger.error(f"Error processing segments for {speaker}: {e}")
                speaker_results[speaker] = {
                    "error": str(e),
                    "segment_count": 0,
                    "segment_files": []
                }
        
        # Process unknown segments (gaps between speaker segments)
        if include_unknown_segments:
            try:
                unknown_files = AudioProcessor.handle_unknown_segments(
                    original_audio_path=original_audio_path,
                    speaker_segments=segments,
                    output_dir=output_base_dir,
                    min_gap_duration=min_gap_duration
                )
                
                if unknown_files:
                    speaker_results["UNKNOWN"] = {
                        "directory": str(output_base_dir / "speaker_unknown"),
                        "segment_count": len(unknown_files),
                        "segment_files": [str(f) for f in unknown_files]
                    }
            except Exception as e:
                logger.error(f"Error processing unknown segments: {e}")
                speaker_results["UNKNOWN"] = {
                    "error": str(e),
                    "segment_count": 0,
                    "segment_files": []
                }
        
        return {
            "success": True,
            "original_audio": str(original_audio_path),
            "output_directory": str(output_base_dir),
            "total_segments": len(segments),
            "speaker_count": len(speakers),
            "speakers": speaker_results
        } 