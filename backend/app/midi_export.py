import base64
from typing import List, Dict

import mido


def notes_to_midi_base64(
    notes: List[Dict],
    bpm: float,
    ppq: int,
    time_sig=(4, 4),
) -> str:
    midi = mido.MidiFile(ticks_per_beat=ppq)
    track = mido.MidiTrack()
    midi.tracks.append(track)

    tempo = mido.bpm2tempo(bpm)
    track.append(mido.MetaMessage("set_tempo", tempo=tempo, time=0))
    track.append(
        mido.MetaMessage("time_signature", numerator=time_sig[0], denominator=time_sig[1], time=0)
    )

    # Sort by startTick
    notes_sorted = sorted(notes, key=lambda n: n.get("startTick", 0))
    current_tick = 0
    for note in notes_sorted:
        start_tick = int(note.get("startTick", 0))
        duration_tick = int(note.get("durationTick", 0))
        pitch = int(note.get("note", 60))
        velocity = int(note.get("velocity", 80))
        channel = int(note.get("channel", 0))

        delta = max(0, start_tick - current_tick)
        track.append(mido.Message("note_on", note=pitch, velocity=velocity, time=delta, channel=channel))
        track.append(mido.Message("note_off", note=pitch, velocity=0, time=max(1, duration_tick), channel=channel))
        current_tick = start_tick + max(1, duration_tick)

    import io
    buf = io.BytesIO()
    midi.save(file=buf)
    raw = buf.getvalue()
    return base64.b64encode(raw).decode("utf-8")
