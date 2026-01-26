import os
import re
from pydub import AudioSegment

# === CONFIG ===
DIARIZATION_TXT = "output/VALD_diarization.txt"  # change to your actual file
AUDIO_FILE = "audio/temp_input.wav"                    # the WAV file
OUTPUT_DIR = "audio/foldersong"                        # final split folder

# === PREP ===
os.makedirs(OUTPUT_DIR, exist_ok=True)
audio = AudioSegment.from_wav(AUDIO_FILE)

# === PROCESS ===
with open(DIARIZATION_TXT, "r", encoding="utf-8") as f:
    lines = f.readlines()

counters = {}

for line in lines:
    match = re.match(r"\[(\d+\.\d+) - (\d+\.\d+)\] (SPEAKER_\d+)", line.strip())
    if match:
        start, end, speaker = match.groups()
        start_ms = int(float(start) * 1000)
        end_ms = int(float(end) * 1000)

        speaker_folder = os.path.join(OUTPUT_DIR, speaker.lower())
        os.makedirs(speaker_folder, exist_ok=True)

        counters.setdefault(speaker, 0)
        counters[speaker] += 1

        part_filename = f"part{counters[speaker]}.wav"
        out_path = os.path.join(speaker_folder, part_filename)

        segment = audio[start_ms:end_ms]
        segment.export(out_path, format="wav")
        print(f"✅ Saved {out_path}")

print("🎉 Done splitting audio by speaker!")
