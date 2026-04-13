from flask import Blueprint, jsonify, request
from requests import RequestException, Timeout

from backend.features.llm.service import request_groq_autofill

bp = Blueprint("llm", __name__)


@bp.route("/api/llm/autofill", methods=["POST"])
def groq_autofill():
    data = request.get_json(silent=True) or {}
    task = str(data.get("task") or "").strip()
    context = data.get("context") if isinstance(data.get("context"), dict) else {}
    api_key = request.headers.get("X-Groq-Api-Key", "").strip()

    if not api_key:
        return jsonify({"error": "Set your Groq API key in Settings first."}), 400

    try:
        result = request_groq_autofill(api_key, task, context)
        return jsonify(result)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Timeout:
        return jsonify({"error": "Groq autofill timed out. Try again."}), 504
    except RequestException as exc:
        return jsonify({"error": str(exc) or "Groq autofill request failed."}), 502
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 502
    except Exception:
        return jsonify({"error": "Unexpected Groq autofill failure."}), 500
