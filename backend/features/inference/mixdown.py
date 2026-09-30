"""Turning a converted vocal back into something you can listen to.

Voice conversion produces one file: a naked vocal, no music behind it. That is
the honest output of the model and it is what the run directory has always
contained — but nobody wants to hear that. The point of re-singing a track with
your own voice is the track, and until now a conversion landed in the library as
a dry a cappella with no way back to the song it came from.

So once the vocal exists, the instrumental it was sung over is found again and
the two are mixed back together. The run then holds the same three files every
other track in this app holds — vocal, instrumental, mix — which is what lets a
conversion be played, split, re-converted or trained on like anything else.

The instrumental is referenced by path rather than copied. A copy per run would
cost ~30 MB of duplicate audio every time you tried a different voice on the
same song, and the mix is what actually needs to survive the source being
deleted — it does, because it is written here.
"""

from __future__ import annotations

import logging
from pathlib import Path

from backend.paths.manager import paths
from backend.storage.inference_runs import load_inference_run_metadata
from backend.storage.metadata import get_upload_base_name

logger = logging.getLogger(__name__)

MIX_FILE_NAME = "mix.wav"

# Layered conversions chain: a run sung on top of a run sung on top of an
# upload. Each hop is one lookup, and this bounds a metadata cycle — which
# should not exist, but a bad run.json must not hang the worker thread.
_MAX_HOPS = 8


def resolve_instrumental(
    *,
    song_job_id: str | None = None,
    file_id: str | None = None,
    source_run_id: str | None = None,
) -> Path | None:
    """The music that belongs under this conversion, or None if there is none.

    The three input kinds keep their instrumental in three different places, and
    a run stacked on another run has to walk back to whichever one of them it
    ultimately came from.
    """
    hops = 0
    while hops < _MAX_HOPS:
        hops += 1

        if song_job_id:
            from backend.features.song_generation.jobs_common import _asset_path

            candidate = _asset_path(song_job_id, "instrumental")
            return candidate if candidate.exists() else None

        if file_id:
            # The stored base name normally comes from the uploads table, but
            # not every instrumental still has a record behind it: the pipeline
            # registers a temporary upload to push a song through separation and
            # unregisters it afterwards, leaving files named after an id the
            # table no longer knows. The id itself is the fallback, because that
            # is what those files are named after.
            for base_name in (get_upload_base_name(file_id), file_id):
                if not base_name:
                    continue
                candidate = paths.INSTRUMENTAL_DIR / f"{base_name}_instrumental.wav"
                if candidate.exists():
                    return candidate
            return None

        if not source_run_id:
            return None

        # Stacked on an earlier run: it already answered this question, so reuse
        # its answer when the file is still there and otherwise follow its own
        # source one hop further back.
        meta = load_inference_run_metadata(source_run_id) or {}
        recorded = meta.get("instrumentalPath")
        if recorded:
            candidate = Path(recorded)
            if candidate.exists():
                return candidate
        song_job_id = meta.get("songJobId")
        file_id = meta.get("inputFileId")
        source_run_id = meta.get("sourceRunId")

    logger.warning("Gave up resolving an instrumental after %d hops", _MAX_HOPS)
    return None


def build_mix(vocal_path: Path, instrumental_path: Path, output_path: Path) -> bool:
    """Mix the converted vocal over its instrumental. False if ffmpeg refused.

    Same levels as a generated song's own remix, so a conversion and the track
    it came from sound like they belong to the same record rather than one
    arriving noticeably louder than the other.
    """
    from backend.features.song_generation.jobs_common import _mix_audio

    try:
        return _mix_audio(instrumental_path, vocal_path, output_path)
    except Exception:
        logger.exception("Could not mix %s under %s", vocal_path.name, instrumental_path.name)
        return False
