"""
patch_applio.py — post-clone patch for applio/core.py
------------------------------------------------------
Fixes two bugs in the upstream Applio repo that prevent FastAPI from starting
when run from the Rhymix project root:

  1. load_voices_data() uses a CWD-relative path ("rvc/lib/tools/tts_voices.json")
     which resolves to ROOT/rvc/… instead of applio/rvc/….  Fixed by using
     __file__-relative path via _CORE_DIR.

  2. voices_data = load_voices_data() is called at module import time with no
     error handling, so a missing JSON file crashes FastAPI immediately.
     Fixed by catching FileNotFoundError and returning [] (TTS is optional).

Run automatically by setup.bat after cloning applio.  Safe to re-run.
"""

import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
TARGET = ROOT / "applio" / "core.py"

OLD = '''\
@lru_cache(maxsize=1)  # Cache only one result since the file is static
def load_voices_data():
    with open(
        os.path.join("rvc", "lib", "tools", "tts_voices.json"), "r", encoding="utf-8"
    ) as file:
        return json.load(file)


voices_data = load_voices_data()
locales = list({voice["ShortName"] for voice in voices_data})'''

NEW = '''\
_CORE_DIR = os.path.dirname(os.path.abspath(__file__))


@lru_cache(maxsize=1)  # Cache only one result since the file is static
def load_voices_data():
    # Path relative to this file, not the process CWD.
    json_path = os.path.join(_CORE_DIR, "rvc", "lib", "tools", "tts_voices.json")
    try:
        with open(json_path, "r", encoding="utf-8") as file:
            return json.load(file)
    except FileNotFoundError:
        # TTS voice data is optional; RVC inference works without it.
        return []


voices_data = load_voices_data()
locales = list({voice["ShortName"] for voice in voices_data})'''


def main() -> int:
    if not TARGET.exists():
        print(f"[patch_applio] {TARGET} not found — skipping (applio not cloned yet?)")
        return 0

    src = TARGET.read_text(encoding="utf-8")

    if "_CORE_DIR" in src:
        print("[patch_applio] applio/core.py already patched — nothing to do.")
        return 0

    if OLD not in src:
        print(
            "[patch_applio] WARNING: expected text not found in applio/core.py.\n"
            "  The upstream file may have changed. Patch was NOT applied.\n"
            "  Check applio/core.py manually for the load_voices_data() function."
        )
        return 1

    TARGET.write_text(src.replace(OLD, NEW, 1), encoding="utf-8")
    print("[patch_applio] applio/core.py patched successfully.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
