import json
import logging
import re
import shutil
import tempfile
import threading
import urllib.parse
import uuid
import zipfile
from datetime import datetime
from pathlib import Path

import requests
from bs4 import BeautifulSoup
from flask import Blueprint, jsonify, request
from werkzeug.utils import secure_filename

from backend.features.inference.models import extract_epoch_rate_from_filename
from backend.jobs.registry import download_jobs
from backend.paths.manager import paths

bp = Blueprint("models", __name__)

# voice-models.com's nginx rejects the literal "python-requests/x.y" User-Agent
# with a 403 — its robots.txt allows crawlers, it just wants a client that names
# itself. Identify properly rather than pretending to be a browser.
USER_AGENT = "Rhymix/1.0 (+https://github.com/gashel01/Rhymix)"


def _extract_hf_model_id(url: str) -> str:
    if not url:
        return ""
    match = re.search(r"huggingface\.co/([^/\s?#]+/[^/\s?#]+)", url)
    return match.group(1) if match else ""


def _normalize_tag_list(title: str) -> list[str]:
    tags = []
    if not title:
        return tags
    t = title.lower()
    if "rmvpe" in t:
        tags.append("rmvpe")
    if "v2" in t:
        tags.append("v2")
    if "v1" in t and "v2" not in t:
        tags.append("v1")
    return tags


@bp.route("/api/available-models")
def available_models():
    try:
        root = Path(paths.APPLIO_MODELS_DIR)
        if not root.exists():
            return jsonify({"models": []})

        models = []
        for d in (p for p in root.iterdir() if p.is_dir()):
            pths = [f for f in d.glob("*.pth")]
            if not pths:
                continue
            info_path = d / "model_info.json"
            info = json.loads(info_path.read_text()) if info_path.exists() else {}

            # split model name to find the correct number of epoch in the string ex: 'Cardi B (RVCv2, RMVPE, 400 Epochs)'

            idx = next(d.glob("*.index"), None)
            model_id = info.get("model_id") or info.get("modelId") or d.name
            model_name = info.get("model_name") or info.get("name") or d.name
            folder_name = d.name
            installed_at = info.get("installed_at")
            info_epochs = info.get("epochs")
            epochs = None
            if info_epochs is None or info_epochs == 0:
                findepoch = info.get("model_name")

                # make regex safe
                if not isinstance(findepoch, (str, bytes)):
                    findepoch = "" if findepoch is None else str(findepoch)

                match = re.search(r"(\d+)\s*Epochs?", findepoch, flags=re.IGNORECASE)
                epochs = int(match.group(1)) if match else None
            else:
                epochs = int(info_epochs)

            info_rate = info.get("rate")

            def _checkpoint_entry(f: Path) -> dict:
                epoch, rate = extract_epoch_rate_from_filename(f.name)
                logging.info(f"!!!!!!!!!! epoch  rate : {f.name}!!!!!!!!!!!!!!!!!! {epoch}, {rate}")
                if epoch is None:
                    epoch = info_epochs or 0
                if rate is None:
                    rate = info_rate
                created_time = installed_at or datetime.fromtimestamp(f.stat().st_ctime).isoformat()
                return {
                    "filename": f.name,
                    "epochs": epochs if epochs is not None else epoch if epoch is not None else 0,
                    "rate": rate,
                    "isBest": "best" in f.name.lower(),
                    "created": created_time,
                    "path": str(f.relative_to(root)),
                    "size_mb": round(f.stat().st_size / (1024 ** 2), 2),
                }

            cps = sorted((_checkpoint_entry(f) for f in pths), key=lambda x: x["epochs"], reverse=True)
            latest_created = cps[0]["created"] if cps else datetime.now().isoformat()
            size = sum(f.stat().st_size for f in pths) + (idx.stat().st_size if idx else 0)

            models.append(
                {
                    "name": folder_name,
                    "modelId": model_id,
                    "created": latest_created,
                    "installed_at": installed_at,
                    "epochs": cps[0]["epochs"] if cps else 0,
                    "size_mb": round(size / (1024 ** 2), 2),
                    "sampleRate": info.get("sample_rate", 48000),
                    "status": "completed",
                    "checkpoints": cps,
                    "indexPath": str(idx.relative_to(root)) if idx else None,
                }
            )

        return jsonify({"models": sorted(models, key=lambda x: x["created"], reverse=True)})
    except Exception as e:
        logging.error(f"Error: {e}")
        return jsonify({"error": str(e)}), 500


