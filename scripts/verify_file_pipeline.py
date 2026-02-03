#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
UPLOAD_METADATA = ROOT / "data" / "metadata" / "uploads.json"
INFERENCE_RUNS = ROOT / "data" / "singing" / "inference" / "runs"


def load_uploads() -> dict:
    if not UPLOAD_METADATA.exists():
        return {"files": {}}
    with UPLOAD_METADATA.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def verify_uploads() -> list[str]:
    errors = []
    data = load_uploads()
    files = data.get("files", {})
    if not files:
        errors.append("No uploads found in metadata.")
        return errors

    stored_names = set()
    for file_id, record in files.items():
        stored = record.get("storedName")
        if not stored:
            errors.append(f"Upload {file_id} missing storedName.")
            continue
        if stored in stored_names:
            errors.append(f"Duplicate storedName detected: {stored}")
        stored_names.add(stored)
    return errors


def verify_inference_runs() -> list[str]:
    errors = []
    if not INFERENCE_RUNS.exists():
        errors.append("Inference runs directory is missing.")
        return errors

    for run_dir in INFERENCE_RUNS.iterdir():
        if not run_dir.is_dir():
            continue
        run_file = run_dir / "run.json"
        if not run_file.exists():
            errors.append(f"Missing run.json in {run_dir}.")
            continue
        with run_file.open("r", encoding="utf-8") as handle:
            run_data = json.load(handle)
        output_name = run_data.get("outputFileName", "inferred.wav")
        output_path = run_dir / output_name
        if not output_path.exists():
            errors.append(f"Missing output file for run {run_dir.name}: {output_name}")
    return errors


def main() -> None:
    problems = []
    problems.extend(verify_uploads())
    problems.extend(verify_inference_runs())

    if problems:
        print("❌ Verification failed:")
        for problem in problems:
            print(f"- {problem}")
        raise SystemExit(1)

    print("✅ Verification passed: upload metadata + inference runs look consistent.")


if __name__ == "__main__":
    main()
