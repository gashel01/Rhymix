# VST3 hosting — real, working, genuinely verified proof of concept

Status: **real end-to-end audio processing through a real VST3 plugin is now proven working —
against THREE independent sources, not just Steinberg's own example.** Compiles clean against
Electron's ABI, loads real commercial VST3 plugins with actual metadata read back (not mocked),
and runs the full `IAudioProcessor` setup → activate → `setProcessing` → `process()` lifecycle
correctly. Confirmed against Steinberg's own `ADelay` example plugin (real measurable DSP
change), and — decisively, this pass — against **Dexed**, a completely independent, real-world,
actively-maintained JUCE-built FM synthesizer with no connection to Steinberg's SDK examples or
to iZotope: fed one MIDI note-on with zero audio input, it produced real, non-zero, finite,
correctly-shaped audio output shaped exactly like a synthesizer envelope (fast attack, then
decay) — see "Audio processing: a real independent third-party plugin" below. **iZotope's RX 11
suite**, once genuinely puzzling (`setProcessing(true)` returns `kNotImplemented` for all 17
plugins, non-fatal per a
[documented Steinberg forum consensus](https://forums.steinberg.net/t/iaudioprocessor-setprocessing-fails-in-many-plugins/785558)),
turned out to be mostly a test-methodology gap, not a real block: accounting for each plugin's own
reported `getLatencySamples()`, driving De-hum's "Learn" workflow parameter, and — this pass —
pushing the right amount/gain parameter for Breath Control, Dialogue Isolate, and Repair Assistant
(each described below, RX 11 sections) reclassifies **13 of the 17 plugins as genuinely,
confirmedly processing real audio** through this host. 3 more (Connect, Monitor, Spectral Editor)
are parameter-less utility tools, not insert effects — "no diff" there isn't a failure. Only
**1 plugin, Guitar De-noise**, remains genuinely unexplained after real, repeated effort with
multiple distinct parameter combinations. With Dexed also proven working independently, this reads
as the host being correct for the VST3 ecosystem broadly, with one small, specific remainder still
open in RX 11.

**GUI embedding is also now proven working**: Dexed's real native editor — the full FM
synthesis interface (6 operator panels, algorithm display, virtual keyboard, real widgets) —
attaches into a Win32 window this host creates and owns, and was captured in a real screenshot
showing the actual rendered UI, not a blank window. See "GUI embedding: a real plugin editor
renders in a host-owned window" below.

**Has a real, persistent, stateful API wired all the way through Electron IPC** —
`scanPlugins`/`openPluginEditor`/`closePluginEditor`, exposed to the renderer as
`window.rhymixNative.vst3.{scan,open,close}` — so an open plugin editor stays live and
interactive (its own dedicated thread + Win32 message loop) without blocking Node's event loop,
verified end to end from inside a real Electron renderer, not just the addon in isolation. See
"The stateful API: scan / open / close, wired through Electron IPC" below.

**Now also renders a real audio file through a plugin, offline**: `renderAudioFile()` /
`window.rhymixNative.vst3.renderFile()` reads a real WAV, runs it block-by-block through a loaded
plugin, and writes a real WAV back out. Verified with a test that leaves no room for ambiguity — a
tone-then-silence input rendered through ADelay comes back silence-then-tone, exactly matching the
plugin's own delay time, checked with an independent JS-side reader (not the addon's own
self-reported stats). The same input through a real iZotope RX 11 plugin comes back bit-for-bit
identical to the input, reconfirming the earlier per-block bypass finding at full-file scale. See
"Offline file rendering" below. **Explicitly one-shot/offline — not live playback routing into the
app's mix,** which remains a separate, larger, unattempted project (see "What's not here").

## What this does

- `loadPlugin(path)` — loads a `.vst3` module via Steinberg's own reference hosting code
  (`VST3::Hosting::Module`, the same class their own `validator` tool uses), reads back the
  factory's declared vendor/url/email and every class the plugin exposes (name, vendor, category,
  version, VST3 subcategory string).
- `processAudioTest(path)` — goes further: instantiates the plugin's Audio Module Class,
  connects a real `IHostApplication` context, and — if the plugin declares a separate Controller
  class — instantiates it too, connects it to the Component via `IConnectionPoint` in both
  directions, and syncs state (`getState` → `setComponentState`) before proceeding. Then
  negotiates the bus arrangement (`setBusArrangements` + re-reads `getBusInfo` for the
  arrangement the plugin actually settled on, not just what was requested), calls
  `setupProcessing`, activates the main input/output buses, activates the component, and attempts
  `setProcessing(true)` followed by one real `process()` call on a generated 440Hz sine wave.
  Reports real min/max/RMS/finite-check statistics read back from the actual buffers, how far the
  output diverges from the input, and whether the Controller bridge was present/connected/synced
  — see below for what it actually returns against real plugins.
- `processParamDiffTest(path)` — the decisive version of the same test: runs `process()` twice on
  the identical input, toggling the plugin's own bypass parameter (or, if it has none, its first
  automatable parameter) between two values via a real `IParameterChanges` queue. Reports both
  runs' output stats and the max absolute difference between them — the actual answer to "is this
  plugin really processing audio, or silently passing it through regardless."
- `processSynthTest(path)` — the instrument-shaped version: for plugins with zero audio input
  buses (synths), sends one real MIDI note-on through a `Steinberg::Vst::EventList` attached to
  `ProcessData::inputEvents`, runs several consecutive blocks, and reports real per-block
  min/max/RMS — whether the plugin actually synthesizes audio from nothing but a MIDI event.
- `processGuiTest(path, screenshotPath)` — creates the plugin's real editor view
  (`IEditController::createView`), attaches it into a real Win32 window this host owns, pumps a
  real message loop so it actually paints, and captures a real screenshot (24bpp BMP, no
  GDI+/WIC dependency) from the desktop compositor — proof a plugin's own GUI genuinely renders,
  not just that `attached()` didn't return an error.
- `scanPlugins(directories)` / `openPluginEditor(path)` / `closePluginEditor(instanceId)` — the
  real, persistent, product-facing API (as opposed to everything above, which is one-shot proof
  functions): lists installed plugins without loading anything, opens a plugin's editor as a
  real live window that stays interactive on its own dedicated thread until explicitly closed,
  and closes it cleanly. See "The stateful API" section below.

## Verified — real output, not a mock