@bp.route("/api/models/<model_name>", methods=["DELETE"])
def delete_model(model_name):
    try:
        name = secure_filename(model_name)
        if not name:
            return jsonify({"error": "Invalid model name"}), 400

        d = paths.APPLIO_MODELS_DIR / name
        if not d.exists():
            return jsonify({"error": f"Model '{name}' not found"}), 404
        if not d.is_dir():
            return jsonify({"error": f"'{name}' is not a valid model directory"}), 400

        shutil.rmtree(d)
        logging.info(f"Successfully deleted model: {name}")

        return jsonify(
            {
                "message": f"Model '{name}' and all its files have been deleted successfully",
                "modelName": name,
            }
        )
    except Exception as e:
        logging.error(f"Error deleting model '{model_name}': {e}")
        return jsonify({"error": f"Failed to delete model: {e}"}), 500


@bp.route("/api/search-online-models")
def search_online_models():
    q = request.args.get("query", "")
    page = request.args.get("page", 1)
    if not q:
        return jsonify({"models": [], "total_pages": 1})

    # Upstream failures are the directory's problem, not ours — report them as
    # 502 with a readable message instead of collapsing into an opaque 500.
    try:
        response = requests.post(
            "https://voice-models.com/fetch_data.php",
            data={"page": page, "search": q},
            headers={"User-Agent": USER_AGENT},
            timeout=10,
        )
        response.raise_for_status()
        raw = response.json()
    except requests.RequestException as e:
        logging.warning("voice-models.com search failed: %s", e)
        return jsonify({"error": f"Model directory unreachable: {e}", "models": []}), 502
    except ValueError:
        logging.warning("voice-models.com returned a non-JSON body for query %r", q)
        return jsonify(
            {"error": "Model directory returned an unexpected response", "models": []}
        ), 502

    try:
        models = []
        html = (raw.get("table") or "").strip()
        if html:
            soup = BeautifulSoup(html, "html.parser")
            for tr in soup.select("tr"):
                tds = tr.find_all("td")
                if len(tds) < 2:
                    continue
                a = tds[0].find("a", class_="fs-5")
                b = tds[1].find("button", class_="copy-btn")
                if not (a and b):
                    continue
                title = a.get_text(strip=True)
                model_url = b.get("data-clipboard-text")
                model_id = _extract_hf_model_id(model_url)
                author = model_id.split("/")[0] if model_id else None
                tags = _normalize_tag_list(title)
                badge = tds[0].find("span", class_="badge")
                # logging.info(f"!!!!!!!!!!   {re}")
                m = re.search(r"(\d+)\s?(?:epochs|epoch|e)\b", title, re.I)
                size_text = badge.get_text(strip=True).replace(" MB", "") if badge else None
                models.append(
                    {
                        "name": title,
                        "url": model_url,
                        "modelId": model_id,
                        "author": author,
                        "tags": tags,
                        "epochs": int(m.group(1)) if m else None,
                        "size_mb": size_text,
                    }
                )

        total_pages = 1
        pg = raw.get("pagination") or ""
        if pg:
            last = BeautifulSoup(pg, "html.parser").find("li", class_="last")
            onclick = last.find("a").get("onclick") if last and last.find("a") else ""
            m = re.search(r"\((\d+)", onclick)
            if m:
                total_pages = int(m.group(1))

        return jsonify({"models": models, "total_pages": total_pages, "current_page": int(page)})

    except Exception as e:
        # Reaching here means the response parsed as JSON but its HTML payload no
        # longer matches what we scrape — i.e. the directory changed its markup.
        logging.exception("Could not parse voice-models.com results")
        return jsonify({"error": f"Could not parse model directory results: {e}", "models": []}), 500


def _safe_model_dir_name(user_query: str, model_name: str, model_id: str) -> str:
    base = user_query or model_name or model_id or "downloaded_model"
    base = base.replace("/", "_")
    safe = secure_filename(base)
    return safe or "downloaded_model"


def _is_ignored_path(path: Path) -> bool:
    for part in path.parts:
        if part.startswith(".") or part == "__MACOSX":
            return True
    return False


def _find_model_artifacts(root: Path) -> tuple[list[Path], list[Path]]:
    pths = [p for p in root.rglob("*.pth") if p.is_file() and not _is_ignored_path(p)]
    indexes = [p for p in root.rglob("*.index") if p.is_file() and not _is_ignored_path(p)]
    return pths, indexes


