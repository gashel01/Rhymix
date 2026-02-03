import os

from flask import Blueprint, current_app, send_from_directory

bp = Blueprint("base", __name__)


@bp.route("/", defaults={"path": ""})
@bp.route("/<path:path>")
def serve(path):
    file = path if path and os.path.exists(f"{current_app.static_folder}/{path}") else "index.html"
    return send_from_directory(current_app.static_folder, file)
