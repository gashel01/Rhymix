import logging
import os

# Environment + logging suppression must run before any torch/torchaudio imports
from backend.env_bootstrap import bootstrap_env

bootstrap_env()

from backend.factory import create_app

app = create_app()


if __name__ == "__main__":
    debug_enabled = os.getenv("FLASK_DEBUG", "").strip().lower() in {"1", "true", "yes", "on"}
    # threaded=True matters here beyond the usual "handle concurrent users" reason: this
    # single process also serves /api/system's GPU poll and every other route. Without it, one
    # slow or stuck request (e.g. a large audio Range response to a <audio> element whose seek
    # was abandoned mid-stream by rapid waveform scrubbing) occupies the only worker and queues
    # every unrelated request behind it forever - confirmed by hand: repeated waveform clicks in
    # the Electron shell left /api/system pending indefinitely, with zero new requests reaching
    # the backend at all until restart, even though the page itself was still fully responsive.
    app.run(debug=debug_enabled, host="0.0.0.0", port=5000, threaded=True)
