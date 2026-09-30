import React, { useCallback, useEffect, useRef, useState } from "react";

import Sheet from "./Sheet";
import { searchOnlineVoices, downloadVoice, downloadStatus, isDownloadRunning } from "../api";
import { gradientFor } from "../gradients";
import { useToasts } from "../toasts";
import "./OnlineVoices.css";

/**
 * Finding a voice someone else trained, and installing it.
 *
 * Search is debounced rather than tied to a button: the directory answers in
 * well under a second and typing-then-pressing-enter is one step more than
 * anyone wants when they are browsing.
 *
 * Downloads keep running on the backend whether or not this screen is open, so
 * the progress shown here is polled state, not local state — leaving and coming
 * back picks the same job up where it is.
 */

const DEBOUNCE_MS = 400;
const POLL_MS = 1200;

const PHASES = {
  starting: "Starting…",
  resolving: "Finding the files…",
  downloading: "Downloading…",
  extracting: "Unpacking…",
  installing: "Installing…",
  done: "Installed",
  failed: "Failed",
};

/** The directory's titles are long and full of punctuation; this is the folder
 *  it installs into, so it has to survive a filesystem. */
const suggestLocalName = (name) =>
  String(name || "voice")
    .replace(/\(.*?\)/g, " ")
    .replace(/\b\d+\s?(epochs?|e)\b/gi, " ")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40) || "voice";

