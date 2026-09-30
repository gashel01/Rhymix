import React, { useEffect, useState } from "react";
import Sheet from "./Sheet";
import { listSongs } from "../api";
import { usePlayer } from "../player";
import { gradientFor } from "../gradients";
import "./VoiceDetailModal.css";

const formatSize = (mb) => {
  if (!mb) return "—";
  return mb >= 1000 ? `${(mb / 1000).toFixed(1)} GB` : `${Math.round(mb)} MB`;
};

const PLAY_ICON = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M8 5.2v13.6c0 .9 1 1.4 1.7.9l10.1-6.8a1.1 1.1 0 0 0 0-1.8L9.7 4.3A1.1 1.1 0 0 0 8 5.2z" />
  </svg>
);
const PAUSE_ICON = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <rect x="7" y="5" width="4" height="14" rx="1" />
    <rect x="14" y="5" width="4" height="14" rx="1" />
  </svg>
);

/**
 * What a voice card opens into: its stats, plus the two things you'd
 * actually do with a trained voice next — write something new for it, or
 * hand it something you already made.
 *
 * Neither action runs from here. Picking one hands the choice to Create or
 * to Library's convert panel already filled in, the same way a cover's
 * source or a hum does — so you land somewhere you can still see and change
 * every other setting before anything actually starts, not a job fired
 * blind from a modal with no way back.
 *
 * The song list only offers tracks that have a vocal to re-sing. An
 * instrumental has nothing for a voice model to act on, so it would just be
 * a row that fails the moment you pick it - not shown at all beats a picker
 * full of dead ends.
 */
export default function VoiceDetailModal({ voice, onClose, onNavigate }) {
  const [picking, setPicking] = useState(false);
  const [songs, setSongs] = useState(null);
  const [songsError, setSongsError] = useState(null);
  const player = usePlayer();

  useEffect(() => {
    if (!picking || songs !== null) return;
    const controller = new AbortController();
    listSongs(controller.signal)
      .then((list) => setSongs(list.filter((song) => song.status === "completed" && song.vocals)))
      .catch((error) => {
        if (error.name !== "AbortError") setSongsError(error.message);
      });
    return () => controller.abort();
  }, [picking, songs]);

  const initial = (voice.name.match(/[\p{L}\p{N}]/u) || ["?"])[0].toUpperCase();

  const pickSong = (song) => {
    onClose();
    if (onNavigate) onNavigate("library", { type: "convert", songId: song.id, voice: voice.name });
  };

  const previewSong = (event, song) => {
    event.stopPropagation();
    const sourceId = `${song.id}:mix`;
    if (player.sourceId === sourceId) {
      player.toggle();
      return;
    }
    player.play({
      sourceId,
      url: song.mix,
      title: song.title,
      subtitle: "Preview",
      tint: gradientFor(song.id),
    });
  };

  return (
    <Sheet
      title={voice.name}
      subtitle={picking ? "Pick a song for it to sing" : "Trained voice"}
      onClose={onClose}
    >
      {!picking ? (
        <>
          <div className="rx-voice-modal-head">
            <span className="rx-voice-modal-avatar" style={{ background: gradientFor(voice.id) }}>
              {initial}
            </span>
            <div className="kv rx-voice-modal-kv">
              <div className="r">
                <span>Epochs</span>
                <b>{voice.epochs ?? "—"}</b>
              </div>
              <div className="r">
                <span>Size</span>
                <b>{formatSize(voice.sizeMb)}</b>
              </div>
              {voice.checkpoints?.length > 1 && (
                <div className="r">
                  <span>Checkpoints</span>
                  <b>{voice.checkpoints.length}</b>
                </div>
              )}
            </div>
          </div>
          <div className="rx-voice-modal-actions">
            <button
              type="button"
              className="btn fill"
              onClick={() => {
                onClose();
                if (onNavigate) onNavigate("create", { type: "createVoice", voice: voice.name });
              }}
            >
              Create a song with this voice
            </button>
            <button type="button" className="btn ghost" onClick={() => setPicking(true)}>
              Make it sing one of my songs
            </button>
          </div>
        </>
      ) : (
        <>
          {songsError && (
            <div className="card rx-problem">
              <b>Could not load your songs</b>
              <span className="hint">{songsError}</span>
            </div>
          )}
          {songs === null && !songsError && <div className="hint">Loading your songs…</div>}
          {songs !== null && !songs.length && (
            <div className="hint">
              None of your songs have a vocal to re-sing yet — instrumentals have nothing for a
              voice to take over.
            </div>
          )}
          <div className="rx-voice-modal-songs">
            {(songs || []).map((song) => {
              const sourceId = `${song.id}:mix`;
              const isCurrent = player.sourceId === sourceId;
              const isPlaying = isCurrent && player.playing;
              return (
                <div key={song.id} className="rx-voice-modal-song">
                  <button
                    type="button"
                    className="rx-voice-modal-song-swatch"
                    style={{ background: gradientFor(song.id) }}
                    disabled={!song.mix}
                    title={isPlaying ? "Pause" : "Preview"}
                    aria-label={isPlaying ? `Pause ${song.title}` : `Preview ${song.title}`}
                    onClick={(event) => previewSong(event, song)}
                  >
                    {isPlaying ? PAUSE_ICON : PLAY_ICON}
                  </button>
                  <button type="button" className="rx-voice-modal-song-main" onClick={() => pickSong(song)}>
                    <span className="rx-voice-modal-song-title">{song.title}</span>
                    <span className="hint">{song.voice ? `Sung by ${song.voice}` : "Original voice"}</span>
                  </button>
                  <span className="rx-voice-modal-song-go" aria-hidden="true">→</span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </Sheet>
  );
}
