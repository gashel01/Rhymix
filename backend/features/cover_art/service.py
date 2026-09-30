"""Cover art for generated songs, on the CPU.

SDXS-512-0.9 (IDKiro, openrail++) is a 0.3B single-step model with a tiny
decoder. It runs here on the **CPU on purpose**: the GPU has 8 GB and YuE2
already holds ~4.3 GB of it, so putting an image model there would mean either
evicting the engine between every song or fighting it for memory. A cover takes
a few seconds of CPU either way, and nobody is waiting on it — the song is the
thing being waited for.

One step, no classifier-free guidance: SDXS is distilled to a single network
evaluation, and guidance above 1.0 makes it worse, not better, while doubling
the work.
"""

from __future__ import annotations

import logging
import re
import threading
from pathlib import Path

logger = logging.getLogger(__name__)

MODEL_ID = "IDKiro/sdxs-512-0.9"
SIZE = 512
COVER_FILENAME = "cover.png"

# Loading takes several seconds and the weights are about 1 GB of ordinary RAM,
# so the pipeline is built once and kept. The lock is not about thread safety in
# diffusers so much as about not running two generations at once on a CPU that
# is also serving the app.
_pipeline = None
_lock = threading.Lock()
_load_error: str | None = None


def _load():
    """Build the pipeline, or raise with a message worth showing a user."""
    global _pipeline, _load_error

    if _pipeline is not None:
        return _pipeline
    if _load_error is not None:
        raise RuntimeError(_load_error)

    try:
        import torch
        from diffusers import StableDiffusionPipeline
    except ImportError as exc:
        _load_error = f"Cover art needs diffusers and torch: {exc}"
        raise RuntimeError(_load_error) from exc

    try:
        logger.info("Loading %s on CPU for cover art", MODEL_ID)
        pipeline = StableDiffusionPipeline.from_pretrained(
            MODEL_ID,
            # float32, not float16: half precision on CPU is either unsupported
            # or slower for most of these ops, so it buys nothing here.
            torch_dtype=torch.float32,
            safety_checker=None,
            feature_extractor=None,
            requires_safety_checker=False,
        )
        pipeline.to("cpu")
        pipeline.set_progress_bar_config(disable=True)
    except Exception as exc:
        _load_error = f"Could not load the cover art model: {exc}"
        logger.exception("Cover art model failed to load")
        raise RuntimeError(_load_error) from exc

    _pipeline = pipeline
    return _pipeline


# Words that describe how a song *sounds* and happen to mean nothing to an image
# model, or actively steer it wrong ("clean electric guitar" draws a guitar).
_SOUND_WORDS = re.compile(
    r"\b(\d+\s*bpm|bpm|vocals?|voice|male|female|instrumental|acapella|stereo|mix|"
    r"reverb|autotune|tempo|key of \w+|major|minor|clean|distorted)\b",
    re.IGNORECASE,
)


_SECTION_WORDS = r"verse|chorus|refrain|hook|bridge|intro|outro|pre[- ]?chorus|drop|break|interlude"

# Section markers arrive in every shape a person or a model will produce:
# "[Chorus]", "Chorus:", "Verse 2", and — seen in this library — "Verse 1]"
# with the opening bracket missing. Matching only the tidy bracketed form left
# a stray "Verse 1]" as the best line in a real song.
_SECTION_ANY = re.compile(
    rf"[\[\(]?\s*(?:{_SECTION_WORDS})\s*\d*\s*[\]\):]+|^\s*(?:{_SECTION_WORDS})\s*\d*\s*$",
    re.IGNORECASE | re.MULTILINE,
)
_IS_CHORUS = re.compile(rf"\b(?:chorus|refrain|hook)\b", re.IGNORECASE)
_ADLIB = re.compile(r"\([^)]*\)")
_PUNCT = re.compile(r"[^\w\s']", re.UNICODE)

# Lyrics sometimes arrive as one unbroken paragraph. Where a line ended, the
# next one still starts with a capital, so a capital following a lowercase word
# marks the join. `[A-Z][a-z]` rather than `[A-Z]` so "and I'm lost" is not
# split at "I'm".
_RUN_ON = re.compile(r"(?<=[a-z,])\s+(?=[A-Z][a-z])")

HOOK_MIN_WORDS = 3
HOOK_MAX_WORDS = 12


def _looks_run_on(text: str) -> bool:
    """Whether this text lost its line breaks and needs them guessed back."""
    lines = [line for line in text.splitlines() if line.strip()]
    if len(lines) <= 2:
        return True
    return max(len(line) for line in lines) > 160


def _mood_from_style(style: str) -> str:
    """The part of a music description that an image model can use.

    "melancholic indie pop, female vocals, 92 BPM" describes a sound. Handed
    straight to an image model it draws microphones and sheet music, and
    "clean electric guitar" reliably draws a guitar — the model has no idea
    "clean" was about the signal. Only the mood words survive.
    """
    mood = _SOUND_WORDS.sub(" ", str(style or ""))
    mood = re.sub(r"[,\s]{2,}", ", ", mood).strip(" ,")
    parts = [part.strip() for part in mood.split(",") if part.strip()]
    return ", ".join(parts[:4])