def _select_best_pth(pths: list[Path]) -> Path | None:
    if not pths:
        return None

    def score(p: Path) -> tuple[int, int]:
        name = p.stem.lower()
        pattern = bool(re.search(r"(?:^|[_-])(g|final|best|latest)(?:[_-]|$)", name))
        return (1 if pattern else 0, p.stat().st_size)

    return max(pths, key=score)


def _select_index(indexes: list[Path], pth: Path | None) -> Path | None:
    if not indexes:
        return None
    if pth:
        base = pth.stem.lower()
        for idx in indexes:
            if idx.stem.lower() == base:
                return idx
    return indexes[0]


def _copy_metadata_files(root: Path, dest_dir: Path) -> None:
    exts = {".json", ".txt", ".md", ".yaml", ".yml"}
    for f in root.rglob("*"):
        if not f.is_file() or _is_ignored_path(f):
            continue
        if f.suffix.lower() not in exts:
            continue
        target = dest_dir / f.name
        if target.exists():
            continue
        try:
            shutil.copy2(f, target)
        except Exception:
            pass


def _download_file(url: str, dest_path: Path) -> None:
    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
    response = requests.get(url, headers=headers, stream=True, timeout=60)
    response.raise_for_status()
    with open(dest_path, "wb") as handle:
        for chunk in response.iter_content(chunk_size=8192):
            if chunk:
                handle.write(chunk)


def _install_model_files(model_dir: Path, pth: Path, index_path: Path | None, model_info: dict, metadata_root: Path | None) -> dict:
    model_dir.mkdir(parents=True, exist_ok=True)
    for existing in model_dir.glob("*.pth"):
        existing.unlink(missing_ok=True)
    for existing in model_dir.glob("*.index"):
        existing.unlink(missing_ok=True)

    dest_pth = model_dir / "model.pth"
    shutil.copy2(pth, dest_pth)

    dest_index = None
    if index_path:
        dest_index = model_dir / "model.index"
        shutil.copy2(index_path, dest_index)

    if metadata_root:
        _copy_metadata_files(metadata_root, model_dir)

    info_path = model_dir / "model_info.json"
    with info_path.open("w", encoding="utf-8") as handle:
        json.dump(model_info, handle, indent=2, sort_keys=True)

    size_bytes = dest_pth.stat().st_size + (dest_index.stat().st_size if dest_index else 0)
    return {
        "model_dir": model_dir,
        "pth": dest_pth,
        "index": dest_index,
        "size_mb": round(size_bytes / (1024 ** 2), 2),
    }


