# Speed-beatmaker UX backlog

Gaps identified against the "speed beatmaker" DAW UX standard (Ableton/FL/Serato Studio-style
workflow), compared against what Studio (`frontend/src/studio/`) actually does today. Ordered
roughly by impact-for-effort, not by dependency.

Status legend: ✅ already have it · ⚠️ partial · ❌ missing.

## 1. Non-linear pattern / scene view — ✅ done (2026-09-26), reduced scope

Added `state.scenes`/`state.clipSlots` to `store.js` (independent of `timelineStartSec`, one slot
per scene×lane, own reducer actions, participates in undo/redo same as lanes/clips) and a new
`SessionView.js` grid (rows = scenes, columns = the project's existing lanes), toggled against the
Timeline view from the toolbar (`state.ui.workspaceSection`). Assets load into a cell by dragging
from the Library panel, same `application/x-rhymix-asset` drag payload Timeline.js already uses.
Playback is quantized to the next bar and reuses `useStudioPlayback.js`'s existing lane-bus/
instrument-loading machinery (`triggerScene`/`triggerClipSlot`), with one clip-slot playing per
lane at a time (launching a new one on the same lane stops the previous one, same rule every
clip-launch DAW uses).

Two scope reductions, both intentional and documented in code:
- Session and Timeline playback are **mutually exclusive**, not mixed — starting one stops the
  other. A real Ableton-style simultaneous mix needs two time bases reconciled against one shared
  lane-bus graph; a bigger undertaking than this pass.
- Dragging a clip into a slot only supports **raw audio assets** for now, not MIDI — a clip slot's
  data model has a `clipType`/`midi` field ready for it (and `triggerClipSlot` already knows how to
  play a MIDI slot, reusing the same note-scheduling approach as `previewMidiClip`), but there's no
  UI path yet to actually create one (MIDI clips are authored in the piano roll, not dragged from
  the library the way audio assets are).

Verified: 178 studio unit tests pass including 10 new ones for the scenes/clipSlots reducer
actions (add/rename/remove scene, set/clear/replace a clip slot, undo/redo, SET_PROJECT loading),
plus 5 real React Testing Library render tests for `SessionView.js` (lane/scene rendering, loaded
vs empty cells, click-to-trigger, click-to-stop on an already-playing cell, scene launch, add
scene) — genuine component behavior, not just the reducer. Backend: 2 new tests confirm
scenes/clipSlots round-trip through `PATCH /api/studio/projects/:id` and persist across a fresh
GET. Full production build passes clean. **Not verified**: real browser/Electron playback (no dev
server stood up in this pass) — the audio-triggering code path (`triggerClipSlot`/`triggerScene`
in `useStudioPlayback.js`) is exercised by nothing beyond code review and the fact it reuses
already-proven playback primitives (`loadBuffer`, `buildLaneBus`, `loadInstrumentForLane`,
`previewMidiClip`'s note-scheduling pattern).

### Record to Timeline — ✅ done (2026-09-26)

The user asked directly, correctly comparing it to Ableton: Session and Timeline having no link
at all was a real gap, since real DAWs don't sync them automatically — they link via an explicit
"Record to Arrangement" capture action. Added the same idea here: a "Record to Timeline" toggle in
`SessionView.js`. While it's on, every clip-slot actually triggered is tracked as an open
[start, now) span per lane in `useStudioPlayback.js` (`openRecordingSpan`/`closeRecordingSpan`,
anchored to `state.transport.currentTime` at the moment recording starts, advanced off the
AudioContext's own clock the same way quantization already does); a span closes — and
materializes — the moment it's replaced by another clip-slot on the same lane, manually stopped,
or recording itself is turned off.

Materializing means converting a *looping* clip-slot performance into real, non-looping Timeline
clips: `sessionRecording.js`'s `tileRecordedSpanIntoClips` tiles the recorded duration into
back-to-back repeats of the clip-slot's source window (`srcStartSec`/`srcEndSec`), ending in a
shortened final clip if the duration doesn't land on an exact loop-length multiple. All clips from
one "stop recording" land in a single new reducer action, `ADD_TIMELINE_CLIPS` (batch, one history
entry — undo removes the whole take at once, not one undo per tiled repeat), not the existing
single-clip `ADD_CLIP` (which always starts a fresh asset at `srcStartSec: 0` and can't express an
offset loop window or repeat count).

Verified: 9 new unit tests for `tileRecordedSpanIntoClips`/`tileRecordedSpansIntoClips` — exact
loop-length multiples, a shortened remainder clip, a loop window starting mid-asset (non-zero
`srcStartSec`), floating-point drift near an exact multiple not spawning a sliver clip, a
below-threshold remainder being dropped entirely, MIDI clip-slots carrying their note payload
through every repeat, degenerate/zero-length spans producing nothing, and multiple lanes tiled
independently. Existing `SessionView.render.test.js` suite still passes unmodified (the new props
default to off/no-op, no behavior change for existing tests). 195 studio unit tests pass total,
full production build clean. **Not verified**: real browser/Electron playback of the actual record
→ trigger → stop → see-real-clips-on-Timeline flow — this pass's worktree had no
`native/shell` `node_modules` available to stand up the Electron shell; the parent should
live-verify after merging, following the same pattern used for the rest of this session's Session
view work.

### Superpowered Session view — ✅ done (2026-09-26)

Direct user feedback after trying the grid: "I can't create in it" (drag-and-drop from the
Library was the only way to fill a cell) and "it's not very visual" (uniform grey boxes, no
lane color, no animated playback feedback). User asked for all of it plus more. Delivered:

- **Click to create** — clicking an *empty* cell now opens a popover instead of doing nothing:
  a searchable list of the project's own assets (reuses `assets`, no new fetch/index — filters
  out soundfonts and anything without a playable `url`, capped at 40 results since this is a
  "grab something fast" picker, not a library browser) that loads on click via the existing
  `onDropAssetOnSlot`, plus a "✨ Generate into this slot" entry. Drag-and-drop still works
  unchanged. **Generate is a partial integration, documented honestly**: it selects the target
  lane and opens the same "Live VC"/generation drawer the rest of Studio uses
  (`actions.setSelection` + `actions.setUi({ drawerTool: "live", drawerOpen: true })`) — verified
  live, the drawer really opens on the right lane. It does **not** auto-load a finished job's
  output back into the slot; that needs the job-completion subscription in `StudioView.js`
  (`subscribeJob`) threaded through to a specific `{sceneId, laneId}` target, which is a real
  follow-up, not done here.
- **Visual pass** — a loaded cell's background/border is now tinted from `lane.color` via
  `color-mix()` (previously only the column header used it), a bar-length badge
  (`sessionViewMath.js`'s `formatBarLength`, pure + unit-tested) computed from the slot's trim and
  the project BPM, and a real mini-waveform (`StudioWaveform.js`, already used by `Timeline.js` —
  reused as-is, no new waveform code) tinted the same lane color. The static "playing" CSS class
  is now backed by an actual animated sweep (`studio-session-cell-progress`,
  `animation-duration` set inline to the slot's real loop length in seconds) instead of a flat
  color change — approximate (CSS clock, not the AudioContext sample clock the audio itself runs
  on) but reads as "in time" and costs nothing.
- **In-place actions** — a loaded cell's "⋯" opens a small menu: preview the clip through a
  throwaway `Audio()` element without touching the main mix (capped at 8s so a forgotten preview
  doesn't loop a whole song), a gain slider, start/end trim inputs, and — for a project with more
  than one scene — a "Duplicate to…" picker that copies the slot (same trim/gain) into another
  scene via the existing `SET_CLIP_SLOT` reducer action (no new state shape needed).
- **Plus two more**: keyboard navigation (every cell is a real focus target; arrow keys move
  between cells, Space/Enter triggers a loaded one or opens the picker on an empty one — kept
  local to the grid via each cell's own `onKeyDown`, deliberately *not* touching the app-wide
  Space-bar-plays-Timeline binding in `useStudioKeyboardShortcuts.js`) and a "Stop all" button
  (`playback.stopAllClipSlots()` already existed in the hook, just wasn't exposed to any button).

Verified: 6 new pure-function tests for `formatBarLength`/`secPerBar` (exact bars, singular
"1 bar", quarter-bar rounding, zero/invalid length, a different project BPM), 9 new
`SessionView.render.test.js` cases (picker opens with a matching asset + the generate entry,
picking an asset fires `onDropAssetOnSlot`, generate fires `onGenerateIntoSlot`, Stop all fires
`onStopAll`, Space on a focused loaded/empty cell matches click behavior, the menu's gain control
fires `onUpdateClipSlot`, duplicating to another scene fires `onDuplicateClipSlot`) plus the
existing suite (one assertion text updated: the empty-cell hint changed from "Drop a clip" to
"Click or drop a clip"). 212 studio unit tests pass, full production build clean. **Live-verified
in the real Electron shell** (junctioned `node_modules` into this pass's worktree specifically to
make this possible, then removed after): opened the picker on a real project, picked a real
asset, watched the waveform/bar-badge/lane-tint render, triggered it and confirmed the animated
progress element and `.playing` class, opened the menu and confirmed the gain/trim rows render,
moved focus with ArrowRight, hit Stop all and confirmed it actually stopped — and separately
confirmed "Generate into this slot" really opens the Live VC drawer on the correct lane, by
screenshot.

### MIDI clips in Session — ✅ done (2026-09-26)

Direct follow-up to a real, previously-documented gap: dragging into a slot only ever supported
raw audio assets, not MIDI, even though the clip-slot data model and `triggerClipSlot` already
supported one — there was just no UI path to create or edit one from Session. User asked for it
directly: "i cant create midi element and apply soundfonts to them easyly in session yet."

Reused the existing pieces rather than building new ones — `SET_CLIP_SLOT` already accepted
`clipType`/`midi` in its payload (no reducer change needed), and the note-editing UI
(`MidiOverlay.js`) was already decoupled from Timeline-clip specifics (its props are just
`notes`/`bpm`/`ppq`/`clipDurationSec`/`onUpdateNotes` — nothing tied to `timelineStartSec`), so it
plugs straight into a clip-slot's `midi.notes` the same way `ClipView.js` plugs it into a Timeline
clip's. `PianoKeyboard.js` came along for free with real MIDI hardware and QWERTY input already
wired in via `useMidiHardware`.

- **Create**: an empty cell's popover gets a "🎹 Create MIDI clip" entry, shown only on a
  `lane.type === "midi"` column — makes a fresh 2-bar loop (`secPerBar(bpm) * 2`,
  `sessionViewMath.js`) with empty notes.
- **Edit notes**: a loaded MIDI slot's "⋯" menu gets "🎹 Edit notes (n)", opening a popover with
  `MidiOverlay` over a small ruled grid plus `PianoKeyboard` underneath. Note entry is step-input,
  the same model `ClipView.js`'s `insertMidiNoteAtPlayhead` already uses: pressing a key writes a
  note at the current position and advances it by a fixed 16th-note step — no mouse-drawing
  required, and it's the same code path whether the "key" came from clicking the on-screen
  keyboard, typing, or a real MIDI controller. `MidiOverlay`'s own drag/resize/double-click-delete
  interactions work on these notes unmodified.
- **Soundfont**: the same MIDI slot's "⋯" menu gets an "Instrument" `<select>` (project soundfont
  assets, same list `TrackList.js`'s lane instrument picker uses) writing to `slot.midi.soundfont`
  — a field `triggerClipSlot` already read (`slot.midi.soundfont || resolveSoundfontName(lane
  .instrument, lane.name)`) but that no UI ever set before this. Left at "Lane default" it falls
  back to the lane's own instrument, same as always.

Verified: 6 new `SessionView.render.test.js` cases (the create entry only appears on a MIDI lane,
it fires `onCreateMidiSlot` with the right scene/lane, the menu shows the note editor instead of
the audio preview button for a MIDI slot, playing a key updates `midi.notes` and previews the
sound via `onPreviewMidiNote`, picking an instrument sets `midi.soundfont`) — 217 studio unit
tests pass total, full production build clean. **Live-verified in the real Electron shell**
(junctioned `node_modules` into this pass's worktree, removed after): created a MIDI clip on a
real project's MIDI lane, opened the note editor, played three keys and watched three real note
blocks render tinted the lane's color with the position readout advancing, confirmed the
instrument dropdown lists a real project soundfont asset, then triggered the clip and confirmed it
actually plays (`.playing` class, by screenshot and DOM state).

Known gap noticed in passing, not fixed here (out of scope for this task): a `curl` against the
backend mid-verification showed `scenes`/`clipSlots` still `null` for this project despite
multiple Session sessions across this whole backlog effort having created and played them — the
800ms-debounced autosave in `StudioView.js` never seems to actually persist across a process
restart. Worth the parent checking directly; every verification in this and prior Session-view
passes worked within a single running session, so this hasn't blocked anything so far, but repeat
testing always starts from a blank Session grid.

## 2. Project templates — ✅ done

Done 2026-09-26: `GET /api/studio/project-templates` + `POST /api/studio/projects` accepts a
`templateId` (`standard`, `beat_vocals`, `multitrack_stems`). "New from template" picker in
`ProjectManagerModal.js`, applies to both a blank project and one created from a source.

## 3. Drag-and-drop auto BPM/Key sync — ✅ done, reduced scope

Done 2026-09-26: `_estimate_bpm()` (`backend/features/studio/assets.py`, `librosa.beat.beat_track`,
cached by path+mtime) feeds a real `bpm` field through `probe_audio()`. `Timeline.js`'s
`handleExternalDrop` compares it to the project BPM and, if known and >3 BPM off, prompts
"Stretch to match" (playback-rate change, pitch included — not a phase-vocoder/WSOLA stretch,
flagged clearly to the user) vs "Keep original". Known gap: the stretch only affects preview
playback (`clip.tempoRate` in `useStudioPlayback.js`), not the exported render yet.

## 4. MIDI hardware controller input — ✅ note in/out done, ⚠️ CC/macro mapping still missing

Done 2026-09-24 (`17fcaf6`): `useMidiHardware.js` (`navigator.requestMIDIAccess()`) feeds real
note-on/off + velocity from a USB MIDI keyboard/pad into `PianoKeyboard.js`/`DrumPads.js`, same
surfaces the QWERTY fallback already drives. Feature-detects, no-ops gracefully without a device.

Still missing: Control Change (0xB0) messages aren't parsed at all — mapping a hardware knob to
an arpeggiator/lane FX parameter (item #9) needs that, and doesn't exist yet.

## 5. Instrument/soundfont realism — ⚠️ cheap win done, bigger win still open

Done 2026-09-26: default bank swapped from FluidR3_GM to **MusyngKite** (multi-velocity-layered
samples, same CDN, same GM instrument names — drop-in, zero architecture change).

- Bigger win, already has backend plumbing: `backend/app/ddsp_models.py` /
  `backend/app/ddsp_adapter.py` implement neural (DDSP) audio resynthesis, currently scoped to
  the Dubler feature (`dubler_melody.py`, `dubler_drums.py`). Driving Studio's MIDI lanes through
  DDSP instead of soundfont playback would leapfrog sample-based realism — worth a spike to see
  how far the existing per-instrument models generalize beyond Dubler's audio-in use case.

## 6. Mastering / loudness on export — ✅ done

Done 2026-09-24 (`17fcaf6`): `render.py`'s `_master_filter` runs ffmpeg's `loudnorm` on the final
mixdown, selectable target (Spotify -14 / Apple Music -16 / YouTube -14 / Loud -9 LUFS), true
peak ≤ -1 dBTP. "Master for streaming" checkbox in the Export menu (`Transport.js`) — now on by
default (2026-09-26) so an export is upload-ready without an extra click; stems stay unmastered
on purpose, they're meant for further mixing elsewhere.

## 7. Library organization — ✅ done

Done 2026-09-26: free-form tags per asset (`state.assets[id].tags`, `LibraryPanel.js` chips),
saved smart-filters (name + query + tags snapshot, `localStorage`), and named instrument presets
(a lane's soundfont pick, saved/applied from the same `TrackList.js` picker).

## 8. Color-coding — ✅ already have it

Every lane already has a color swatch (click to change), and clip/MIDI-note ink derives from the
lane color via `inkShade()` (`frontend/src/utils/color.js`). No work needed here.

## 9. Zero-mouse macro control — ✅ done

Done 2026-09-26: `useMidiHardware.js` now parses Control Change (`0xB0`) alongside note-on/off,
`useMidiMacros.js` adds a "Learn" flow (click Learn, move a hardware knob, it's mapped) persisted
in `localStorage`. Wired to the Arpeggiator's Octaves/Gate/Swing via `MidiMacroButton.js` — same
pattern extends to any other numeric control. Physical hardware itself untested in this
environment (none connected); verified with synthetic MIDI messages instead.

---

## Suggested sequencing

1. **#4 Web MIDI hardware input** — pure browser feature, no native shell dependency, unlocks #9
   too. Best first pick: cheap, self-contained, high perceived-speed impact for power users.
2. **#6 Export mastering pass** — closes the "is this actually upload-ready" gap raised directly
   by the user; contained to `render.py` / `jobs_common.py` + a small UI control.
3. **#5 (cheap win only) soundfont upgrade** — swap default banks, no architecture change.
4. **#2 Project templates** — cheap, high first-impression impact for new users.
5. **#3 Drag-drop BPM/Key sync** — start with a prompt-to-stretch, not silent auto-stretch.
6. **#1 Non-linear pattern/scene view** — biggest lift, needs its own design pass on the data
   model before any UI work; do this once the cheaper wins are shipped.
