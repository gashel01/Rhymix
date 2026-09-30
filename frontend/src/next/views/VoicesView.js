import React, { useCallback, useEffect, useMemo, useState } from "react";

import Menu, { MenuItem, MenuSeparator, MenuLabel } from "../components/Menu";
import OnlineVoices from "../components/OnlineVoices";
import VoiceDetailModal from "../components/VoiceDetailModal";
import { listVoices } from "../api";
import { gradientFor } from "../gradients";
import "./VoicesView.css";

/**
 * The voices you have trained.
 *
 * Epoch count and size lead because they are the two numbers people actually
 * compare when they have thirty of them: one predicts whether a voice holds up
 * on a hard line, the other is what it costs to keep.
 */

const formatSize = (mb) => {
  if (!mb) return "—";
  return mb >= 1000 ? `${(mb / 1000).toFixed(1)} GB` : `${Math.round(mb)} MB`;
};

function VoiceCard({ voice, onNavigate, onOpen }) {
  // Intentionally not `voice.name[0]` — a name starting with an underscore or a
  // digit would put punctuation in the middle of the card.
  const initial = (voice.name.match(/[\p{L}\p{N}]/u) || ["?"])[0].toUpperCase();

  return (
    <article
      className="rx-voice"
      role="button"
      tabIndex={0}
      onClick={() => onOpen(voice)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(voice);
        }
      }}
    >
      <div className="v-top" style={{ background: gradientFor(voice.id) }}>
        <span className="v-init">{initial}</span>
        {/* The card itself now opens the detail modal; this menu stays for the
            two actions that shouldn't need a full modal round-trip first. */}
        <span className="v-more" onClick={(event) => event.stopPropagation()}>
          <Menu label={`Actions for ${voice.name}`}>
            {(close) => (
              <>
                <MenuItem onSelect={() => onNavigate && onNavigate("create")} close={close}>
                  Sing a track with it
                </MenuItem>
                <MenuItem onSelect={() => onNavigate && onNavigate("train")} close={close}>
                  Continue training
                </MenuItem>
                {voice.checkpoints.length > 1 && (
                  <>
                    <MenuSeparator />
                    <MenuLabel>Saved checkpoints</MenuLabel>
                    {voice.checkpoints.slice(0, 8).map((checkpoint) => (
                      <MenuItem
                        key={checkpoint.epochs}
                        checked={checkpoint.epochs === voice.epochs}
                        // Rolling back means pointing inference at an earlier
                        // .pth. No endpoint does that yet, so this reads the
                        // state rather than pretending to change it.
                        disabled
                      >
                        {checkpoint.epochs} epochs{checkpoint.isBest ? " · best" : ""}
                      </MenuItem>
                    ))}
                  </>
                )}
              </>
            )}
          </Menu>
        </span>
      </div>
      <div className="v-body">
        <div className="v-name" title={voice.name}>
          {voice.name}
        </div>
        <div className="v-stats">
          <div>
            Epochs<b>{voice.epochs ?? "—"}</b>
          </div>
          <div>
            Size<b>{formatSize(voice.sizeMb)}</b>
          </div>
        </div>
      </div>
    </article>
  );
}

export default function VoicesView({ search = "", onNavigate }) {
  const [tab, setTab] = useState("mine");
  const [voices, setVoices] = useState(null);
  const [error, setError] = useState(null);
  const [sort, setSort] = useState("name");
  const [openVoice, setOpenVoice] = useState(null);

  const load = useCallback((signal) => {
    listVoices(signal)
      .then((list) => {
        setVoices(list);
        setError(null);
      })
      .catch((loadError) => {
        if (loadError.name !== "AbortError") setError(loadError.message);
      });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const list = (voices || []).filter((voice) => voice.name.toLowerCase().includes(needle));
    if (sort === "epochs") return [...list].sort((a, b) => (b.epochs || 0) - (a.epochs || 0));
    if (sort === "newest") {
      return [...list].sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    }
    return [...list].sort((a, b) => a.name.localeCompare(b.name));
  }, [voices, search, sort]);

  const sortLabel = { name: "Name", epochs: "Most trained", newest: "Newest" }[sort];

  return (
    <div className="rx-view">
      <div className="rx-head">
        {/* No "Voices" word here — the rail beside it already says which
            page this is. */}
        <div>
          <h1>
            {tab === "online"
              ? "Trained by other people, installed next to yours"
              : error
              ? "Unavailable"
              : voices === null
              ? "Loading…"
              : `${voices.length} trained voice${voices.length === 1 ? "" : "s"}`}
          </h1>
        </div>
        <button type="button" className="btn fill" onClick={() => onNavigate && onNavigate("train")}>
          Train a voice
        </button>
      </div>

      <div className="rx-toolbar">
        <div className="pills">
          <button
            type="button"
            className="pill"
            aria-pressed={tab === "mine"}
            onClick={() => setTab("mine")}
          >
            My voices
          </button>
          <button
            type="button"
            className="pill"
            aria-pressed={tab === "online"}
            onClick={() => setTab("online")}
          >
            Find one online
          </button>
        </div>
        <span style={{ flex: 1 }} />
        {tab === "mine" && voices !== null && voices.length > 0 && (
          <Menu className="btn ghost sm" trigger={<>{sortLabel} <span className="ch">▾</span></>} label="Sort">
            {(close) =>
              [
                ["name", "Name"],
                ["epochs", "Most trained"],
                ["newest", "Newest"],
              ].map(([id, label]) => (
                <MenuItem key={id} checked={sort === id} onSelect={() => setSort(id)} close={close}>
                  {label}
                </MenuItem>
              ))
            }
          </Menu>
        )}
      </div>

      {tab === "online" && <OnlineVoices onInstalled={() => load()} />}

      {tab === "mine" && error && (
        <div className="card rx-problem">
          <b>Could not load your voices</b>
          <span className="hint">{error}</span>
        </div>
      )}

      {tab === "mine" && voices !== null && !visible.length && !error && (
        <div className="card rx-empty">
          <b>{voices.length ? "Nothing matches that" : "No voices yet"}</b>
          <span className="hint">
            A voice is trained from a handful of clean recordings of someone singing or speaking.
            Once it exists, it can sing anything Rhymix generates.
          </span>
          {!voices.length && (
            <button type="button" className="btn fill" onClick={() => onNavigate && onNavigate("train")}>
              Train your first voice
            </button>
          )}
        </div>
      )}

      <div className="rx-vgrid">
        {tab === "mine" && visible.map((voice) => (
          <VoiceCard key={voice.id} voice={voice} onNavigate={onNavigate} onOpen={setOpenVoice} />
        ))}
      </div>

      {openVoice && (
        <VoiceDetailModal
          voice={openVoice}
          onClose={() => setOpenVoice(null)}
          onNavigate={onNavigate}
        />
      )}
    </div>
  );
}
