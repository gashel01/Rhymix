import React, { useEffect, useState } from "react";

import { listProviders } from "../api";

/**
 * What Rhymix is running on, and what you may do with what it makes.
 *
 * Read-only for now, deliberately. Engine choice, paths and the Groq key all
 * live in .env and are read at startup; a settings page that appeared to
 * change them without restarting anything would be a lie. What it can honestly
 * do is tell you the truth about the current state — including the licence,
 * which is the one thing here with consequences outside the app.
 */

export default function SettingsView() {
  const [providers, setProviders] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    listProviders(controller.signal)
      .then(setProviders)
      .catch((loadError) => {
        if (loadError.name !== "AbortError") setError(loadError.message);
      });
    return () => controller.abort();
  }, []);

  const licences = (providers && providers.licenses) || {};
  const active = (providers && (providers.default || providers.current)) || "yue2";

  return (
    <div className="rx-view">
      <div className="rx-head">
        {/* No "Settings" word here — the rail beside it already says which
            page this is. */}
        <div>
          <h1>Engines are configured in .env and read at startup.</h1>
        </div>
      </div>

      <div className="card">
        <h3>Generation engine</h3>
        {error ? (
          <span className="hint">Could not reach the backend: {error}</span>
        ) : providers === null ? (
          <span className="hint">Loading…</span>
        ) : (
          <div className="kv">
            <div className="r">
              <span>Active</span>
              <b>{active}</b>
            </div>
            {Object.entries(licences).map(([name, licence]) => (
              <div className="r" key={name}>
                <span>{name} weights</span>
                <b style={{ color: String(licence).includes("NC") ? "var(--vox)" : "var(--conv)" }}>
                  {licence}
                </b>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <h3>What you can do with your music</h3>
        <span className="hint">
          The generator weights are non-commercial. In practice: keep, share and remix your tracks
          freely; check before selling or monetising them. Rhymix itself, and any voice you train
          yourself, are not affected by that — those are yours.
        </span>
        <div className="kv">
          <div className="r">
            <span>Voices you train</span>
            <b style={{ color: "var(--conv)" }}>yours</b>
          </div>
          <div className="r">
            <span>Rhymix</span>
            <b style={{ color: "var(--conv)" }}>yours</b>
          </div>
        </div>
      </div>
    </div>
  );
}
