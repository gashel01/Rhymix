import logging
import re
from pathlib import Path


def resolve_checkpoint(model: dict) -> dict | None:
    selected_checkpoint = model.get("selectedCheckpoint") or model.get("bestCheckpoint")

    # Fallback: if no selected checkpoint, try to get from checkpoints array
    if not selected_checkpoint and model.get("checkpoints"):
        checkpoints = model.get("checkpoints", [])
        # Try to find best checkpoint first
        selected_checkpoint = next((c for c in checkpoints if c.get("isBest")), None)
        # Otherwise use first checkpoint
        if not selected_checkpoint and checkpoints:
            selected_checkpoint = checkpoints[0]

    return selected_checkpoint


def extract_epoch_rate_from_filename(filename: str) -> tuple[int | None, int | None]:
    logging.info(f"!!!!!!!!!! filename !!!!!!!!!!!!!!!!!! {filename}")

    stem = Path(filename).stem
    epoch: int | None = None
    rate: int | None = None

    # --- epoch patterns ---
    # matches: "..._12e_..." or "..._12e" (end)
    m = re.search(r"_(\d+)e(?=_|$)", stem, re.IGNORECASE)
    if m:
        epoch = int(m.group(1))
    else:
        # matches: "..._e260_..." like "em-tes_e260_s7020"
        m2 = re.search(r"_e(\d+)(?=_|$)", stem, re.IGNORECASE)
        if m2:
            epoch = int(m2.group(1))

    # --- rate patterns ---
    # matches: "..._48200", "..._48200s", "..._48200hz", "..._48k"
    rm = re.search(r"_(\d+)(s|hz|k)?$", stem, re.IGNORECASE)
    if rm:
        value = int(rm.group(1))
        unit = rm.group(2)
        rate = value * 1000 if unit and unit.lower() == "k" else value

    logging.info(
        f"!!!!!!!!!! epoch/rate parsed !!!!!!!!!!!!!!!!!! epoch={epoch}, rate={rate} (stem={stem!r})"
    )
    return epoch, rate
