import sys
import os
from pathlib import Path
from pydub import AudioSegment
import re

def split_audio_by_speaker(diarization_file, audio_file, output_dir):
    """
    Split audio file into segments by speaker based on diarization results.
    
    Args:
        diarization_file: Path to the diarization output text file
        audio_file: Path to the original audio file
        output_dir: Directory to save the split audio files
    """
    print(f"Splitting audio file: {audio_file}")
    print(f"Using diarization file: {diarization_file}")
    print(f"Output directory: {output_dir}")
    
    # Create output directory if it doesn't exist
    output_dir = Path(output_dir)
    output_dir.mkdir(exist_ok=True, parents=True)
    
    # Load the audio file
    audio_ext = os.path.splitext(audio_file)[1].lower()
    if audio_ext == ".mp3":
        audio = AudioSegment.from_mp3(audio_file)
    else:
        audio = AudioSegment.from_wav(audio_file)
    
    # Initialize counters for each speaker
    counters = {}
    speakers = {}
    
    # Parse the diarization file
    print("Parsing diarization file...")
    with open(diarization_file, "r", encoding="utf-8") as f:
        for line in f:
            match = re.match(r"\[(\d+\.\d+) - (\d+\.\d+)\] (SPEAKER_\d+)", line.strip())
            if match:
                start, end, speaker = match.groups()
                start_ms = int(float(start) * 1000)
                end_ms = int(float(end) * 1000)
                
                # Create speaker directory
                speaker_dir = output_dir / speaker.lower()
                speaker_dir.mkdir(exist_ok=True, parents=True)
                
                # Initialize counter if this is the first time seeing this speaker
                counters.setdefault(speaker, 0)
                counters[speaker] += 1
                
                # Keep track of segments per speaker
                speakers.setdefault(speaker, 0)
                speakers[speaker] += 1
                
                # Generate filename for this segment
                filename = f"part{counters[speaker]:03d}.wav"
                part_path = speaker_dir / filename
                
                # Extract and save segment
                segment = audio[start_ms:end_ms]
                segment.export(str(part_path), format="wav")
                print(f"Saved segment: {part_path}")
    
    print(f"Completed splitting audio. Found {len(speakers)} speakers:")
    for speaker, count in speakers.items():
        print(f"  - {speaker}: {count} segments")
    
    return speakers

if __name__ == "__main__":
    if len(sys.argv) != 4:
        print("Usage: python web_split_by_speaker.py <diarization_file> <audio_file> <output_dir>")
        sys.exit(1)
    
    diarization_file = sys.argv[1]
    audio_file = sys.argv[2]
    output_dir = sys.argv[3]
    
    split_audio_by_speaker(diarization_file, audio_file, output_dir) 