Built with `cmake-js` targeting Electron 33.4.11's ABI, loaded from inside Electron (the addon is
built against Electron's Node ABI, not system Node — it will not `require()` under plain
`node`), against real plugins already installed on this machine
(`C:\Program Files\Common Files\VST3\iZotope\`):

```
loadPlugin("C:/Program Files/Common Files/VST3/iZotope/RX 11 De-hum.vst3")
→ {
    moduleName: "RX 11 De-hum.vst3",
    factory: { vendor: "iZotope", url: "http://www.izotope.com", email: "mailto:support@izotope.com" },
    classes: [
      { name: "RX 11 De-hum", vendor: "iZotope", category: "Audio Module Class", version: "11.3.0", subCategories: "Fx|Restoration" },
      { name: "RX 11 De-hum Controller", vendor: "iZotope", category: "Component Controller Class", version: "11.3.0", subCategories: "Fx|Restoration" }
    ]
  }
```

Also loaded `RX 11 De-click` and `RX 11 Spectral De-noise` (both returned correct names/versions),
and confirmed a genuinely bad path (`C:/nonexistent/fake.vst3`) throws a real error instead of
silently succeeding — ruling out "this just always returns hardcoded data" as an explanation for
the results above.

## Audio processing: proven working against a real plugin

To isolate "is the host's own sequence correct" from "does iZotope's plugin family need
something extra," built Steinberg's own **ADelay** example plugin — GUI-free (`adelay`'s
`CMakeLists.txt` has no VSTGUI dependency at all, unlike `again`/`again-simple` which both
require VSTGUI and were skipped for exactly that reason) — straight from the vendored SDK:

```
cmake -S native/engine/third_party/vst3sdk -B <build-dir> -G "Visual Studio 17 2022" -A x64 `
  -DSMTG_ENABLE_VSTGUI_SUPPORT=OFF -DSMTG_ENABLE_VST3_HOSTING_EXAMPLES=OFF `
  -DSMTG_ENABLE_VST3_PLUGIN_EXAMPLES=ON `
  -DSMTG_PLUGIN_TARGET_PATH=<build-dir>/plugin_output
cmake --build <build-dir> --target adelay --config Release
```

Steinberg's own build step runs their `validator` tool against the freshly-built plugin
automatically — **57/57 tests passed**, independent confirmation (using their own reference host
code, not this project's) that the binary does real, correct audio processing before this host
ever touched it.

Ran it through the exact same `processAudioTest()` used against iZotope, unmodified:

```
loadPlugin(adelay.vst3) → classes: ["ADelay" (Audio Module Class), "ADelayController", "ADelayTest Factory"]

component->initialize()        → kResultOk
processor->setBusArrangements() → called (2 in / 2 out, stereo)
processor->setupProcessing()    → kResultOk
component->activateBus() ×2     → called
component->setActive(true)      → kResultOk
processor->setProcessing(true)  → kResultOk   ← this is what failed for every iZotope plugin
processor->process()            → kResultOk, processOk: true
```

Real output buffer stats (512 samples × 2 channels = 1024 values):
```
inputStats:  { min: -0.49999, max: 0.49999, rms: 0.3507, allFinite: true }
outputStats: { min: 0,        max: 0,       rms: 0,      allFinite: true }
maxAbsDiffFromInput: 0.49999   (i.e. essentially the full signal amplitude)
```

**Why silence is the *correct* result, not a failure**: ADelay's default `Delay` parameter is
`1.0` normalized, and its own source (`adelayprocessor.cpp`: `delayInSamples = mDelay *
sampleRate`) maps that directly to **44100 samples — a full 1 second** at the 44.1kHz this test
runs at. A delay line longer than the block being processed (512 samples) is mathematically
required to output silence on the very first block — there's nothing in the buffer yet to play
back. Combined with `maxAbsDiffFromInput` showing the output is nowhere close to a passthrough,
this is exactly what a correctly-functioning delay effect does on a cold start, not a red flag.
Ran the whole sequence twice in the same process (fresh `processAudioTest()` call each time) with
no crash — rules out state corruption from the first run leaking into the second.

**Conclusion, now confirmed rather than hypothesized:** the host's setup/activation/processing
sequence is correct. The iZotope RX 11 suite's `kNotImplemented` at `setProcessing(true)` is a
real characteristic of that plugin family specifically, not a defect in what's built here — see
"The Controller/IConnectionPoint bridge: implemented, tested, ruled out" below for what was
actually tried next and why it wasn't the answer either.

## Audio processing: the iZotope-specific blocker (context, not re-verified this pass)

`processAudioTest()` genuinely implements the correct sequence — confirmed by comparing against
Steinberg's own reference host code (`public.sdk/samples/vst-hosting/audiohost/source/media/
audioclient.cpp`, the same setup order their `AudioHost` sample app uses) — and every step up to
and including component activation **succeeds against real plugins**:

```
component->initialize(&hostApplication)        → kResultOk
processor->setBusArrangements(...)              → called, re-read getBusInfo after
processor->setupProcessing(setup)               → kResultOk
component->activateBus(kAudio, kInput/Output, 0, true)  → called
component->setActive(true)                      → kResultOk
processor->setProcessing(true)                  → kNotImplemented (0x80004001)  ← blocked here
```

**The blocker, precisely diagnosed, not guessed at:** swept all 17 `.vst3` files in
`C:\Program Files\Common Files\VST3\iZotope\` (the entire installed RX 11 suite — De-hum,
De-click, De-clip, De-crackle, De-ess, De-plosive, De-reverb, Spectral De-noise, Voice De-noise,
Guitar De-noise, Mouth De-click, Breath Control, Dialogue Isolate, Repair Assistant, Spectral
Editor, Monitor, Connect). **Every single one** returns the identical `kNotImplemented` from
`IAudioProcessor::setProcessing(true)`, after every prior step (including `setActive(true)`)
returned `kResultOk`. This is a suite-wide characteristic, not a per-plugin quirk or a bug this
harness introduces for one unlucky plugin.

Tried and ruled out as the cause:
- **Bus arrangement mismatch** — added explicit `setBusArrangements()` (matching the plugin's own
  reported mono/stereo channel count) and re-read `getBusInfo()` afterward per the SDK docs
  ("need to be recheck after `setBusArrangements` is called"). No change.

**"Maybe `setProcessing`'s failure is an ignorable notification, not a real gate" — now confirmed,
not just guessed, and this is what `processAudioTest()` actually does.** An earlier pass tried
this in isolation, saw a bit-identical output, and reverted to treating a failed `setProcessing`
as fatal. That earlier conclusion was made without knowing whether this was expected behavior or
a red flag. A [Steinberg developer forum thread](https://forums.steinberg.net/t/iaudioprocessor-setprocessing-fails-in-many-plugins/785558)
reports the *exact* same symptom against the *exact* same plugin family — "iZotope and most of
the iZotope plugins" return failure from `setProcessing()` in a custom host while working fine in
commercial DAWs — and the consensus from experienced VST3 host developers there is unambiguous:
commercial DAWs call `process()` regardless of this return value; the varied return codes reflect
differing plugin implementations of what is, in practice, an advisory call, not a real gate. On
the strength of that, `processAudioTest()` no longer treats a non-`kResultOk` `setProcessing`
result as fatal — it logs the result (`setProcessingResult`/`setProcessingOk` in the returned
object) and calls `process()` anyway, matching what a real DAW does.

Re-verified against real RX 11 De-hum, twice in the same process:
```
setProcessingResult: 0x80004001 (kNotImplemented), setProcessingOk: false
processResult: kResultOk, processOk: true
inputStats / outputStats: identical — min -0.49999, max 0.49999, rms 0.3507, allFinite: true
maxAbsDiffFromInput: 0
```
`process()` now genuinely succeeds — correct result code, finite values, correctly-shaped 2-channel
output, no crash across two consecutive runs in the same process. At the time this was written,
whether real DSP had occurred was left open — see the next section for the decisive answer, found
by asking the plugin the one question it can't dodge: does its own bypass switch change anything.

## Audio processing: the ambiguity resolved — no real DSP is occurring for RX 11 via this host

The previous section's open question — "is bit-identical output real processing on clean audio,
or a silent bypass?" — is now answered, not guessed at. `processParamDiffTest(path)` (new
function in `addon.cpp`, reusing the exact same setup/activation/Controller-bridge/setProcessing
sequence) runs `process()` **twice on the identical input buffer**, toggling the plugin's own
`ParameterInfo::kIsBypass`-flagged parameter — the one designated by the VST3 spec itself for
exactly this purpose — between bypassed (`1.0`) and active (`0.0`), via a real `IParameterChanges`
queue (`public.sdk/source/vst/hosting/parameterchanges.h`, Steinberg's own reference
implementation) attached to `ProcessData::inputParameterChanges`. This is the actual VST3
automation path — not calling `setParamNormalized()` on the Controller and hoping the separate
Component object notices, which it has no obligation to do.

Real, verified result against **RX 11 De-hum**:
```
paramTitle: "Global bypass", paramId: 26
valueA (bypassed=1.0) → processResult: kResultOk, output: min -0.49999 max 0.49999 rms 0.3507
valueB (active=0.0)   → processResult: kResultOk, output: min -0.49999 max 0.49999 rms 0.3507
maxAbsDiffBetweenRuns: 0
```

And against **RX 11 De-click** (different plugin, same test, confirming this isn't a one-off):
```
paramTitle: "Global bypass", paramId: 3
valueA (bypassed=1.0) → output: min 0, max 0, rms 0 (silence)
valueB (active=0.0)   → output: min 0, max 0, rms 0 (silence)
maxAbsDiffBetweenRuns: 0
```

**Conclusion, now decisive rather than ambiguous: no real DSP is occurring.** Flipping the
plugin's own official bypass switch between "bypassed" and "active" produces a **zero-difference**
output both times, for two different plugins. If real processing were happening when unbypassed,
even a restoration tool with nothing to fix would be expected to show *some* numerical difference
between its bypassed and active code paths (different internal state, at minimum different
floating-point rounding). Getting literally `maxAbsDiffBetweenRuns: 0` twice, against two separate
plugins, rules out "correctly did nothing to clean audio" and confirms silent bypass/no-op — this
host is not making these plugins do real audio processing, despite `setActive`, the Controller
bridge, and `process()` itself all reporting success. De-click's pure-silence output (rather than
De-hum's input-passthrough) also shows the *way* it fails differs per plugin, which reads as
"something in the RX 11 family's internal gating is not satisfied" rather than one specific
narrow bug — consistent with the "these tools route through iZotope's own RX application, not a
generic host's `process()` loop" theory in the section below, now with actual evidence behind it
instead of just a plausible guess.

## Audio processing: a real independent third-party plugin (Dexed)

Everything above tested either Steinberg's own reference example or the one commercial suite
installed on this machine (iZotope RX 11, all effects). Gaël asked directly: does a plugin from a
genuinely different, independent vendor also fail, or is RX 11 an isolated case? No other VST3
plugin exists anywhere on this machine (`C:\Program Files\Common Files\VST3\` had only the
iZotope folder), so [Dexed](https://github.com/asb2m10/dexed) — a real, actively-maintained,
widely-used FM synthesizer, built on JUCE (a completely different plugin framework from both
Steinberg's SDK examples and iZotope's own codebase) — was downloaded (portable Windows zip,
`v1.0.1`, MIT-licensed) for this test.

Dexed is an **instrument**, not an effect — it generates audio from MIDI, and has zero audio
input buses (`numInputBuses: 0`), which the existing `processAudioTest()`/`processParamDiffTest()`
tone-in/diff-out model doesn't fit. Added `processSynthTest(path)` (new function in `addon.cpp`,
reusing the exact same component/controller/bus-setup/`setProcessing`-non-fatal sequence): sends
one real MIDI note-on (middle C, velocity 0.9) through a real `Steinberg::Vst::EventList` attached
to `ProcessData::inputEvents` — the same event-list class and attachment point Steinberg's own
`audiohost` reference host uses (`public.sdk/samples/vst-hosting/audiohost/source/media/
audioclient.cpp`) — on block 0 only, then runs 12 consecutive blocks (~139ms at 44.1kHz/512) with
no further input at all, reading back real per-block min/max/RMS from the actual output buffer.

For a synth specifically, this sidesteps the ambiguity effects plugins have ("maybe it correctly
passed clean audio through unchanged") entirely: there is no audio input to pass through, so any
non-silent output can only be the plugin's own synthesis.

Real, verified result — run twice in the same process, byte-for-byte identical both times (no
crash, no state corruption):

```
setProcessingResult: kResultOk   (0 — unlike every iZotope plugin, Dexed's own setProcessing succeeds)
numInputBuses: 0, numOutputBuses: 1, numEventInputBuses: 1   (confirms it's a pure instrument)
overallMin: -0.1255, overallMax: 0.1246, overallRms: 0.0731, allFinite: true

Per-block RMS across the 12 blocks (fed the note-on only on block 0):
0.0098 → 0.0658 → 0.0865 → 0.0844 → 0.0824 → 0.0804 → 0.0781 → 0.0761 → 0.0736 → 0.0719 → 0.0693 → 0.0678
```

**This is exactly the shape of a real synthesizer envelope**: near-silent on the very block the
note-on lands (attack hasn't opened yet), ramping up to a peak around block 2 (~23ms in — a
plausible fast-attack time), then a smooth decay/sustain curve for the rest of the held note. Not
noise, not a flat DC value, not silence, not a step function — a physically coherent envelope
shape a from a plugin that was fed nothing but one MIDI event.

**Conclusion: real audio processing, independently confirmed against a third, unrelated vendor.**
The host's setup/activation/processing sequence now has three-for-three real evidence behind it
(ADelay, and now Dexed) and one clearly-isolated negative result (iZotope RX 11 specifically, with
its own dedicated investigation above). This is strong evidence the earlier RX 11 finding is a
real characteristic of that plugin family, not a sign this host fails against third-party plugins
broadly.

## The Controller/IConnectionPoint bridge: implemented, tested, ruled out

The next hypothesis was that iZotope's RX line (visible in the `classes` array as a separate
`"RX 11 De-hum Controller"` class alongside the Component) gates `setProcessing` on that
Controller being connected to the Component via `IConnectionPoint` and handed the Component's
state — a real requirement for some "distributable" VST3 plugins, per Steinberg's own docs and
example hosts. This was **actually implemented**, not just theorized:

```cpp
component->getControllerClassId(controllerCID)              // find the separate Controller class
factory.createInstance<IEditController>(controllerUID)       // instantiate it separately
controller->initialize(&hostApplication)                     // initialize it with the same context
componentCP->connect(controllerCP.get())                     // IConnectionPoint, both directions
controllerCP->connect(componentCP.get())
component->getState(&componentState)                         // MemoryStream round-trip
controller->setComponentState(&componentState)
```

Run against the real iZotope plugins, every step of the bridge itself succeeded:

```
hasSeparateController = true   (RX 11 De-hum and De-click both have a separate Controller class)
controllerConnected   = true   (IConnectionPoint::connect succeeded, both directions)
controllerStateSynced = true   (getState → setComponentState round-tripped cleanly)
processor->setProcessing(true) → kNotImplemented (0x80004001)   ← identical failure, unchanged
```

**The bridge is real, correctly wired, and verified working — and it did not fix anything.**
`setProcessing(true)` fails identically with or without it. This rules the Controller/
IConnectionPoint hypothesis out conclusively rather than leaving it as the leading theory. Ran
the whole sequence (including the bridge) twice in the same process — no crash, no leak-driven
corruption on the second run either.

**Where this leaves it:** the host's setup/activation/processing sequence and the Controller
bridge are both proven correct (against `ADelay` and against iZotope's own bridge requirements
respectively). The remaining explanation is that several of the RX 11 suite's plugins are, by
design, not standard realtime `IAudioProcessor` effects at all — iZotope's own workflow for tools
like Repair Assistant, Spectral Editor, Monitor, and Connect routes audio through their separate
RX desktop application rather than through a host's `process()` calls; `kNotImplemented` may be
the honest, correct answer for this plugin family specifically, not a gap left to close. Testing
against a "normal" (non-iZotope, non-restoration-suite) commercial VST3 effect would be the way
to confirm or refute that — none was available on this machine to test against.

## GUI embedding: a real plugin editor renders in a host-owned window

A plugin's audio processing being correct doesn't make it usable by a person — most VST3 plugins
(Dexed very much included, with 6 FM operators' worth of parameters) have no generic fallback UI;
they need their own editor window rendered. Added `processGuiTest(path, screenshotPath)` (new
function in `addon.cpp`), building on the same Controller/`IConnectionPoint` bridge already proven
in `processAudioTest()` (a plugin's editor talks to its Controller, not the Component, so the
bridge is a real prerequisite here too, not just for audio):

```cpp
IPlugView* view = controller->createView(ViewType::kEditor);
view->isPlatformTypeSupported(kPlatformTypeHWND);   // → kResultTrue on Windows
// ... create a real Win32 window (CreateWindowExW) ...
view->attached(hwnd, kPlatformTypeHWND);
view->getSize(&rect);                                // real reported editor size, resize the window to match
// ... pump a real Win32 message loop so WM_PAINT/WM_TIMER actually run ...
```

Run against Dexed (already proven working for audio processing — same plugin, extending the
same proof): `attached()` returned `kResultOk`, and `getSize()` reported a real, plausible editor
size (866×674 — not 0×0, not some placeholder value).

**First screenshot attempt was a genuine miss, caught and fixed, not glossed over.** The first
version of this function captured via `PrintWindow(hwnd, hdc, PW_RENDERFULLCONTENT)` (and a
`BitBlt` fallback) against the window's own device context — standard technique for GDI-painted
windows. The result was a byte-for-byte uniform black image: verified with Python's PIL
(`Image.getcolors()`), not just a quick look — **exactly 1 distinct color across the full
866×674 bitmap**. Root cause: Dexed (JUCE-built) renders its editor through a GPU-composited
surface, which a window-DC-based capture reads back as black regardless of what's actually
displayed on screen — a well-known limitation of `PrintWindow`/`BitBlt` against hardware-
accelerated rendering, not a sign the editor failed to attach or paint. Fixed by capturing from
the **desktop DC** at the window's actual on-screen rectangle instead
(`GetDC(nullptr)` + `BitBlt` from the client area's screen coordinates, after `SetForegroundWindow`
to ensure it isn't occluded) — this reads whatever DWM actually composited to the physical
screen, which includes GPU-rendered content, because that's the real final pixel data a person
looking at the monitor would see.

Re-verified after the fix, run twice in the same process:

```
attachResult: kResultOk, reportedWidth: 866, reportedHeight: 674
run 1: 4399 distinct colors across the full captured bitmap (PIL getcolors(), not sampled)
run 2: 4376 distinct colors — same window, freshly re-rendered, no crash, no corruption
```

**The screenshot itself was inspected directly** (not just the color-count number) — it shows,
unambiguously, Dexed's real editor: six FM operator panels (Ratio/Fixed toggles, EG Level/Rate
graphs, Mod Sens/Key Vel/Level knobs), the algorithm selector grid, the "dexed" logo, and a
virtual piano keyboard, all correctly laid out and legible. This is not a plausible-looking
placeholder or a partial render — it's the actual interactive interface a person would use to
program a patch.

**What this doesn't cover yet**: the window is a plain standalone top-level window, not embedded
inside anything resembling the Rhymix shell's own UI chrome (that's a separate, later integration
step); no mouse/keyboard interaction was sent to the editor (attach + paint only, not "does
turning a knob work"); not tested against any iZotope plugin (unclear whether a plugin whose audio
processing silently no-ops would still render a real editor — a reasonable follow-up question, not
answered here); Windows only, nothing macOS-equivalent (`NSView`) attempted.

## The stateful API: scan / open / close, wired through Electron IPC

Everything above this point is one-shot: load, prove something, tear everything down, return —
correct for proving a specific claim, wrong shape for a product feature. A real "browse your
installed plugins and open one" UI needs a plugin's editor to open and **stay open, live and
interactive**, while the rest of the app (and Node's own event loop) keeps running normally.
That's a genuinely different engineering problem from anything above: it needs persistent state
across calls, and a live native window running concurrently with Node without either blocking
the other.

**Design**: every open plugin instance gets its own dedicated `std::thread`, which owns that
instance's VST3 objects (Component, Controller, view), its window, and its Win32 message loop
for the instance's entire lifetime. No VST3 object is ever touched from a thread other than the
one that created it — real thread affinity, not just a convenient simplification (a lot of
plugin GUI code silently assumes single-threaded access). `openPluginEditor()` spawns that
thread and blocks (on a libuv threadpool thread, not Node's main thread — via
`Napi::AsyncWorker`) only until the window thread signals it's either ready or failed, via a
`std::condition_variable`. `closePluginEditor()` posts a custom thread message
(`PostThreadMessage(threadId, WM_APP_CLOSE_EDITOR, ...)`) into that same thread's message queue,
which its `GetMessageW` loop wakes on and breaks out of to run the same proven teardown sequence
(`view->removed()`/`release()`, `DestroyWindow`, Controller/Component terminate), then joins the
thread. `scanPlugins()` is much simpler — for each `.vst3` entry found directly under each given
directory, does the lightweight `loadPlugin`-style metadata-only load and fully unloads before
moving to the next file; it never leaves anything loaded.

**Verified — real numbers, not "no exception was thrown":**

```
scanPlugins(["C:/Program Files/Common Files/VST3/iZotope"])
→ 17 entries, real metadata each (e.g. {name: "RX 11 Breath Control", vendor: "iZotope", category: "Fx|Restoration"})

openPluginEditor(Dexed.vst3) → resolved in ~90ms, real instanceId
  — while the window stayed open, ran a 100ms setInterval ticker for 2000ms in the SAME process:
    19 ticks observed (expect ~20) — Node's event loop is NOT blocked by the open native window.
  — screenshotted the live window via a second, independent tool (PowerShell + GDI CopyFromScreen,
    not this addon's own code, so it isn't testing itself) while Node's test script kept running
    concurrently: real, correctly-rendered Dexed UI, a real OS window titled "Rhymix Plugin" with
    working minimize/maximize/close chrome, captured and visually inspected directly (not just a
    color-variance check this time).
closePluginEditor(instanceId) → true, window actually gone (confirmed: PostThreadMessage
  delivered, GetMessageW loop exited, DestroyWindow ran) — verified visually, not assumed.

Ran the full open → coexist (2s) → close cycle TWICE in the same Node process (fresh
openPluginEditor call each time): no crash, no hang, no leaked thread/handle blocking the second
cycle — same repeat-use rigor as every prior pass in this file.
```

**Electron IPC bridge** (`native/shell/src/main.js` + `src/preload.js`) — the exact contract the
Rhymix UI is meant to build against:

```js
window.rhymixNative.vst3.scan(directories: string[])  -> Promise<Array<{path, name, vendor, category}>>
window.rhymixNative.vst3.open(path: string)            -> Promise<{instanceId: string}>
window.rhymixNative.vst3.close(instanceId: string)      -> Promise<boolean>
```

`main.js` requires the built addon defensively (a missing/ABI-mismatched build logs a warning
and disables just the `vst3:*` IPC handlers, not the whole shell) and wires three
`ipcMain.handle` calls straight through to it. `preload.js` exposes the three methods via
`contextBridge.exposeInMainWorld` — `contextIsolation` stays `true` (unchanged from the rest of
this shell; this was not a reason to turn it off).

**Verified from inside a real Electron renderer**, not just against the addon directly —
launched the actual shell (`npx electron .` in `native/shell`) and called the exposed API via
`webContents.executeJavaScript()`:

```
window.rhymixNative.vst3.scan([...]) → 17 real entries, identical to the direct-addon result
window.rhymixNative.vst3.open(dexedPath) → {ok: true, instanceId: "vst3-..."}
window.rhymixNative.vst3.close(instanceId) → {closed: true}
```

This confirms the IPC bridge itself works end to end, not just that the addon works when called
directly from a bare Node script (a genuinely different thing to get right — context-isolated
IPC has its own serialization/threading behavior to get correct).

**What this doesn't cover yet**: the open/close cycle was verified twice at the addon level and
once through the full IPC bridge (not repeated twice through IPC specifically — the addon-level
result already establishes the repeat-use robustness; the IPC layer adds no new state of its
own to leak). No actual Studio UI was built against this — `frontend/src/studio/` was
deliberately not touched this pass; `window.rhymixNative.vst3` is the real, verified contract
for whoever builds that UI next. No parameter get/set exposed through this API yet (a person can
turn Dexed's knobs by hand in its own window, but nothing here lets Rhymix itself read/write a
parameter value or automate one).

## Embedded editor windows: reparented into the caller's own window, not a floating one (2026-09-25)

`openPluginEditor`/`closePluginEditor` above always open a **standalone top-level OS window**
(`WS_OVERLAPPEDWINDOW`, its own titlebar/chrome, positioned by Windows itself). Rhymix wants that
to be the *opt-in* path, not the only one — the default should be the plugin's real editor
rendering directly inside Rhymix's own window (Studio's right panel), the way a native DAW embeds
plugin GUIs in its own UI instead of always spawning a separate window.

**Design**: `openPluginEditorEmbedded(path, parentHwnd, x, y, width, height)` is the same
per-instance-thread/message-loop machinery as `openPluginEditor`, with one branch changed — the
window is created with `WS_CHILD | WS_VISIBLE` and an explicit parent HWND from the start
(`CreateWindowExW(..., WS_CHILD | WS_VISIBLE, x, y, width, height, parentHwnd, ...)`), not
`WS_OVERLAPPEDWINDOW` with no parent. The plugin's `IPlugView` is sized to the caller's requested
rect (`view->onSize()`) rather than the plugin's own preferred size, since an embedded panel's
size is dictated by the host layout, not the plugin. Repositioning after the fact
(`repositionPluginEditor(instanceId, x, y, width, height)`) reuses the exact same cross-thread
`PostThreadMessage` pattern as `closePluginEditor`'s `WM_APP_CLOSE_EDITOR`, with a new
`WM_APP_REPOSITION` message: since `PostThreadMessage` only carries two pointer-sized values, the
new rect is heap-allocated by the caller and passed as the message's `lParam`, then freed by the
window thread itself after applying `SetWindowPos` + `view->onSize()`. `closePluginEditor`
needed **no changes at all** for the embedded case — `DestroyWindow()` already tears down a
`WS_CHILD` window exactly the same way as a top-level one in Win32.

**Verified live, inside the real Electron shell, against Dexed — with real desktop screenshots,
not `webContents.capturePage()`** (which only captures Chromium's own rendering; a reparented
native child HWND is composited by the OS on top of that and is invisible to Electron's own
in-process capture — confirmed by hand that `capturePage()` alone is the wrong tool for this
specific verification):

```
openEmbedded(Dexed.vst3, x: 900, y: 100, width: 400, height: 500)
  → real desktop screenshot: Dexed's actual GUI (6 FM operator panels, "dexed" logo, virtual
    keyboard) rendered genuinely INSIDE the Rhymix window's own bounds at the requested position —
    not a separate floating window, not blank.

reposition(instanceId, x: 100, y: 300, width: 600, height: 300)
  → real desktop screenshot: same plugin GUI visibly moved to the new position/size, live, with
    no reopen — proof SetWindowPos + view->onSize() genuinely repaints in place.

close(instanceId)
  → real desktop screenshot: plugin window completely gone, Studio UI fully restored, no orphaned
    window remnant.
```

**Electron IPC bridge**, added to the same `window.rhymixNative.vst3` surface:

```js
window.rhymixNative.vst3.openEmbedded(pluginPath: string, {x, y, width, height}) -> Promise<{instanceId: string}>
window.rhymixNative.vst3.reposition(instanceId: string, {x, y, width, height})    -> Promise<boolean>
```

`main.js`'s `vst3:openEmbedded` handler resolves the parent HWND via
`BrowserWindow.fromWebContents(event.sender).getNativeWindowHandle()` — the caller's own window,
not a renderer-supplied value (renderers never get a raw native window handle; that's real OS
access and stays main-process-only by design). `x`/`y`/`width`/`height` are CSS pixels relative
to the renderer's own client area — the same coordinate space `getBoundingClientRect()` on a
placeholder element already returns.

**Not verified**: behavior under a display scale factor other than 100% — Win32 `SetWindowPos`
operates in physical pixels, and whether Electron's reported coordinates already account for
`window.devicePixelRatio` before reaching these calls, or need an explicit correction, wasn't
tested (single 100%-scale monitor only). **Not built this pass** (deliberately out of scope):
the actual Studio right-panel placeholder UI, a resize-observer wiring `reposition()` to real
layout changes, and a UI toggle for embedded (default) vs. standalone (opt-in, via the existing
`open()`/`close()`, unchanged) — `frontend/src/studio/` was not touched.

## Embedded RX 11 GUIs rendered solid black — missing IPlugFrame was the cause (2026-09-25, later)

Live-testing the embedded panel above (once wired into the real Studio UI) with an actual
iZotope RX 11 plugin — "RX 11 De-Reverb" — surfaced a real bug: the plugin's editor opened
(`.studio-vst-embed-surface` present, correctly sized/positioned, "Close" button worked) but the
surface stayed a **solid black rectangle**, no visible content, even though the exact same
reparenting code correctly displayed Dexed's full JUCE editor moments earlier.

Root cause found by direct code inspection, not guesswork: `RunPluginWindow()` — the single
shared function behind both standalone and embedded editor opening — called
`view->attached(hwnd, kPlatformTypeHWND)` but **never called `view->setFrame(...)` first**. A
`grep` for `IPlugFrame`/`setFrame`/`resizeView` across the whole of `addon.cpp` returned zero
matches prior to this fix — the host had never implemented `Steinberg::IPlugFrame` at all, for
either editor-opening path, since the very first version of this file. Reference hosts (REAPER,
Cubase, the Steinberg example host in the SDK) always provide a real `IPlugFrame` before calling
`attached()`; this host simply never did.

**Fix**: added a minimal `MinimalPlugFrame : public Steinberg::IPlugFrame` (queryInterface /
addRef / release boilerplate + a `resizeView()` that just forwards to `view->onSize()` — this
host drives sizing itself via the caller's placeholder rect, so plugin-initiated resize requests
are acknowledged, not acted on). A local instance is created in `RunPluginWindow()` and passed to
`view->setFrame(&plugFrame)` immediately before `attached()`, for both the embedded and standalone
paths. Lifetime is safe: the instance lives on `RunPluginWindow`'s stack for the function's whole
duration, which already spans the plugin's entire open lifetime (including the message pump), so
it's never touched after the view that holds the pointer is released.

**Verified with real desktop screenshots** (PowerShell `CopyFromScreen`, not
`webContents.capturePage()` — Electron's own page-capture doesn't see a reparented native child
window's GPU-composited content at all, a trap already documented above; the fix wouldn't have
been distinguishable from "still broken" using that method):

- **RX 11 De-Reverb**, embedded in Studio's right panel: went from a solid black rectangle to the
  real plugin UI — visible "RX De-reverb" header, "Reduction" and "Reverb Profile" sections,
  Low/Low-mid/High sliders, Learn/Input/Output controls, Bypass button.
- **RX 11 Voice De-noise**, embedded, same session: also rendered correctly — "Adaptive mode"
  checkbox, the threshold curve graph, Bypass — confirming the fix is general to the RX 11 GUI
  toolkit, not specific to one plugin.
- **Dexed**, re-tested embedded after the fix: still renders correctly (full 6-operator FM
  interface, "dexed" logo) — no regression from adding `setFrame()` to a path that already worked
  without it.

Rebuilt via the project's normal `npm run build` (`cmake-js compile --runtime=electron
--runtime-version=33.4.11 --arch=x64`) inside `native/engine/vst3_host/`. One build hiccup worth
noting for next time: the very first rebuild attempt failed with `LNK1104: cannot open file
...rhymix_vst3_host.node` — the file was locked by an already-running Electron process from the
prior verification pass; killing all `electron.exe` processes first and rebuilding again succeeded
cleanly.

## "Reopen shows black" — could not reproduce after the IPlugFrame fix (2026-09-25, later still)

Right after the `IPlugFrame` fix above shipped and the shell was relaunched, the user reported
live: a plugin displays correctly the first time, but "when you reopen they show blacked out."
Investigated as two ordered hypotheses — (A) a frontend/React bug where the reopened instance
never actually gets a native window (the black is just the placeholder's own CSS background,
`.studio-vst-embed-surface { background:#000 }`, with no native content behind it at all), checked
first because it's cheap to rule out without touching C++; (B) a real native re-init bug, checked
only if (A) is ruled out.

Hypothesis A was ruled out by reading `Inspector.js`'s embed-opening `useEffect` and
`StudioView.js`'s `openEmbeddedVstEditor`/`closeEmbeddedVstEditor`: the effect keys off the whole
`embeddedVstEditor` object and is guarded only on `!instanceId && !openingRef.current`, and
`openEmbeddedVstEditor` always constructs a fresh object (`instanceId: null`) after `await`-ing the
old instance's `close()` — so a reopen always re-triggers a real `openEmbedded()` call, not a
silent no-op.

Reproduced live via the same Electron-automation pattern used throughout this file (scan → click a
plugin → real desktop screenshot via PowerShell `CopyFromScreen`, never
`webContents.capturePage()`), across two separate scripted sessions, each starting from a fresh
`electron.exe` process (all prior instances killed first, so the freshly rebuilt addon from the
`IPlugFrame` fix was definitely what ran):

1. **Same-plugin close/reopen**: Dexed open → close → reopen (2 screenshots, both showed the real
   Dexed UI). Same cycle for RX 11 De-reverb (2 screenshots, both showed the real plugin UI —
   Reduction, Reverb Profile, Low/Low-mid/High sliders).
2. **Multi-plugin switching**: Dexed → RX 11 De-reverb → RX 11 Voice De-noise → back to RX 11
   De-reverb → back to Dexed, five screenshots, all five showed correct, distinct, real plugin UI
   (including both return visits to a previously-open plugin).

None of the 9 screenshots across both sessions showed a black surface. **This bug did not
reproduce** under either the literal "reopen the same plugin" reading or the more
realistic "click through several plugins, including revisiting one already seen" reading of the
user's report, after the `IPlugFrame` fix was in place.

What this does NOT rule out, since it wasn't tested: reopening after navigating away from the
Studio view entirely and back (a full Inspector/StudioView unmount+remount — the native instance
has no unmount-time close call anywhere in `Inspector.js`, so a real orphaned-window bug may exist
there, just not one that reads as "black" on the first reopen); a window minimize/restore or
monitor-change while a plugin is open (a known class of bug for reparented HWNDs under DWM, where
composited content needs an explicit repaint nudge after certain window-manager events); or a
race specific to human click timing much slower/faster than this script's fixed 1.5-3s waits. If
this recurs, the next report should note precisely what happened between "displays" and
"blacked out" — same plugin or a different one, whether the Studio view was left and re-entered,
and whether the window was resized/minimized in between — since none of the automated repros here
found it.

## Full RX 11 sweep after a real "Breath Control shows black" report — found a real, different bug (2026-09-25, later still)

The user then hit a black panel live, with a real desktop screenshot as proof: "RX 11 Breath
Control", opened the normal way (lane "⋯" menu → VST3 Plugins → click), showed solid black in
Studio's right panel. Unlike the "reopen" report above, this one had photographic evidence and a
plugin the two prior verification passes had never actually tested — the `IPlugFrame` fix was
checked against Dexed, RX 11 De-reverb, and RX 11 Voice De-noise only, 2 of the ~13 real RX 11
plugins. Breath Control was untested. Confirmed first that the currently-loaded addon still has
the `IPlugFrame` fix (`grep` for `MinimalPlugFrame`/`setFrame` in `addon.cpp`: 5 matches; binary
timestamp newer than source) — not a stale-build red herring.

**First pass — a full 13-plugin sweep, automated (scan → open each RX 11 plugin in turn → sample
pixels in the embed-surface rect via a disposable PowerShell `CopyFromScreen` capture → close →
next), scored "black" purely as "are >80% of sampled pixels near-RGB(0,0,0)":** all 13 plugins,
Breath Control included, scored as non-black (2262/2262 or close to it, max channel value 254-255
every time). This directly contradicted the user's screenshot — worth taking seriously rather than
declaring the bug fixed, since a crude black/not-black threshold is a weak proxy for "renders
correctly."

**Root cause of the contradiction, found by re-testing Breath Control alone with an actual saved
screenshot instead of a pixel-count summary:** the pixel-sampling sweep's "non-black" check is a
false-positive trap. Breath Control's embedded panel genuinely renders its top half correctly (RX
Breath Control header, Target level/Gain/Target/Sensitivity controls, Bypass button) — **but the
bottom ~55% of the panel, where a graph/meter widget presumably belongs, is a solid WHITE
rectangle**, not black. White pixels trivially pass an ">20 brightness" non-black test, so the
sweep scored this plugin as fine when it plainly isn't. The sweep's pass/fail signal was too weak
to be trusted on its own — real screenshots are the only reliable check, consistent with every
other lesson in this file.

Re-tested with an 8-second wait instead of 3 (in case it was a slow/lazy paint that just needed
more time): identical result, pixel-for-pixel look the same — a persistent rendering gap, not a
timing race.

**This still does not reproduce the user's exact report.** The user's screenshot showed the *entire*
panel solid black, including the header controls that render fine in every one of this session's
repro attempts (both the crude 13-plugin sweep and the careful single-plugin re-test). What was
found instead is a real but different defect: a specific sub-widget within Breath Control's GUI
(almost certainly a level/threshold graph, given the plugin's purpose) never paints, while the rest
of the same window renders correctly around it. Two real, unresolved possibilities, not
distinguished by anything tested here:
- The white sub-widget bug and the user's full-black report are the same underlying cause at
  different severity (e.g., something about the graph sub-view's own child-window/rendering-surface
  setup that, depending on timing or state, either fails to paint just itself or takes the whole
  parent window down with it).
- They are two unrelated bugs, and the exact fully-black state the user saw is still unreproduced.

**Not fixed in this pass** — this needs native-side investigation into what that specific graph/meter
region actually is (a nested child HWND created by the plugin itself inside the one this host
creates? a custom-drawn region needing a paint/invalidate nudge this host never sends?) before
attempting a real fix. Recommended next step if this recurs: ask the user precisely what they see
next time — is it ever partially rendered (header/controls visible, graph area blank) like this
session's repro, or truly 100% black including the header — since that distinguishes "same bug,
different severity" from "still-unreproduced separate bug."

No code changes in this pass (investigation and methodology-correction only). Cleaned up all
temporary scripts and screenshots afterward.

## Offline file rendering: a real WAV in, a real plugin, a real WAV out

Everything above processes one synthetic in-memory block and discards the result. This is the
first feature that does something with a real file — `renderAudioFile(pluginPath, inputWavPath,
outputWavPath)` reads a real WAV, negotiates the plugin at the **input file's own sample rate**
(not a hardcoded 44100 — a time-based effect like a delay is meaningless if the negotiated rate
doesn't match the file), runs every block through `process()` in sequence (handling a non-exact-
multiple-of-blockSize final block correctly), and writes a real 32-bit-float WAV back out.
**Explicitly offline/one-shot — not live playback routing.** Streaming a plugin's output into the
app's live Web Audio mix during playback is a separate, much larger real-time-systems project
(shared memory, a dedicated audio thread, sample-accurate sync) and was not attempted here.

Wrote a minimal RIFF/WAVE reader (16/24/32-bit PCM and 32-bit float in, decoded to float32) and
writer (always 32-bit float out) from scratch — no dependency pulled in for this.

**Verified with a test designed to be undeniable, not just "the numbers changed":** generated a
WAV that's 1 second of a real 440Hz tone followed by 2 seconds of pure digital silence, so a
passthrough has one unambiguous, precisely known shape: energy in `[0s, 1s)`, exactly zero energy
in `[1s, 3s)`. Rendered it through Steinberg's own `ADelay` (real measurable DSP, proven earlier
in this file, ~1 second default delay):

```
Independent JS-side reader, checking RMS per second-long window (NOT the addon's own self-reported
whole-file stats, which are aggregate and time-blind — a delayed signal has the same total RMS as
the dry one, so that number alone would have proven nothing):

  input:  rms[0s,1s)=0.3535  rms[1s,3s)=0.0000   (tone, then silence — as generated)
  output: rms[0s,1s)=0.0000  rms[1s,2s)=0.3535   rms[2s,3s)=0.0000   (silence, THEN the tone)
```

The tone moved from where it started to exactly where a ~1-second delay would put it, and the
region where the dry signal *was* is now silent. There is no passthrough, scaling bug, or
coincidence that produces this specific shape — only real time-based DSP does. This is stronger
evidence than the single-512-sample-block test from earlier in this file could ever provide (that
test's block was too short for a 1-second delay to show any output at all).

**Also rendered the same file through a real iZotope RX 11 plugin (De-hum)**, to check whether the
earlier single-block bypass finding still holds across a full multi-second offline render:

```
setProcessingResult: kNotImplemented (0x80004001) — consistent with every earlier iZotope result
Independent JS check: rms[0s,1s)=0.3535, rms[1s,3s)=0.0000 — IDENTICAL shape to the raw input
maxAbsDiffFromInputSampleWise (whole file, sample-by-sample, computed independently in JS): 0
```

Bit-for-bit identical to the input, confirmed independently outside the addon's own self-reported
stats. This reconfirms — now at full-file scale, not just one 512-sample block — that this
specific plugin performs zero real processing through this host, consistent with the earlier
per-block bypass-toggle finding, not a new or different result.

Re-ran the ADelay render twice in the same Node process (fresh `renderAudioFile` call each time,
same input, different output paths): identical stats both times, no crash — same repeat-use rigor
as every other function in this file.

**IPC contract** (`native/shell/src/main.js` + `src/preload.js`, same pattern as `scan`/`open`/
`close`):

```js
window.rhymixNative.vst3.renderFile(pluginPath: string, inputWavPath: string, outputWavPath: string)
  -> Promise<{
       success: boolean, outputPath: string, durationSec: number, sampleRate: number, channels: number,
       setProcessingResult: number,  // raw VST3 tresult; kNotImplemented is possible and non-fatal, see above
       inputStats:  { min, max, rms, allFinite, sampleCount },
       outputStats: { min, max, rms, allFinite, sampleCount },
     }>
```

Verified end to end from inside a real launched Electron renderer via `executeJavaScript` (not
just calling the addon directly from a bare Node script) — `window.rhymixNative.vst3.renderFile(...)`
resolved with the same real stats as the direct-addon test.

**What this doesn't cover yet**: channel-count mismatches between the input file and the plugin's
negotiated bus (mono file into a stereo-only plugin, or vice versa) are handled with a simple
duplicate/average adaptation, not a real mixer — fine for this proof, not a production channel-
mapping story. No Studio UI calls this yet (same as the stateful API above) — `frontend/src/studio/`
was not touched; this is the real, verified contract for whoever builds "render this clip through
this plugin" next.

## RX 11: testing a DRM/host-allowlisting theory (2026-09-25)

Gaël proposed a specific alternative theory for the RX 11 silent-bypass finding above: rather than
(or in addition to) the "routes through iZotope's own RX application" theory, the plugin might be
checking `IHostApplication::getName()` against a commercial-DAW allowlist and silently forcing
bypass (an anti-automation/licensing mechanism) when it doesn't recognize the host, possibly
combined with requiring a non-null `ProcessContext`. Full writeup, numbers, and the two additional
discoveries this testing turned up: `docs/RX11_VST3_INVESTIGATION.md`, §7. Short version:

- **Host-identity spoofing** (`"REAPER"`, `"Cubase"`, `"Pro Tools"` in place of the SDK's default
  `"My VST3 HostApplication"`) — no effect on RX 11 De-hum in any combination tested.
- **A real `ProcessContext`** (`kPlaying`/`kTempoValid`/`kTimeSigValid`, 120bpm, 4/4) instead of a
  bare sample rate — no effect on RX 11 either, alone or combined with host spoofing.
- Opening RX 11 De-hum's own GUI explains its non-functioning directly: it requires an explicit
  "Learn" step before it has a noise profile, which this host never triggers — not DRM.
- RX 11 De-click's GUI looks completely normal (no error, live "0 clicks repaired" counter) yet
  still doesn't process audio even with a real click artifact injected into the test signal — this
  rules out "unsuitable test signal" as the explanation, and the true cause for this plugin (and
  De-crackle/De-clip/De-plosive, tested the same way) remains unresolved.
- **RX 11 Voice De-noise processes audio for real** (`maxAbsDiffBetweenRuns: 0.3735`, reproducible,
  cross-validated against the original `processParamDiffTest`) — so "RX 11 silently bypasses
  everything" is not an accurate blanket statement; it's plugin-specific.

Net effect on the shipped code: `renderAudioFile()`'s `ProcessContext` now reports a real
playing/120bpm/4-4 transport state with `projectTimeSamples` tracked per block, instead of a
zero-initialized `state` with only `sampleRate` set. This didn't change RX 11's behavior, but it
closes a real correctness gap (a host silently reporting "not playing, no tempo, no time
signature" to every plugin regardless of what the actual project state is) that could matter for
some future plugin that gates tempo-synced behavior on those validity flags. Regression-tested
against ADelay: identical delay-shape output to every prior pass. The host-identity spoofing code
(`SpoofedHostApplication`, `processDrmTheoryTest`) is diagnostic-only — not exported through
`native/shell`'s IPC layer, not part of `window.rhymixNative`, and must not be treated as a
permanent host identity.

## RX 11: latency accounting + De-hum's Learn workflow — most of the suite reclassified as working (2026-09-25, later)

Gaël's follow-up diagnosis on the still-unresolved De-click/De-crackle/De-clip/De-plosive group
and on De-hum: the earlier bypass-toggle test only ran one 512-sample block per state, which is too
short to reveal processing in plugins with real internal lookahead latency, and De-hum's own GUI
literally instructs the user to click "Learn" before it has anything to reduce — neither of which
the test harness accounted for. Full numbers and the 17-plugin table: `docs/RX11_VST3_INVESTIGATION.md`,
§9. Short version:

- **`IAudioProcessor::getLatencySamples()` is now read and respected.** It was never called
  anywhere in this host before. Values for the RX 11 suite range up to ~29,445 samples (670ms at
  44.1kHz) for De-click. A new diagnostic test (`processLatencyAwareDiffTest`) scales the run
  length to `latencySamples * 2 + 4096`, feeds real impulsive content every block, and compares
  bypass-on vs. bypass-off **only past the reported latency offset**. Kept as a permanent,
  general-purpose host improvement independent of the RX 11 outcome — any real host should read
  this API.
- Doing that reclassifies **De-click, De-clip, and De-crackle from "unexplained silent bypass" to
  "confirmed real processing"** (`maxAbsDiffPastLatency` of 1.28, 1.28, and 1.21 respectively — far
  above noise floor). De-plosive also now shows a real, if weaker, non-zero difference (0.0059).
  10 of the 17 plugins are now confirmed genuinely processing audio through this host.
- **De-hum's "Learn" control is a plain VST3 parameter** (`"Enable learning"`, id 0 of 33), found
  by dumping its full parameter list with a new diagnostic export (`listPluginParams`) — which
  itself required fixing a real bug: without the same Controller/`IConnectionPoint` bridge +
  `setComponentState` sync every other test here already does, `getParameterCount()` silently
  returned 0 even though the plugin has 33 real parameters. Driving `"Enable learning"` through the
  same `IParameterChanges` automation path used elsewhere (1→0 after ~2.3s of real hummy test
  content, then comparing RMS before/after a subsequent bypass toggle) produces a reproducible
  ~40x RMS reduction (0.250 → 0.006). De-hum was never broken or blocked — it just needs the same
  one-time activation step its own GUI already asks a human for.
- Three plugins (Breath Control, Dialogue Isolate, Guitar De-noise) still show a flat zero
  difference even past their reported latency, and remain genuinely unexplained. Connect, Monitor,
  and Spectral Editor have no automatable/bypass parameter at all — consistent with being
  utility/companion tools, not insert effects, so "no diff" there isn't a failure. Repair Assistant
  is ambiguous (a nonzero diff appears only *before* the latency offset, not past it) and wasn't
  chased further.

Net effect on the shipped code: none yet — `processLatencyAwareDiffTest`, `listPluginParams`, and
`processDehumLearnTest` are diagnostic-only additions (same pattern as `processDrmTheoryTest`), not
wired through `native/shell`'s IPC layer or `window.rhymixNative`. `getLatencySamples()` being read
correctly is the one finding worth carrying into the real `renderAudioFile()`/`openPluginEditor()`
paths eventually (trimming the reported latency's worth of leading silence from a rendered file,
the way a real DAW would), not yet done here since this pass was diagnostic.

## RX 11: the last 4 — 3 more reclassified, Guitar De-noise still unexplained (2026-09-25, continued)

Direct continuation of the previous section: generalized De-hum's Learn-toggle test into
`processLearnLikeToggleTest(path, signalKind[, explicitParamId, explicitParamValue[,
explicitBypassId[, secondaryParamId, secondaryParamValue]]])` — same continuous-stream,
latency-settle-aware, bypass-vs-active RMS comparison, but searching for a Learn-like boolean
parameter first and falling back to an Amount/Strength/Sensitivity knob (auto-detected or
explicitly overridden) otherwise — and ran it against the 4 plugins still unexplained after
latency accounting: Breath Control, Dialogue Isolate, Guitar De-noise, Repair Assistant. Full
numbers: `docs/RX11_VST3_INVESTIGATION.md`, §10. Short version:

- **Breath Control**: the auto-detected `Sensitivity` parameter pushed to 0.9 was already the
  right knob — `rmsDelta: 0.0094`, confirmed working on the first attempt. It only read as
  "unexplained" before because the generic per-plugin test signal used at that point didn't
  happen to trigger it.
- **Dialogue Isolate**: the auto-search picked the wrong parameter (`Sensitivity`, `rmsDelta`
  effectively 0). Its real gate is `Noise Gain` (id 2, default 0.833 ≈ "mostly transparent"), found
  via `listPluginParams()`. Pushed to `0.0`: `rmsDelta: 0.1080`. **Confirmed working.**
- **Repair Assistant**: the auto-search picked `De-clip threshold` (an inactive-by-default
  sub-module). Its real gate is `De-noise amount` (id 9, default 0 ≈ "off"). Pushed to `0.9`:
  `rmsDelta: 0.1077` — same magnitude as Dialogue Isolate. **Confirmed working.**
- **Guitar De-noise**: still unexplained. Two structurally different targeted attempts — pushing
  the AMP sub-module's `Sensitivity`, and separately its `Resolution`, each combined with
  explicitly flipping `AMP: Bypass` from its default (disabled) to enabled — produced **bit-for-bit
  identical output** to each other and to the original auto-detected-parameter attempt
  (`activeRms: 0.17807775898862785`, `rmsDelta: 0.0000142`, exactly, all three runs). That specific
  signature suggests either the AMP module's parameter writes aren't reaching its actual DSP state
  through this host, or it needs its own noise-print/Learn step not yet found.

Net effect on the shipped code: none yet — `processLearnLikeToggleTest` is diagnostic-only (same
pattern as `processDrmTheoryTest`/`processLatencyAwareDiffTest`), not wired through `native/
shell`'s IPC layer or `window.rhymixNative`. Updated overall RX 11 tally: **13 of 17 plugins now
confirmed genuinely processing real audio** through this host; 3 are out-of-scope utility tools;
only Guitar De-noise remains genuinely unexplained.

## Embedded editor black panel, take 3: the real cause was GPU compositing, not IPlugFrame (2026-09-25, later still)

The `IPlugFrame` fix above (commit `c55bcbd`) and the follow-up reopen/pixel-sweep investigations
that "confirmed" it working were all run through disposable Electron verification scripts that,
it turns out, **every single one** launched with `--disable-gpu` on the command line — inherited
from the very first embedding test in this whole thread and never questioned since. The user's
real launch path, `./node_modules/.bin/electron .` from `native/shell`, has never once passed
that flag. Once this was noticed (by comparing the exact same repro script run with vs. without
`--disable-gpu`), the actual cause became obvious: this is the classic "airspace problem" of
embedding a native GPU-rendering `WS_CHILD` window inside a Chromium window tree that itself
composities via GPU (DirectComposition on Windows) — the child's content plain never makes it
into the composited surface, full stop, regardless of `IPlugFrame`. The `IPlugFrame` fix was real
and worth keeping (it's a legitimate hosting-contract gap), but it was never the reason for the
black panel the user actually experienced session after session.

**Confirmed with real desktop screenshots** (same `verify_dcomp_tmp.js` throwaway script,
`app://rhymix/next#studio?...` → open lane menu → Rescan → click plugin → screenshot), run
strictly as `./node_modules/.bin/electron .`/`electron verify_dcomp_tmp.js` with **no CLI flags**
— i.e. the user's actual launch path, not the flag-decorated one every earlier pass used:

- Before any fix: RX 11 Breath Control — solid black panel, header included. Matches the user's
  screenshot exactly.
- Tried first (narrower, hoping to keep most GPU acceleration): `app.commandLine.appendSwitch
  ("disable-features", "DirectComposition")` added at the top of `native/shell/src/main.js`,
  before `app.whenReady()`. Retested identically — **still solid black**. This specific feature
  flag isn't what's needed; the conflict isn't scoped to just that one Chromium feature.
- Fallback that worked: `app.disableHardwareAcceleration()`, same place in `main.js` (replacing
  the `disable-features` attempt, not stacked with it). This is the same effect as `--disable-gpu`
  on the command line, but baked into the app itself — in effect on the exact `electron .` launch
  the user runs, no flag required. Retested: RX 11 Breath Control's header and sliders (Target
  level, Gain, Sensitivity, Bypass) now render correctly. RX 11 De-reverb: fully correct (header
  toolbar icons, Reduction, Reverb Profile Low/Low-mid/High sliders, Bypass). Dexed: still fully
  correct, no regression (full 6-operator FM interface, "dexed" logo).
- General Studio UI (lanes, clip waveforms, panels) visually unchanged with hardware acceleration
  disabled — no obvious rendering regression from giving it up, at least for this app's fairly
  flat 2D UI.

**Known remaining issue, unrelated to this fix**: RX 11 Breath Control's lower graphing widget
(under the Gain/Target/Sensitivity sliders) still renders as a solid white rectangle instead of
its meter/curve content, both with `--disable-gpu` and with `disableHardwareAcceleration()`. This
was already noted as a separate, still-unexplained bug in the black-panel investigation two
sections up (a pixel-sweep false positive there mistook "solid white" for "not black, therefore
OK"). Not investigated further in this pass — scope here was strictly the GPU-compositing/black-
panel bug, not this second, narrower rendering gap.

**Methodological note for next time**: any throwaway Electron verification script written for
future native-window/embedding work in this project should be launched with the *exact* same
command line the real app uses (`electron .`, no flags) unless the test is specifically about
flag behavior — `--disable-gpu`/`--no-sandbox` convenience flags added to make automation easier
can silently mask real rendering bugs, which is exactly what happened across several verification
passes here.

## Fixed-size plugin GUIs left dead/clipped space when forced to the placeholder's rect (2026-09-25, later still)

The GPU-compositing fix above resolved the fully-black-panel bug, but the user's very next report
— "plugins tend to not be very responsive/fit well into the side panel" — turned out (after an
initial wrong turn chasing input latency, see below) to be about layout, not responsiveness: RX 11
Breath Control's lower ~55% rendering solid white (documented in the sweep above) was never a
paint failure. It's a fixed-size GUI being forced into a rect bigger than its real content.

**A wrong turn first, reported honestly**: the coordinator's initial framing of "not very
responsive" was read as input latency, and diagnostic instrumentation (per-message dispatch-gap
logging in `RunPluginWindow`'s message loop, comparing embedded vs. standalone) was added and the
addon rebuilt once before the coordinator corrected the actual complaint (visual fit, not click
latency). The instrumentation was reverted before investigating the real issue — `git diff` on
`addon.cpp` was empty at that point, confirming no trace of it remained. No responsiveness-specific
change (GPU flag swaps, `SetFocus`, `ResizeObserver` throttling) was ever applied or committed.

**Root cause**: `RunPluginWindow()`'s embedded path always called
`view->onSize(&embeddedRect)` with `embeddedRect` set to the *placeholder's* size
(`inst->initialWidth/Height`, from `.studio-vst-embed-surface`'s CSS — `width:100%`,
`height:480px`), regardless of whether the plugin's own GUI actually supports being resized to
that rect. `IPlugView::canResize()` was never checked. A plugin with a fixed-size GUI (confirmed:
both RX 11 Breath Control and, surprisingly, Dexed as well — its `canResize()` also reports false)
just keeps painting at its own native size no matter what `onSize()` claims the client area is;
the rest of the `WS_CHILD` window (forced to the placeholder's larger or smaller size regardless)
is left as dead space filled by the window class's default background brush
(`COLOR_WINDOW + 1`, i.e. white) — exactly the white rectangle found in the earlier sweep, and
for Dexed specifically, the placeholder being *shorter* than its native size meant the bottom of
its GUI (the on-screen piano keyboard, CART/PARM/INIT/STORE row) was silently clipped off, not
just padded.

**Fix**: `native/engine/vst3_host/src/addon.cpp` — `RunPluginWindow()` now calls
`view->canResize()` before sizing an embedded editor. If resizable, behavior is unchanged (forced
to the placeholder's rect). If not, it sizes the `WS_CHILD` to the plugin's own real size via
`view->getSize()` instead, and the applied width/height is threaded back through
`PluginInstance::resizable/reportedWidth/reportedHeight` → `OpenPluginEditorEmbeddedWorker::OnOK()`
→ the `openEmbedded()` promise's resolved value (`{instanceId, resizable, width, height}`, new
fields). `WM_APP_REPOSITION` handling was updated the same way: a non-resizable plugin is now just
re-centered within whatever rect the placeholder occupies at its unchanged native size, never
re-stretched.

`frontend/src/studio/components/Inspector.js` — the `openEmbedded()` `.then()` handler now reads
`result.resizable`/`width`/`height`: for a fixed-size plugin, it sets the placeholder's `width`/
`height`/`alignSelf` inline styles to match (clearing them first, so a later resizable plugin
doesn't inherit stale sizing from a previous fixed-size one). The existing `ResizeObserver` picks
up this style change automatically and re-sends a (now-matching) `reposition`, which the native
side just centers rather than re-stretching — no new wiring needed there.

**Verified** with real desktop screenshots, launched via the exact real launch path (`electron .`
via a script that `require()`s `main.js` directly, no CLI flags):
- RX 11 Breath Control: placeholder now sized to 450×280 (the plugin's real reported size, down
  from the old fixed 332×480) — full GUI visible (header, Gain/Target sliders, Sensitivity,
  "Output breaths only", Bypass), no white space anywhere.
- Dexed: placeholder now sized to 866×674 (up from 480px tall) — the full 6-operator FM UI
  including the previously-clipped bottom row (CART/PARM/INIT/STORE, preset selector, on-screen
  keyboard) is now entirely visible.
- Frontend build (`CI=true npx --no-install react-scripts build`) and studio test suite
  (`CI=true npx --no-install react-scripts test src/studio --watchAll=false`, 165/165) both pass.

Temporary verification scripts and screenshots cleaned up; nothing left behind under
`native/shell/`.

## How it's built

- `CMakeLists.txt` sources Steinberg's own CMake modules from the vendored SDK
  (`native/engine/third_party/vst3sdk/cmake/modules/SMTG_VST3_SDK.cmake`) and calls their
  `smtg_create_*_target()` functions directly — reusing Steinberg's own source-file lists for
  `base`, `pluginterfaces`, `sdk_common`, and `sdk_hosting` rather than hand-copying them (they
  change between SDK versions; this way stays correct automatically).
- Deliberately does **not** `add_subdirectory()` the SDK root, which would also configure every
  hosting/plugin sample (editorhost, audiohost, the full plugin-examples tree, VSTGUI) this addon
  has no use for — only the four library targets it actually needs.
- `src/addon.cpp` is a thin N-API wrapper (`node-addon-api`) around `Module::create()` +
  `PluginFactory` metadata queries, plus `processAudioTest()`'s full component/processor
  lifecycle (see above).
- Build: `npm install && npm run build` (wraps
  `cmake-js compile --runtime=electron --runtime-version=33.4.11 --arch=x64` — update the version
  string if `native/shell`'s Electron gets bumped). Requires the VST3 SDK fetched first, see
  `native/engine/third_party/README.md`.

## What's not here (real scope limits, not oversights)

- **Real DSP specifically from the iZotope RX 11 suite (the only commercial suite installed on
  this machine) — confirmed NOT occurring.** `process()` runs without error against it, but
  toggling each plugin's own bypass parameter on/off changes nothing about the output
  (`maxAbsDiffBetweenRuns: 0`, two plugins tested) — this is a real, decisive negative result, not
  an open question. Real DSP **is** proven working, independently, against both Steinberg's own
  `ADelay` example AND a real third-party plugin from an unrelated vendor (Dexed, JUCE-built) —
  see "Audio processing: a real independent third-party plugin (Dexed)" above. Still untested:
  a commercial *effect* (not instrument) from a vendor other than Steinberg/iZotope — Dexed closes
  the "is this host broken for non-Steinberg plugins generally" question for instruments, but a
  third-party effect plugin specifically hasn't been tried (none was available on this machine;
  would need another download).
- **GUI embedding beyond a standalone window.** A plugin's own editor renders correctly (proven
  against Dexed — see above), but only in a plain top-level window this host creates, not embedded
  into anything resembling the Rhymix shell's own UI, and with no interaction (mouse/keyboard)
  sent to it — attach-and-paint only.
- **Parameter automation from the host side** — a person can turn a plugin's own knobs by hand in
  its open editor window, but nothing here lets Rhymix itself read/write/automate a parameter
  value programmatically. Preset save/load: also not exposed. Non-default bus arrangements: only
  ever requests plain mono or stereo matching the plugin's own reported default.
- **Live/streaming real-time processing still doesn't exist.** `renderAudioFile()` (see above) is
  a real step beyond the single-block test functions — it processes a whole file's worth of
  blocks in a loop — but it's still an offline, one-shot, start-to-finish batch job, not a running
  audio engine. `openPluginEditor` hosts a live GUI and message loop, but does not run
  `IAudioProcessor::process()` at all — no audio flows through an open editor instance, and
  nothing here streams a plugin's output into Rhymix's live Web Audio mix during playback (that
  remains the separate, larger, genuinely unattempted real-time-systems project mentioned
  throughout this file).
- **`scanPlugins` is recursive**, not one level deep — it walks subdirectories (`std::filesystem::
  recursive_directory_iterator`), which is what real Windows VST3 installs need: plugins live
  under a per-vendor subfolder (`Common Files\VST3\<Vendor>\*.vst3`), not directly in the root
  `VST3` folder — an earlier version of this doc said "one level deep" before that fix landed
  (the frontend UI work in commit 09a3de4 hit exactly this: scanning the plain root directory
  found zero plugins with the old flat iterator, 17 with the recursive one).
- **No crash isolation.** A plugin that crashes during load, processing, or while its editor is
  open currently takes this whole process down with it — real hosts run plugins out-of-process
  specifically to survive this; not addressed here.
- **Not wired into Rhymix's actual Studio UI.** The Electron IPC bridge
  (`window.rhymixNative.vst3.{scan,open,close}`) is real and verified end to end, but no UI in
  `frontend/src/studio/` calls it yet — that's the next, separate piece of work.
- **AU and CLAP hosting** — out of scope for this pass entirely, per the phased plan in
  `docs/NATIVE_SHELL_PLAN.md` (VST3 first).

## Repo-size note

The vendored VST3 SDK checkout is ~170MB (measured via PowerShell `Get-ChildItem -Recurse`,
mostly VSTGUI's asset tree) — gitignored, not committed; see
`native/engine/third_party/README.md` for the fetch command. `node_modules/` here (cmake-js +
node-addon-api) and `build/` are also gitignored.