export default function OnlineVoices({ onInstalled }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState(null);

  const [picked, setPicked] = useState(null);
  const [localName, setLocalName] = useState("");
  const [starting, setStarting] = useState(false);

  const [downloads, setDownloads] = useState({});
  const toasts = useToasts();
  const installedRef = useRef(onInstalled);
  installedRef.current = onInstalled;

  useEffect(() => {
    const text = query.trim();
    if (!text) {
      setResults(null);
      setError(null);
      return undefined;
    }
    const controller = new AbortController();
    setSearching(true);
    const timer = setTimeout(() => {
      searchOnlineVoices(text, 1, controller.signal)
        .then((found) => {
          setResults(found);
          setError(null);
        })
        .catch((searchError) => {
          if (searchError.name !== "AbortError") {
            setError(searchError.message);
            setResults(null);
          }
        })
        .finally(() => setSearching(false));
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
      setSearching(false);
    };
  }, [query]);

  const watch = useCallback((jobId) => {
    let stopped = false;
    const tick = async () => {
      try {
        const job = await downloadStatus(jobId);
        if (stopped) return;
        setDownloads((current) => ({ ...current, [jobId]: job }));
        if (isDownloadRunning(job)) {
          setTimeout(tick, POLL_MS);
        } else if (job.status === "completed") {
          toasts.notify(`“${job.modelName || job.modelId}” installed`);
          if (installedRef.current) installedRef.current();
        } else {
          toasts.fail(job.error || "Download failed");
        }
      } catch (pollError) {
        if (!stopped) toasts.fail(pollError.message);
      }
    };
    tick();
    return () => {
      stopped = true;
    };
  }, [toasts]);

  const start = async () => {
    const name = localName.trim().replace(/[^a-zA-Z0-9_-]/g, "_");
    if (!name || !picked || starting) return;
    setStarting(true);
    try {
      const job = await downloadVoice(picked, name);
      setDownloads((current) => ({ ...current, [job.jobId]: job }));
      setPicked(null);
      watch(job.jobId);
    } catch (downloadError) {
      toasts.fail(downloadError.message);
    } finally {
      setStarting(false);
    }
  };

  const active = Object.values(downloads);

  return (
    <div className="rx-online">
      <div className="rx-search rx-online-search">
        <span className="ic">⌕</span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search voice-models.com — a name, a genre, an artist"
          aria-label="Search online voices"
        />
        {searching && <span className="spinner rx-online-spin" />}
      </div>

      {active.length > 0 && (
        <div className="rx-downloads">
          {active.map((job) => (
            <div className="card rx-download" key={job.jobId} data-state={job.status}>
              <div className="rx-download-row">
                <b>{job.modelName || job.modelId}</b>
                <span className="hint">
                  {job.status === "failed"
                    ? job.error || "Failed"
                    : PHASES[job.phase] || PHASES[job.status] || "Working…"}
                </span>
                <span style={{ flex: 1 }} />
                {isDownloadRunning(job) && <span className="rx-progress">{job.progress || 0}%</span>}
                {!isDownloadRunning(job) && (
                  <button
                    type="button"
                    className="btn sm ghost"
                    onClick={() =>
                      setDownloads((current) => {
                        const next = { ...current };
                        delete next[job.jobId];
                        return next;
                      })
                    }
                  >
                    Dismiss
                  </button>
                )}
              </div>
              {isDownloadRunning(job) && (
                <span className="bar">
                  <i style={{ width: `${job.progress || 0}%` }} />
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="card rx-problem">
          <b>The directory did not answer</b>
          <span className="hint">{error}</span>
        </div>
      )}

      {!query.trim() && !error && (
        <div className="card rx-empty">
          <b>Use someone else's voice</b>
          <span className="hint">
            voice-models.com is a public directory of trained RVC voices. Search for one, give it a
            name, and it installs next to the ones you trained yourself — usable everywhere they are.
          </span>
        </div>
      )}

      {results && !results.models.length && !searching && !error && (
        <div className="card rx-empty">
          <b>Nothing found for “{query.trim()}”</b>
          <span className="hint">Try a shorter search, or the artist's name on its own.</span>
        </div>
      )}

      {results && results.models.length > 0 && (
        <>
          <div className="rx-online-count hint">
            {results.models.length} result{results.models.length === 1 ? "" : "s"}
            {results.totalPages > 1 && ` · page ${results.page} of ${results.totalPages}`}
          </div>
          <div className="rx-online-list">
            {results.models.map((model) => (
              <article className="card rx-onlinecard" key={model.url || model.modelId || model.name}>
                <span className="rx-odot" style={{ background: gradientFor(model.modelId || model.name) }} />
                <div className="rx-oinfo">
                  <b title={model.name}>{model.name}</b>
                  <span className="rx-ometa">
                    {model.author && <span>{model.author}</span>}
                    {model.epochs && <span className="tag">{model.epochs} epochs</span>}
                    {model.sizeMb && <span>{Math.round(model.sizeMb)} MB</span>}
                  </span>
                </div>
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => {
                    setPicked(model);
                    setLocalName(suggestLocalName(model.name));
                  }}
                >
                  Install
                </button>
              </article>
            ))}
          </div>
        </>
      )}

      {picked && (
        <Sheet
          title="Install this voice"
          subtitle={picked.name}
          onClose={() => setPicked(null)}
          footer={
            <>
              <span style={{ flex: 1 }} />
              <button type="button" className="btn sm ghost" onClick={() => setPicked(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn sm fill"
                onClick={start}
                disabled={!localName.trim() || starting}
              >
                {starting && <span className="spinner" />}
                {starting ? "Starting…" : "Install"}
              </button>
            </>
          }
        >
          <div className="f">
            <label htmlFor="rx-localname">Call it</label>
            <input
              id="rx-localname"
              className="in"
              value={localName}
              onChange={(event) => setLocalName(event.target.value)}
              placeholder="my_voice"
            />
            <span className="hint">
              This becomes the folder it installs into and the name you will pick it by. Letters,
              numbers, dashes and underscores only.
            </span>
          </div>
          {picked.modelId && (
            <div className="kv">
              <div className="r">
                <span>Source</span>
                <b>{picked.modelId}</b>
              </div>
              {picked.epochs && (
                <div className="r">
                  <span>Epochs</span>
                  <b>{picked.epochs}</b>
                </div>
              )}
              {picked.sizeMb && (
                <div className="r">
                  <span>Size</span>
                  <b>{Math.round(picked.sizeMb)} MB</b>
                </div>
              )}
            </div>
          )}
        </Sheet>
      )}
    </div>
  );
}