def extract_hook(lyrics: str) -> str:
    """The one line of a song most worth drawing.

    In that order:
      1. the line repeated most often — in a pop song that is the hook, and a
         hook is the line the song is *about*
      2. failing that, the first line of the chorus
      3. failing that, the first line at all

    Section tags ([Verse], [Chorus]) and parenthesised ad-libs are not lyrics
    and are dropped before any of this.
    """
    text = _ADLIB.sub(" ", str(lyrics or ""))
    if not text.strip():
        return ""

    # Section markers become boundaries rather than being deleted, so that a
    # chorus can still be identified after the text has been flattened.
    marked = _SECTION_ANY.sub(lambda m: f"\n\x00{m.group(0)}\x00\n", text)

    # Guessing line breaks back is a repair, and applying it to lyrics that
    # still have their own is destructive: every comma-then-capital inside
    # "Yo, Puff Daddy, Diddy, Combs, whatever name you claim this week" looks
    # exactly like a join. Asked once per song, not once per line.
    repair = _looks_run_on(text)

    lines: list[str] = []
    chorus_first = ""
    in_chorus = False

    for raw in marked.splitlines():
        chunk = raw.strip()
        if not chunk:
            continue
        if chunk.startswith("\x00"):
            in_chorus = bool(_IS_CHORUS.search(chunk))
            continue
        for line in (_RUN_ON.split(chunk) if repair else [chunk]):
            line = line.strip(" \t-–—")
            words = line.split()
            # Too short is an ad-lib; too long is a paragraph, not a hook.
            if len(words) < HOOK_MIN_WORDS or len(words) > HOOK_MAX_WORDS * 2:
                continue
            if in_chorus and not chorus_first:
                chorus_first = line
            lines.append(line)

    if not lines:
        return ""

    counts: dict[str, list] = {}
    for line in lines:
        key = re.sub(r"\s+", " ", _PUNCT.sub("", line.lower())).strip()
        if not key:
            continue
        # Keep the first spelling seen; later repeats are usually the same line
        # with different punctuation.
        entry = counts.setdefault(key, [0, line])
        entry[0] += 1

    hook = ""
    if counts:
        best = max(counts, key=lambda k: (counts[k][0], len(k)))
        if counts[best][0] > 1:
            hook = counts[best][1]
    if not hook:
        hook = chorus_first or lines[0]

    return _trim_hook(hook)


# Words that carry no image and read as a sentence cut short when a truncated
# hook ends on one.
_DANGLING = {
    "i", "i'm", "im", "a", "an", "the", "and", "or", "but", "to", "of", "in",
    "on", "at", "with", "for", "from", "my", "your", "his", "her", "their",
    "its", "that", "this", "it", "is", "was", "be", "so", "as", "like", "when",
    "then", "than", "we", "you", "he", "she", "they",
}


def _trim_hook(line: str) -> str:
    """A hook, bounded and tidy.

    CLIP truncates at 77 tokens, so a long line does not merely dilute the
    prompt — it pushes the genre and the scaffold out of it entirely. Trailing
    function words are dropped after the cut: "with no direction to stay I'm"
    reads as a sentence someone interrupted.
    """
    words = line.split()[:HOOK_MAX_WORDS]
    while words and _PUNCT.sub("", words[-1].lower()) in _DANGLING:
        words.pop()
    return " ".join(words).strip(" ,;:.-–—'\"")


# A title only helps when it is words. Working titles — "dddqqa", "rrreeeee",
# "test 3" — are noise, and noise in a CLIP prompt is not neutral: it steals
# attention from the words that mean something.
def _title_is_words(title: str) -> bool:
    text = str(title or "").strip()
    if len(text) < 3:
        return False
    if re.search(r"(.)\1{2,}", text):  # ddd, rrr, eee
        return False
    letters = re.sub(r"[^a-zA-ZÀ-ÿ]", "", text)
    if len(letters) < 3:
        return False
    vowels = len(re.findall(r"[aeiouyàâéèêëîïôöùûü]", letters, re.IGNORECASE))
    return vowels / len(letters) >= 0.25


def build_prompt(title: str, style: str = "", lyrics: str = "") -> str:
    """What to draw for a song, from the song itself.

    Ordered deliberately: CLIP weights the front of a prompt hardest, so the
    hook — the most concrete, most specific thing available — goes first, the
    genre colours it, and the title only appears when it is real words.
    """
    hook = extract_hook(lyrics)
    mood = _mood_from_style(style)
    name = str(title or "").strip() if _title_is_words(title) else ""

    subject = ", ".join(part for part in (hook, mood, name) if part) or "abstract"
    return (
        f"album cover art, {subject}, bold graphic composition, striking colour, "
        "square format, no text, no lettering, no watermark"
    )


def generate_cover(
    output_path: Path,
    title: str,
    style: str = "",
    lyrics: str = "",
    seed: int | None = None,
) -> Path:
    """Draw one cover and write it as a PNG. Raises on failure."""
    import torch

    prompt = build_prompt(title, style, lyrics)
    with _lock:
        pipeline = _load()
        generator = None
        if seed is not None and seed >= 0:
            generator = torch.Generator(device="cpu").manual_seed(int(seed))
        result = pipeline(
            prompt,
            num_inference_steps=1,
            guidance_scale=0.0,
            height=SIZE,
            width=SIZE,
            generator=generator,
        )

    image = result.images[0]
    output_path.parent.mkdir(parents=True, exist_ok=True)
    image.save(output_path, format="PNG", optimize=True)
    logger.info("Cover written to %s", output_path)
    return output_path


def is_available() -> bool:
    """Whether a cover can be attempted at all, without loading the model."""
    if _load_error is not None:
        return False
    try:
        import diffusers  # noqa: F401
        import torch  # noqa: F401
    except ImportError:
        return False
    return True