def _download_and_install_model(payload: dict) -> dict:
    model_url = payload.get("model_url") or ""
    model_name = payload.get("model_name") or ""
    user_query = payload.get("user_query") or ""
    files_info = payload.get("files_info") or {}
    model_id = payload.get("model_id") or _extract_hf_model_id(model_url)
    dir_name = payload.get("dir_name") or _safe_model_dir_name(user_query, model_name, model_id)

    model_dir = paths.APPLIO_MODELS_DIR / dir_name
    if model_dir.exists() and any(model_dir.glob("*.pth")):
        raise Exception(f"Model '{dir_name}' already exists")

    temp_root = Path(tempfile.mkdtemp(prefix="model_download_"))
    extracted_root = None
    pths: list[Path] = []
    indexes: list[Path] = []
    source_url = model_url or ""
    parsed_url = urllib.parse.urlparse(model_url or "")
    url_ext = Path(parsed_url.path).suffix.lower()

    try:
        if files_info.get("zip") and model_id:
            zip_url = f"https://huggingface.co/{model_id}/resolve/main/{files_info['zip']}"
            zip_path = temp_root / "model.zip"
            _download_file(zip_url, zip_path)
            extracted_root = temp_root / "extracted"
            with zipfile.ZipFile(zip_path, "r") as zip_ref:
                zip_ref.extractall(extracted_root)
            pths, indexes = _find_model_artifacts(extracted_root)
            source_url = zip_url
        elif (files_info.get("pth") or files_info.get("index")) and model_id:
            if files_info.get("pth"):
                pth_url = f"https://huggingface.co/{model_id}/resolve/main/{files_info['pth']}"
                pth_path = temp_root / Path(files_info["pth"]).name
                _download_file(pth_url, pth_path)
                pths = [pth_path]
                source_url = pth_url
            if files_info.get("index"):
                index_url = f"https://huggingface.co/{model_id}/resolve/main/{files_info['index']}"
                index_path = temp_root / Path(files_info["index"]).name
                _download_file(index_url, index_path)
                indexes = [index_path]
        elif url_ext == ".zip":
            zip_path = temp_root / "model.zip"
            _download_file(model_url, zip_path)
            extracted_root = temp_root / "extracted"
            with zipfile.ZipFile(zip_path, "r") as zip_ref:
                zip_ref.extractall(extracted_root)
            pths, indexes = _find_model_artifacts(extracted_root)
            source_url = model_url
        elif url_ext == ".pth":
            filename = Path(urllib.parse.urlparse(model_url).path).name or "model.pth"
            pth_path = temp_root / filename
            _download_file(model_url, pth_path)
            pths = [pth_path]
            source_url = model_url
        elif url_ext == ".index":
            filename = Path(urllib.parse.urlparse(model_url).path).name or "model.index"
            index_path = temp_root / filename
            _download_file(model_url, index_path)
            indexes = [index_path]
        else:
            raise Exception("Unable to determine how to download the model")

        selected_pth = _select_best_pth(pths)
        if not selected_pth:
            raise Exception("No .pth file found")
        selected_index = _select_index(indexes, selected_pth)

        epochs, rate = extract_epoch_rate_from_filename(selected_pth.name)
        model_info = {
            "model_id": model_id or dir_name,
            "model_name": model_name or dir_name,
            "source_url": source_url,
            "installed_at": datetime.now().isoformat(),
            "original_pth": selected_pth.name,
            "original_index": selected_index.name if selected_index else None,
            "epochs": epochs,
            "rate": rate,
        }

        install_result = _install_model_files(
            model_dir=model_dir,
            pth=selected_pth,
            index_path=selected_index,
            model_info=model_info,
            metadata_root=extracted_root or temp_root,
        )
        install_result.update(
            {"model_id": model_info["model_id"], "model_name": model_info["model_name"], "dir_name": dir_name}
        )
        return install_result
    finally:
        shutil.rmtree(temp_root, ignore_errors=True)


@bp.route("/api/download-model", methods=["POST"])
def download_model():
    data = request.get_json() or {}
    model_url = data.get("url", "")
    model_name = data.get("modelName", "")
    model_id = data.get("modelId", "")
    files_info = data.get("files") or {}
    user_query = data.get("userQuery", "")

    resolved_id = model_id or _extract_hf_model_id(model_url) or ""
    resolved_name = model_name or resolved_id or "downloaded_model"
    dir_name = _safe_model_dir_name(user_query, resolved_name, resolved_id)

    job_id = uuid.uuid4().hex
    download_jobs[job_id] = {
        "jobId": job_id,
        "modelId": resolved_id or dir_name,
        "modelName": resolved_name,
        "status": "downloading",
        "progress": 0,
        "started_at": datetime.now().isoformat(),
        "error": None,
    }

    payload = {
        "model_url": model_url,
        "model_name": resolved_name,
        "model_id": resolved_id,
        "user_query": user_query,
        "files_info": files_info,
        "dir_name": dir_name,
    }

    def _runner(job_id_inner, payload_inner):
        try:
            result = _download_and_install_model(payload_inner)
            download_jobs[job_id_inner].update(
                {
                    "status": "completed",
                    "progress": 100,
                    "completed_at": datetime.now().isoformat(),
                    "modelId": result.get("model_id") or payload_inner.get("model_id") or dir_name,
                    "modelName": result.get("model_name") or resolved_name,
                    "dirName": result.get("dir_name"),
                    "size_mb": result.get("size_mb"),
                }
            )
        except Exception as exc:
            download_jobs[job_id_inner].update(
                {"status": "failed", "error": str(exc), "completed_at": datetime.now().isoformat()}
            )

    threading.Thread(target=_runner, args=(job_id, payload), daemon=True).start()

    return jsonify(
        {
            "jobId": job_id,
            "modelId": resolved_id or dir_name,
            "modelName": resolved_name,
            "status": "downloading",
            "started_at": download_jobs[job_id]["started_at"],
        }
    )


@bp.route("/api/models/download/status/<job_id>")
def download_model_status(job_id):
    job = download_jobs.get(job_id)
    if not job:
        return jsonify({"error": "Job not found"}), 404
    return jsonify(job)
