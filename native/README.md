# Rhymix native shell — shell verified, VST3 hosting proves real audio processing + GUI rendering

Status: **`shell/` renders the real `/next` UI and genuinely round-trips real data through the
Flask backend (see `shell/README.md`). `engine/vst3_host/` genuinely loads real commercial VST3
plugins with real metadata, AND its full `IAudioProcessor` lifecycle is proven correct end to end
against THREE independent real plugins**: Steinberg's own GUI-free `ADelay` example (built fresh
from the vendored SDK, independently validated by Steinberg's own `validator` tool — 57/57 tests
— before this host ever touched it, then correctly modified a generated sine wave); and, this
pass, **Dexed** — a real, independent, actively-maintained JUCE-built FM synth downloaded
specifically to answer "does the host work against a genuinely unrelated third-party plugin, not
just Steinberg's example" — fed one MIDI note-on with zero audio input, it produced real,
finite, non-zero output shaped exactly like a synthesizer envelope (fast attack, then decay),
run twice with identical results, no crash. The one confirmed negative result is the **iZotope
RX 11 suite specifically** (all 17 plugins, the only commercial suite installed on this machine):
`setProcessing(true)` returns `kNotImplemented` — a
[documented Steinberg forum quirk](https://forums.steinberg.net/t/iaudioprocessor-setprocessing-fails-in-many-plugins/785558)
for that plugin family, not a host bug — and even after treating that as non-fatal (per the
forum's advice, matching real DAW behavior) and implementing+verifying a full Controller/
`IConnectionPoint` bridge, toggling each plugin's own official bypass parameter produces a
zero-difference output — confirmed real silent bypass for that suite specifically, not evidence
against the host, now that Dexed and ADelay both show real processing working. **GUI embedding
also now proven**, this pass: Dexed's real editor (6 FM operator panels, algorithm grid, virtual
keyboard) attaches into a Win32 window this host owns and was captured in a real screenshot —
first capture attempt came back solid black (a GPU-composited-rendering capture gap, caught by
checking actual pixel diversity with PIL, not assumed working), fixed by capturing from the
desktop compositor instead of the window's own DC.

**Has a real, persistent, product-facing API — `scanPlugins`/`openPluginEditor`/
`closePluginEditor` — wired through Electron IPC as `window.rhymixNative.vst3.{scan,open,close}`,
verified end to end from inside a real renderer.** Every open plugin editor runs on its own
dedicated thread with its own live Win32 message loop, confirmed NOT to block Node's event loop
(a 100ms ticker kept firing normally — 19/20 expected ticks — while a Dexed editor window stayed
open), confirmed visually with a screenshot taken by an independent tool (PowerShell) while
Node's own test kept running concurrently, and run through a full open→close cycle twice in the
same process with no crash or leak. **This is now a real Studio feature, not just a verified
contract** — every lane's "..." menu in `frontend/src/studio/components/TrackList.js` has a "VST3
Plugins" section (Electron-only, absent in the browser build) that scans, lists, and opens a real
plugin window on click, verified through actual DOM interaction in the real shell. Fixing that UI
also fixed a real bug in `scanPlugins` itself: it only looked one directory level deep, so
scanning the conventional root install folder found nothing (real plugins live one level down,
under a per-vendor subfolder) — now recursive, 17 real plugins found from the plain root path.

**Now also renders a real audio file through a plugin, offline** — `renderAudioFile()` /
`window.rhymixNative.vst3.renderFile()` reads a real WAV, processes it block-by-block through a
loaded plugin, writes a real WAV back out. Verified with an input built to leave zero ambiguity: a
1-second tone followed by 2 seconds of silence, rendered through ADelay, comes back as silence
followed by the tone — the dry signal's own timing shape, inverted, exactly matching the plugin's
delay time, checked by an independent JS-side WAV reader (not the addon's self-reported stats,
which are time-blind aggregates that wouldn't have caught this). The same file through a real
iZotope plugin came back bit-for-bit identical to the input, reconfirming the earlier per-block
bypass finding now at full-file scale. **Explicitly offline/one-shot, not live playback routing**
into Rhymix's mix during playback — that remains a separate, much larger, deliberately unattempted
real-time-systems project (shared memory, a dedicated audio thread, sample-accurate sync). See
`engine/vst3_host/README.md` for both features' full evidence trail. Still not done: crash
isolation, embedding a plugin's editor into Rhymix's own UI chrome (still a standalone window),
parameter get/set from the host side, live audio routing. There is no Mac in this build
environment, so anything macOS-related here is unverified by construction — treat every macOS path
as "should work per docs" until someone runs it on real hardware.

## Why this exists

The web app (`frontend/` + `backend/`) cannot host native VST3/AU/CLAP plugins — that's a hard
browser sandboxing limit, not a missing feature. This directory is the seed of a native
Windows/macOS shell that unlocks real plugin hosting and lower-latency audio I/O, while reusing
the existing React UI for everything that isn't audio-engine-specific.

See `docs/NATIVE_SHELL_PLAN.md` (repo root `docs/`) for the full architecture/licensing writeup —
that document was produced by AI-run research while Gaël was disconnected; treat it as a strong
draft, not a legal sign-off. Short version of the licensing decision that shapes everything
below:

- **No JUCE for plugin hosting.** JUCE's licensing is AGPLv3 (forces open-sourcing the app) or a
  revenue-tiered commercial fee — neither fits "closed-source, no license fee".
- **VST3 hosting via Steinberg's own VST3 SDK, version ≥ 3.8.0** (`github.com/steinbergmedia/vst3sdk`).
  As of that version (Oct 2025), Steinberg re-licensed the whole SDK under a plain **MIT
  License** — no fee, no GPL, no proprietary EULA gymnastics. The vendored checkout used here is
  `v3.8.1_build_84`; its `LICENSE.txt` was verified to say MIT / Steinberg Media Technologies
  GmbH before building against it (see `engine/third_party/README.md`). VST2 is explicitly
  excluded from the re-license; don't pull in VST2 shims.
- **AU hosting via Apple's `AudioUnitSDK`** (`github.com/apple/AudioUnitSDK`) — Apache License
  2.0, royalty-free, part of the OS/Xcode SDK. Not started yet.
- **CLAP as a secondary format** (`github.com/free-audio/clap`) — MIT-licensed, zero cost, zero
  copyleft obligation, smaller plugin catalog (no major vendor — NI/Waves/iZotope/Arturia — ships
  it as of this research). Not started yet.
- **Trademark note:** using the word "VST" or Steinberg's logo in marketing triggers attribution
  rules (® symbol + credit line); the MIT code rights themselves aren't affected either way.
  Easiest path: keep a credit line, skip the logo.
- **Shell framework: Electron, not Tauri.** Confirmed by research and now by construction —
  `engine/vst3_host` is a real N-API addon bridged into an Electron process exactly as planned.

**This still needs real legal review before anything ships** — see §5 of the plan doc for the
exact open questions (SDK version pinning, trademark strategy, macOS notarization, nothing here
tested on real Mac hardware).

## Phasing (see backlog doc for the reasoning)

1. **Phase 1 — shell + reaches the backend.** Done, verified (`shell/README.md`). Native
   low-latency audio I/O (ASIO/WASAPI) and MIDI hardware input specifically *from inside the
   shell* are not done — the shell currently plays audio through the same Web Audio API path the
   browser build always used.
2. **Phase 2 — VST3 hosting.** Metadata query, real audio processing, AND real GUI rendering all
   proven working (`engine/vst3_host/`) — the full lifecycle (init → Controller bridge →
   bus-arrangement → setup → activate → setProcessing → process) runs correctly end to end
   against Steinberg's own `ADelay` example AND against **Dexed**, a real independent JUCE-built
   FM synth downloaded specifically to prove the host isn't just special-cased for Steinberg's own
   example (real synthesizer envelope shape out of a MIDI note-on, `setProcessing` succeeding).
   Dexed's real editor also renders correctly in a host-owned Win32 window, captured in a real
   screenshot (six FM operator panels, algorithm grid, keyboard — not a placeholder). The only
   real *commercial* plugins available on this machine (iZotope RX 11, all 17) return
   `kNotImplemented` from `setProcessing(true)` and — decisively confirmed via a bypass-parameter
   diff test — do not actually process audio through this host at all; ruled out as a host bug
   (identical host code works against ADelay and Dexed) and as an `IConnectionPoint` bridging gap
   (implemented, connects/syncs correctly, doesn't change the outcome) — a real characteristic of
   that plugin suite specifically, not a gap left to close. See `engine/vst3_host/README.md` for
   the full evidence trail. Still missing: embedding the rendered GUI into Rhymix's own UI chrome
   (currently a plain standalone window) and sending it real interaction, scanning a whole plugin
   directory, crash isolation (a bad plugin currently takes the whole host process down), and
   wiring any of this into the actual Rhymix UI.
3. **Phase 3 — AU hosting** (macOS) and **CLAP hosting** (both platforms). Not started.

## Layout

```
native/
  CMakeLists.txt        original top-level build config — superseded in practice by
                         engine/vst3_host/CMakeLists.txt, which sources the SDK's own CMake
                         modules directly rather than this file's placeholder approach
  engine/
    third_party/         gitignored vendored SDKs (vst3sdk, ~170MB) — see third_party/README.md
                         for the fetch command
    vst3_host/           WORKING VST3 addon — real metadata query AND real audio processing
                         proven end to end (against ADelay); iZotope RX 11's setProcessing
                         quirk diagnosed (documented DAW-tolerated plugin behavior, not a host
                         bug) and now handled non-fatally — process() succeeds against it too,
                         see vst3_host/README.md
    include/, src/        original engine.h/engine.cpp placeholder — still unbuilt, superseded
                         by vst3_host for the VST3-specific work
  shell/                Electron shell — VERIFIED: renders /next, reaches the backend, real
                         click/play interaction confirmed, audio confirmed playing out loud
                         (see shell/README.md)
```

## Explicitly not done here

- **Real DSP from the iZotope RX 11 suite specifically — confirmed NOT occurring.** Decisively
  ruled out, not left ambiguous: toggling each plugin's own bypass parameter on/off via a real
  `IParameterChanges` queue changes nothing about the output (`maxAbsDiffBetweenRuns: 0`, two RX
  11 plugins tested). Real DSP **is** proven working, independently, against both Steinberg's own
  `ADelay` and a real third-party plugin (Dexed, JUCE-built, unrelated to Steinberg/iZotope) — see
  `engine/vst3_host/README.md`.
- **GUI embedding beyond a standalone window, parameter automation, plugin directory scanning,
  crash isolation** — a plugin's real editor now renders correctly (proven against Dexed), but
  only in a plain window this host owns, with no interaction sent to it yet — see
  `engine/vst3_host/README.md`'s full "What's not here" list.
- **Wiring VST3 hosting into the actual Rhymix UI.** `vst3_host` is callable from a Node/Electron
  script right now, not a Studio feature — no lane-effect-chain UI references it yet.
- **AU/CLAP hosting** — not started.
- **Native low-latency audio I/O (ASIO/WASAPI) from inside the shell** — audio still plays
  through the same Web Audio API path the browser build always used; nothing lower-latency has
  been wired in yet.
- **Packaging** (`electron-builder` or equivalent), no code signing, no installer.
- **macOS** — nothing here has ever been built, launched, or verified on real Mac hardware.
