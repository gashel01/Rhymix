# iZotope RX 11 VST3 hosting — investigation report

**Status: unresolved, root cause narrowed to a specific, testable hypothesis.**
**Date:** 2026-09-25
**Scope:** why the 17 iZotope RX 11 plugins load correctly in Rhymix's native VST3 host
(`native/engine/vst3_host/`) but never actually process audio, and what's worth trying next.

This document exists so Gaël can search externally for "what does it take to make RX 11 actually
process audio through a minimal/custom VST3 host" without having to reconstruct the whole
investigation from git history first.

---

## 1. What works (the host is not the problem)

Before touching RX 11 at all, the host itself was proven correct against two independent,
unrelated plugins:

| Plugin | Vendor | What it proved |
|---|---|---|
| **ADelay** | Steinberg (SDK's own example) | Independently validated by Steinberg's own `validator` tool (**57/57 tests passed**) before use. Rendered a 1s-tone + 2s-silence test file through it — output came back **silence, then the tone, delayed by ~1s** (`rms[0-1s)=0`, `rms[1-2s)=0.3535`, `rms[2-3s)=0`), exactly the shape a delay produces. Decisive, unambiguous evidence of real time-domain DSP. |
| **Dexed** | Digital Suburban (real third-party, JUCE-based) | An **instrument**, not an effect — fed a MIDI note-on with *zero* audio input, and got back a real, finite, non-zero output with a physically plausible attack→decay envelope (`RMS 0.0098 → 0.0865 → ... → 0.0678` across 12 consecutive blocks). Also: its real GUI was embedded in a native window and screenshotted — visually confirmed the actual Dexed interface (FM operator panels, keyboard, "dexed" logo), not a blank/garbage window. |

So: plugin loading, metadata query, bus negotiation, `setupProcessing`, activation, block-by-block
`process()` calls, WAV file I/O, and GUI window embedding are all **proven working**, against two
plugins from two completely different codebases (Steinberg's own SDK, and an independent
JUCE-based synth). Whatever is wrong with RX 11 is not a generic bug in the host.

---

## 2. What doesn't work: RX 11 specifically

All 17 plugins tested, from `C:\Program Files\Common Files\VST3\iZotope\`:

```
RX 11 Breath Control, RX 11 Connect, RX 11 De-click, RX 11 De-clip, RX 11 De-crackle,
RX 11 De-ess, RX 11 De-hum, RX 11 De-plosive, RX 11 De-reverb, RX 11 Dialogue Isolate,
RX 11 Guitar De-noise, RX 11 Monitor, RX 11 Mouth De-click, RX 11 Repair Assistant,
RX 11 Spectral De-noise, RX 11 Spectral Editor, RX 11 Voice De-noise
```

### 2.1 The lifecycle sequence, step by step

| Step | Result against RX 11 |
|---|---|
| `Module::create()` (load the plugin) | ✅ succeeds |
| Factory info / class info (name, vendor, category) | ✅ correct real metadata every time |
| `setBusArrangements()` | ✅ `kResultOk` |
| `setupProcessing()` | ✅ `kResultOk` |
| `activateBus()` (input + output) | ✅ `kResultOk` |
| `IComponent::setActive(true)` | ✅ `kResultOk` |
| **`IAudioProcessor::setProcessing(true)`** | ❌ **`kNotImplemented` (0x80004001)**, on all 17 plugins, every time |

### 2.2 That specific failure is a documented, known issue — not unique to us

Found via web search: a Steinberg developer forum thread describing **the exact same symptom**,
naming **iZotope plugins specifically**:

> ["IAudioProcessor::setProcessing fails in many plugins" — Steinberg Forums](https://forums.steinberg.net/t/iaudioprocessor-setprocessing-fails-in-many-plugins/785558)

Key quotes from that thread: a custom-host developer reports `setProcessing(true)` returning
failure "with many others (such as Oril River and **most of the iZotope plugins**)" while those
same plugins work fine in commercial DAWs. Consensus from experienced VST3 host developers there:
**treat this as non-fatal** — a host is technically permitted to see `kNotImplemented` here and
should proceed to call `process()` anyway, same as real DAWs apparently do.

### 2.3 We implemented that fix — process() then "succeeds", but does nothing

After changing the host to ignore a failed `setProcessing()` and call `process()` regardless:

- `process()` itself now returns `kResultOk`.
- The output buffer is well-formed: correct channel count, correct sample count, all finite
  values (no NaN/garbage).
- **But the actual audio content is unchanged.**

### 2.4 Decisive test: toggling the plugin's own bypass parameter proves it's not processing

The single most important test in this investigation. Rather than trust the buffer "looking
reasonable," we sent the plugin's own real, spec-defined **`kIsBypass`** parameter through a
proper `IParameterChanges` queue on `ProcessData::inputParameterChanges` — the same mechanism any
real DAW uses for automation — toggling it between `0.0` (bypass off / plugin active) and `1.0`
(bypass on) while processing the **exact same input buffer** both times.

```
RX 11 De-hum   : maxAbsDiffBetweenRuns = 0  (bit-identical output, bypassed or not)
RX 11 De-click : maxAbsDiffBetweenRuns = 0  (bit-identical output, bypassed or not)
```

Repeated at full-file scale (a real multi-second WAV, not a single 512-sample block):

```
maxAbsDiffFromInputSampleWise = 0   (output is bit-for-bit identical to the input)
```

If the plugin's *own* bypass switch makes zero difference to the output, the plugin is not doing
any real signal processing through this host at all — it's not "correctly leaving clean audio
alone," it's not participating in the process chain in any observable way. This isn't ambiguous
the way an earlier single-block silent-tone test was (see §4) — it's conclusive.

---

## 3. What we ruled out (with direct evidence, not assumption)

| Hypothesis | How it was tested | Result |
|---|---|---|
| Wrong/unsupported bus arrangement | Explicitly queried the plugin's own reported bus config and called `setBusArrangements()` to match it exactly | No change — bus negotiation itself returns `kResultOk` |
| Missing separate Controller (EditController) connection | Implemented the full VST3 "distributable" architecture bridge: found the plugin's separate Controller class via `getControllerClassId()`, instantiated it separately, connected both directions via `IConnectionPoint`, synced state via `getState()`/`setComponentState()` | Bridge connects successfully (`controllerConnected: true`, `controllerStateSynced: true`) — **`setProcessing` still fails identically afterward.** This specifically rules out "the host never established a proper Controller relationship" as the cause. |
| Test signal was just "nothing to fix" (false negative) | Bypass-parameter toggle test (§2.4) | Ruled out — bypass on vs. off produces identical output, which a genuinely-processing plugin cannot do |
| Host-level crash/instability under repeated use | Ran the full open→process→close lifecycle twice in the same process, multiple passes | No crashes, no leaks, consistent identical (negative) results each time |

---

## 4. What we have NOT tried — the actual research question

### 4.1 Leading hypothesis: RX Connect / standalone RX Application architecture

**This is the most promising lead and wasn't investigated further in this session.**

iZotope's RX product line has a well-known architecture where the individual restoration
"modules" (De-hum, De-click, De-reverb, etc.) are not always fully self-contained DSP plugins.
iZotope ships a specific plugin called **"RX Connect"** — which is literally one of the 17
plugins found in the scan (`RX 11 Connect`) — whose entire purpose, per iZotope's own product
design, is to **send audio out of the host to the standalone RX Application** for processing and
receive it back, rather than the plugin doing the DSP work inline inside its own
`IAudioProcessor::process()` call.

If the individual RX 11 module plugins (De-hum, De-click, etc.) rely on the same underlying
mechanism — needing either the standalone **iZotope RX 11 Audio Editor** application running in
the background, or specifically routing through **RX Connect** rather than instantiating a module
plugin directly — that would fully explain every symptom observed:
- Why `setProcessing`/`process()` don't behave like a normal self-contained plugin.
- Why toggling bypass makes no difference (there's no local DSP engine to bypass).
- Why this is specific to the RX 11 *suite* and not VST3 hosting in general.

**What to search for / try:**
- Whether the standalone **iZotope RX 11 Audio Editor** (or "RX 11 Standalone") needs to be
  installed and/or running for the individual module plugins to do anything when hosted.
- iZotope's own documentation/support articles on "RX Connect" and how the individual RX modules
  relate to it — whether De-hum etc. are meant to be used directly as effects at all, or whether
  they're designed to be reached through RX Connect + the main RX app as the real processing
  engine.
- Whether there's an iZotope product activation/login requirement (an iLok-style auth gate) that
  a minimal host doesn't trigger, causing silent degrade-to-bypass rather than a visible error.

### 4.2 Host identity / allowlisting

Some plugin vendors read the host's `IHostApplication::getName()` string and change behavior
based on recognizing (or not recognizing) a known DAW. Not tested: what host name string our
addon currently reports, and whether iZotope's plugins behave differently when the reported host
name matches a known commercial DAW (Cubase, Reaper, Ableton Live, etc.) versus an unrecognized
custom string.

### 4.3 The actual ground-truth test: does a real DAW on this same machine process RX 11 correctly?

Not done in this session, and the single most informative thing to try: install a cheap/free-trial
real DAW (e.g. **REAPER**, which has a full-featured unlimited trial and is commonly used exactly
for this kind of "does my plugin actually work at all" sanity check) on this same Windows machine,
load one of the same RX 11 plugins, and confirm it genuinely processes audio there. If it does —
the difference between REAPER's host implementation and ours is the real thing to go find and
close. If RX 11 *also* doesn't process without the standalone RX app running even inside REAPER,
that would strongly confirm the RX Connect hypothesis (§4.1) and mean this isn't a "make our host
better" problem at all — it would mean these specific plugins fundamentally aren't meant to be
used as ordinary standalone VST3 effects.

### 4.4 GUI embedding was never attempted on an RX 11 plugin

All GUI embedding work (native window creation, `IPlugView` attach, screenshot verification) was
done against Dexed only. Worth checking whether an RX 11 plugin's own editor even renders through
our host at all, or whether it shows some kind of "please open RX Connect" / license / "no
connection to RX" message in its own UI — which would be a direct, visible confirmation of §4.1
if it does.

---

## 5. Summary for external research

**The question to search for:** *"iZotope RX plugins VST3 host setProcessing not working"* /
*"RX Connect standalone requirement"* / *"iZotope RX plugin architecture standalone vs VST3"*.

**What's confirmed:**
- Our host correctly implements the VST3 processing lifecycle (proven against 2 independent,
  unrelated real plugins).
- RX 11's `setProcessing()` failure specifically matches a documented Steinberg forum report
  naming iZotope plugins as a known-problematic case.
- Even working around that (treating it as non-fatal, the community-recommended fix), no actual
  audio processing happens — confirmed decisively via the plugin's own bypass parameter making no
  difference to output.
- The Controller/IConnectionPoint bridge (the standard "second most common VST3 hosting mistake")
  was implemented correctly and ruled out as the cause.

**What's not yet known:** whether this is fixable at all from the *hosting* side, or whether RX 11's
individual module plugins architecturally require the standalone RX Application / RX Connect to
do any real work — in which case the fix isn't "host it better," it's "run the RX app alongside
it" or "this plugin family isn't a fit for a minimal embedded host, full stop."

---

## 7. Addendum, 2026-09-25: Gaël's DRM/host-allowlisting theory — tested, and two real discoveries

Gaël proposed a specific, well-reasoned alternative theory after reading the report above: rather
than (or in addition to) needing the standalone RX Application, the silent bypass could be a
**commercial DRM / host-allowlisting mechanism** — the plugin checking `IHostApplication::getName()`
against a list of recognized commercial DAWs and silently forcing bypass (rather than erroring) if
the host isn't recognized, possibly combined with a required-but-missing `ProcessContext`
(transport/tempo/playing-state). Three tests were run against this, in the priority order he gave.

### 7.1 Test 1 — open an RX 11 plugin's own GUI and read what it says

Reused the exact proven GUI-embedding code (native window, `IPlugView::attached()`, desktop-DC
screenshot) from the Dexed pass, pointed at real RX 11 plugins. **This produced the single most
informative result of the whole investigation:**

**RX 11 De-hum's actual GUI, screenshotted:**

> *"Click Learn to begin listening to the audio for hum"*

De-hum requires an explicit **"Learn" step** — a profiling action, presumably triggered by a GUI
button click that sends a message/command the host never simulates — before it has any noise
profile to act on. Without it, the plugin correctly does nothing. This is a **real, intentional
product design**, not DRM and not (directly) the RX Connect dependency from §4.1.

**RX 11 De-click's actual GUI, screenshotted:** a fully normal-looking, ready-to-use interface
(Algorithm, Sensitivity, Frequency skew, Click widening controls) with a live **"0 clicks
repaired"** counter — no error, no license message, no "Learn" gate. This initially looked like it
might explain the earlier §2.4 "zero difference" result as a **false negative from an unsuitable
test signal** (a clean 440Hz tone genuinely has no clicks for a click-detector to find) rather than
real non-functioning — see §7.4 for why that specific explanation was then ruled out too.

### 7.2 Test 2 — spoof the host identity

Added a `SpoofedHostApplication` subclass (diagnostic-only, not wired into the shipped hosting
path — see the comment above its definition in `addon.cpp`) reporting a caller-chosen name instead
of the SDK example's real default, which turned out to be the literal string **`"My VST3
HostApplication"`** (from `hostclasses.cpp`) — about as obviously-not-a-real-DAW as a string can
get, making this a genuinely worthwhile thing to test.

Re-ran the decisive bypass-toggle test against RX 11 De-hum under `"My VST3 HostApplication"`
(baseline), `"REAPER"`, `"Cubase"`, and `"Pro Tools"`:

```
My VST3 HostApplication : setProcessingResult=kNotImplemented | maxAbsDiffBetweenRuns=0
REAPER                   : setProcessingResult=kNotImplemented | maxAbsDiffBetweenRuns=0
Cubase                   : setProcessingResult=kNotImplemented | maxAbsDiffBetweenRuns=0
Pro Tools                : setProcessingResult=kNotImplemented | maxAbsDiffBetweenRuns=0
```

**No effect whatsoever.** Identical result under every identity tested, including two of the most
plausible allowlist candidates. This specifically weighs against a simple `getName()`-string-based
allowlist as the mechanism (though it doesn't rule out a deeper, iLok-backed authorization check
that doesn't key off the host name string at all — that remains untested and would need actual
iLok/license-account access to investigate further).

### 7.3 Test 3 — a real, non-null `ProcessContext`

Re-ran the same decisive test with a fuller `ProcessContext` (`kPlaying | kTempoValid |
kTimeSigValid`, tempo 120, 4/4) instead of just a sample rate, alone and combined with the host
spoofing from §7.2:

```
(default context)      : maxAbsDiffBetweenRuns=0
(playing context)      : maxAbsDiffBetweenRuns=0
(REAPER + playing)     : maxAbsDiffBetweenRuns=0
(Cubase + playing)     : maxAbsDiffBetweenRuns=0
```

**No effect either.** Both of Gaël's proposed mechanisms are now tested with direct evidence and
neither changes RX 11's behavior.

Kept anyway, permanently, in the real shipped `renderAudioFile` path (not just the diagnostic
function): the production `ProcessContext` was previously built with only `sampleRate` set and
`state` left at its zero-initialized default — meaning `kPlaying`/`kTempoValid`/`kTimeSigValid`
were never asserted and `projectTimeSamples` stayed at 0 for the whole file regardless of how far
into it the render actually was. Fixed to report a real playing/120bpm/4-4 context with
`projectTimeSamples` tracked accurately per block. This is an honest correctness gap independent of
RX 11 — some plugin, someday, may genuinely gate tempo-synced behavior on these flags being valid —
and regression-tested clean against ADelay (identical `rms[0-1s)=0, rms[1-2s)=0.3536,
rms[2-3s)=0` delay shape as every prior pass, byte-for-byte the same test).

### 7.4 Two discoveries beyond what was asked, both load-bearing for the overall verdict

**RX 11 Voice De-noise genuinely processes audio — unconditionally.** Sweeping the decisive
bypass-toggle test across 13 of the 17 RX 11 plugins turned up exactly one real positive:

```
RX 11 Voice De-noise: maxAbsDiffBetweenRuns=0.3735  <-- REAL DIFFERENCE
(all other 12 tested: 0.0000)
```

Cross-validated against the original, already-proven `ProcessParamDiffTest` function (not just the
new diagnostic one) — identical numbers. Real, `isBypassParam: true`, both `process()` calls return
`kResultOk`, and the "active" run has genuinely different output statistics (RMS 0.3507 → 0.3168,
a real ~10% reduction consistent with noise-gate/spectral-floor behavior) than the "bypassed" run.
**This reproduces identically across every host-name/ProcessContext combination tested** — so
whatever makes Voice De-noise different from the other 12, it isn't related to Gaël's specific
theory, but it's a significant standalone finding: **"RX 11 silently bypasses everything" is false
as a blanket statement** — at least one real-time-style tool in the suite works correctly through
this host with no special handling at all.

**The "bad test signal" explanation for De-click's zero result was tested directly and
falsified.** Added an option to inject a genuine single-sample click artifact (a +1.0/-1.0 spike)
into the test tone, specifically to check whether De-click (and De-hum, De-crackle, De-clip,
De-plosive) were correctly finding nothing to fix on a clean tone rather than not processing at
all:

```
                    no click injected    click injected
RX 11 De-click    : diff=0.00000         diff=0.00000
RX 11 De-hum      : diff=0.00000         diff=0.00000
RX 11 De-crackle  : diff=0.00000         diff=0.00000
RX 11 De-clip     : diff=0.00000         diff=0.00000
RX 11 De-plosive  : diff=0.00000         diff=0.00000
```

**Still zero, even with a real artifact to detect and repair.** This closes off the "wrong test
signal" explanation for these five specifically — De-click's normal-looking, error-free,
"0 clicks repaired" GUI is not lying about being ready, and still doesn't actually engage.

### 7.5 Updated verdict

The picture is more specific than either "RX 11 as a whole needs the standalone app" (§4.1) or "RX
11 as a whole is DRM-gated" (Gaël's theory) — it's a **mix, plugin by plugin**:

- **De-hum**: legitimately gated behind an unmet precondition (the "Learn" profiling step) — not a
  hosting bug, not DRM. Fixable, in principle, by figuring out how to trigger "Learn" programmatically
  (likely an `IMessage` the GUI's Learn button sends, or a hidden controller parameter/command —
  not investigated).
- **De-click, De-crackle, De-clip, De-plosive** (and by extension, plausibly the rest of the
  untested 4): GUI renders normally with no error, reports plausible-looking state, yet **provably
  do not process real audio through this host even when given something to act on** — Gaël's DRM
  theory doesn't explain this either (host spoofing and ProcessContext were both ruled out for
  De-hum, and there's no reason to expect a different mechanism for this group). What specifically
  blocks them remains genuinely unknown — worth searching for whether these tools require calling
  an undocumented "arm"/"activate" message via `IMessage`/`IAttributeList` beyond the standard
  `IAudioProcessor` lifecycle, since the standard lifecycle (proven correct against ADelay/Dexed)
  visibly isn't sufficient for this group specifically.
- **Voice De-noise**: works correctly, unconditionally, no special handling needed. Whatever
  distinguishes it from the other four tested restoration tools (likely: it's designed as a
  continuous/adaptive real-time process rather than a profile-then-apply tool) is itself worth
  understanding, since it may point at which *other* untested RX 11 plugins (Spectral De-noise,
  Guitar De-noise, Dialogue Isolate, Repair Assistant — all "de-noise"/continuous-sounding by name)
  are more likely to work the same way.

**Still the single most informative next step, unchanged from §4.3**: confirm whether a real DAW
(REAPER) on this same machine gets past whatever blocks De-click/De-hum/De-crackle/De-clip/
De-plosive — that would show definitively whether it's something REAPER's host implementation does
that this one doesn't (closeable), or whether even REAPER needs the "Learn" click / standalone app
/ something else these tools require regardless of host (architectural, not a hosting gap at all).

---

## 9. Addendum, 2026-09-25 (later): latency accounting + De-hum's Learn workflow — major reclassification

Gaël's follow-up analysis after §7 correctly predicted the actual missing pieces, and both were
confirmed with direct evidence. **This changes the overall verdict substantially: most of the RX
11 suite is not silently bypassing at all** — the earlier "stuck" verdict for several plugins was
a test-methodology gap, not a real block.

### 9.1 The latency gap (Gaël's hypothesis, confirmed)

§2.4's decisive bypass-toggle test ran exactly one 512-sample block per bypass state. Gaël's
point: De-click/De-crackle/De-clip/De-plosive are transient/lookahead processors — a single short
block can't reveal real processing if the plugin's own internal lookahead buffer hasn't finished
filling yet, regardless of whether it's actually working.

Fix: query `IAudioProcessor::getLatencySamples()` for real (right after `setActive(true)`), run
enough consecutive blocks to flush that much lookahead plus a real comparison window, feed
genuinely impulsive "click" content every block (not a clean tone), and compare bypass-on vs.
bypass-off **only in the region past the reported latency**.

Real numbers, all 17 plugins, `getLatencySamples()` + bypass-toggle diff **after** accounting for
latency:

| Plugin | Latency (samples) | Diff past latency | Verdict |
|---|---:|---:|---|
| RX 11 Voice De-noise | 0 | 0.8863 | ✅ already known working |
| RX 11 De-click | 29445 | **1.2799** | ✅ **reclassified — real processing, was "stuck"** |
| RX 11 De-clip | 21386 | **1.2799** | ✅ **reclassified — real processing, was "stuck"** |
| RX 11 De-crackle | 19503 | **1.2139** | ✅ **reclassified — real processing, was "stuck"** |
| RX 11 Mouth De-click | 3743 | 1.0487 | ✅ real processing |
| RX 11 Spectral De-noise | 2047 | 1.0383 | ✅ real processing |
| RX 11 De-ess | 662 | 0.3465 | ✅ real processing |
| RX 11 De-reverb | 9727 | 0.0200 | ✅ real processing |
| RX 11 De-plosive | 14335 | 0.0059 | ✅ real processing (weak, but non-zero) |
| RX 11 Breath Control | 26623 | 0.0000 | ❌ still zero — genuinely unexplained |
| RX 11 Dialogue Isolate | 1880 | 0.0000 | ❌ still zero — genuinely unexplained |
| RX 11 Guitar De-noise | 12799 | 0.0000 | ❌ still zero — genuinely unexplained |
| RX 11 Repair Assistant | 1880 | 0.0000 (but `diffFull`=0.98) | ⚠️ ambiguous — see below |
| RX 11 De-hum | 0 | 0.0000 (bypass-toggle alone) | see §9.2 — separate fix, also now confirmed working |
| RX 11 Connect / Monitor / Spectral Editor | 0 | n/a — no automatable/bypass parameter found | not conventional audio-effect plugins, expected |

**Tally shift: from "1 confirmed working, 16 unexplained" (§2–§7) to "10 confirmed working, 3
utility plugins (not applicable), 3 genuinely still unexplained, 1 ambiguous."**

`RX 11 Repair Assistant` is worth flagging specifically: `diffFull` (the whole-run diff, including
the pre-latency region) was non-zero (0.98) but `diffPastLatency` was 0. That pattern — a
difference that only shows up *before* the reported latency has flushed — doesn't fit a normal
lookahead processor and wasn't chased further. Given its name ("Repair Assistant" sounds like an
AI-assisted analysis tool, similar in spirit to De-hum's Learn workflow), it may need its own
one-time activation/analysis step the same way De-hum does — worth checking its own parameter list
with `listPluginParams` the way De-hum's was, if this one matters for real use.

Kept as a permanent host fix (independent of the RX 11 verdict, same as the ProcessContext fix in
§7): `getLatencySamples()` is real, spec-defined API surface a serious host should read and
respect regardless of this specific plugin family.

### 9.2 De-hum's "Learn" workflow (Gaël's hypothesis, confirmed decisively)

§4.1/§7's screenshot showed De-hum's own GUI literally saying "Click Learn to begin listening to
the audio for hum" — never triggered by any earlier test. Gaël's proposed fix: the Learn control
is exposed as a plain VST3 parameter; scan the controller's parameter list, find it, and drive it
through the same real `IParameterChanges` automation path already used for bypass tests.

Dumping De-hum's full parameter list (`listPluginParams` — a new diagnostic export, 33 parameters
total once the plugin was given the **same Controller/`IConnectionPoint` bridge + `setComponentState`
sync** the other tests already use — without that bridge, `getParameterCount()` reported **0**,
a real gotcha worth remembering for future parameter-inspection code) found it immediately: id 0,
titled exactly **"Enable learning"**, a plain boolean automatable parameter — not flagged
`kIsBypass` or anything special, just an ordinary parameter with no hint from its `ParameterInfo`
alone that it was "the Learn button."

Test: one continuous plugin instance/stream (not a fresh instance per bypass value the way
`ProcessParamDiffTest` works — a fresh instance would forget anything "Enable learning" ever
taught it), fed a stationary 220Hz + 60Hz test signal throughout:

1. Blocks 0–199 (~2.3s): `Enable learning` = 1 (listening), bypass off.
2. Block 200: `Enable learning` 1→0 (stop listening, commit the learned reduction).
3. Blocks 201–300 (~1.16s): still bypass off — measured as **"active, post-learn."**
4. Block 301: `Global bypass` 0→1 (engage bypass) — same continuous stream, same instance.
5. Blocks 302–401 (~1.16s): bypass on — measured as **"bypassed" control.**

Compared RMS of the two regions (a sample-position diff doesn't apply here — bypass toggles
mid-stream on one continuous run, not two separate cold-start runs):

```
activeRmsPostLearn = 0.00602   (post-learn, bypass off — the signal is nearly gone)
bypassedRms         = 0.25000   (bypass on — matches the raw test signal's real amplitude)
rmsDelta             = 0.24397
```

Repeated twice, byte-identical results both times, no crash. **This is unambiguous: once Learn is
actually engaged, De-hum reduces the signal dramatically** (enough that it likely notched out the
220Hz test tone along with the 60Hz hum, not just the hum specifically — plausible given the
plugin's harmonic-tracking design and a low, round test frequency, not itself investigated
further). De-hum was never broken, silently blocked, or DRM-gated — its own `process()` correctly
does nothing until the exact same workflow step a human using its GUI would have to perform.

### 9.3 Updated overall verdict

Gaël's DRM/host-allowlisting theory (§7) is still not supported by direct evidence — spoofing the
host identity changed nothing. But his **follow-up** diagnosis (transient-processor lookahead
latency, and a workflow-gated Learn step) was correct on both counts, and resolves 11 of the 14
plugins previously read as "stuck" (10 reclassified as genuinely working via §9.1's latency fix,
plus De-hum via §9.2's Learn fix). What's left unexplained is now a **much smaller, more specific**
list: `RX 11 Breath Control`, `RX 11 Dialogue Isolate`, `RX 11 Guitar De-noise` (still flat zero
even past latency), and `RX 11 Repair Assistant` (ambiguous pre-latency-only diff, possibly its
own Learn-style workflow gate not yet found). The REAPER ground-truth test (§4.3) is most valuable
now specifically for those four, not the whole suite.

---

## 10. Addendum, 2026-09-25 (later still): the final 4 — 3 more reclassified, 1 remains

Direct continuation of §9, generalizing its proven De-hum "Learn" pattern to the 4 plugins still
unexplained after latency accounting: `RX 11 Breath Control`, `RX 11 Dialogue Isolate`,
`RX 11 Guitar De-noise`, `RX 11 Repair Assistant`. Added `processLearnLikeToggleTest(path,
signalKind[, explicitParamId, explicitParamValue[, explicitBypassId[, secondaryParamId,
secondaryParamValue]]])` to `addon.cpp` — same continuous-stream, latency-settle-aware,
bypass-vs-active RMS comparison as §9.2's De-hum test, generalized to search for a Learn-like
boolean parameter first and fall back to an explicit/auto-detected Amount/Strength/Sensitivity
knob otherwise. Per-plugin test signals: breath-like noise bursts alternating with near-silence
(Breath Control), a played tone plus constant broadband hiss (Guitar De-noise), voice-like tonal
bursts over background noise (Dialogue Isolate, Repair Assistant).

**The generic keyword-based auto-search picked the wrong knob for 3 of the 4** — these plugins
expose many similarly-named parameters (Repair Assistant alone has 23; Guitar De-noise has 3
independent sub-modules — SQUEAK/PICK/AMP — each with its own bypass+amount pair), so a "first
match wins" heuristic isn't reliable here. Added an explicit-override mechanism to the same test
function and re-ran with hand-picked parameters based on `listPluginParams()`'s real output for
each plugin:

| Plugin | Auto-picked knob (wrong) | rmsDelta (auto) | Explicit knob tried | rmsDelta (explicit) | Verdict |
|---|---|---:|---|---:|---|
| **Breath Control** | `Sensitivity#2` → 0.9 (this WAS the right knob) | **0.0094** | — | — | ✅ **confirmed working** on the first (auto) attempt |
| **Dialogue Isolate** | `Sensitivity#3` → 0.9 | 0.0000001 (flat) | `Noise Gain#2` → 0.0 (bypass=`Global bypass#8`) | **0.1080** | ✅ **confirmed working** — huge, unambiguous reduction once the right gain slider was pushed down |
| **Repair Assistant** | `De-clip threshold#3` → 0.9 (already disabled module, wrong target) | 0.0000001 (flat) | `De-noise amount#9` → 0.9 (bypass=`Global bypass#0`) | **0.1077** | ✅ **confirmed working** — same magnitude as Dialogue Isolate, same real reduction |
| **Guitar De-noise** | `SQUEAK: Sensitivity#2` → 0.9 | 0.0000142 (flat) | `AMP: Sensitivity#12` → 0.9 + `AMP: Bypass#10` 1→0 (bypass=`Global bypass#0`) | 0.0000142 (**bit-for-bit identical to the auto attempt**) | ❌ **still unexplained** |

Breath Control turned out to need nothing special — the very first automatic attempt (push
`Sensitivity` up, same as every other plugin's fallback logic tries) already produced a real,
reproducible ~22% RMS reduction. It was only ever miscategorized as "stuck" in §9 because that
pass's blanket per-plugin test used a signal (or measurement window) that didn't happen to trigger
it; this pass's breath-burst-specific signal did.

Dialogue Isolate and Repair Assistant both needed a **specific gain/amount slider pushed away from
its default**, not a Learn-style toggle — their defaults (`Noise Gain` at 0.833 ≈ "mostly
transparent"; `De-noise amount` at 0 ≈ "off") are simply conservative out-of-the-box settings, not
disabled/gated modules. Once set to a clearly non-default value, both show large (>0.10 RMS),
essentially identical-in-magnitude reductions — real DSP, not a coincidence given how close the two
numbers are in nature (same underlying RX noise-reduction engine family, most likely).

**Guitar De-noise remains the one genuinely unexplained case**, and the evidence is now more
specific than "we haven't found the right knob yet": two structurally different attempts —
pushing `AMP: Sensitivity` and separately pushing `AMP: Resolution`, both alongside explicitly
flipping `AMP: Bypass` from its default `1` (disabled) to `0` (enabled) — produced **bit-for-bit
identical output** to each other (`activeRms: 0.17807775898862785` in both runs, no rounding
coincidence). That specific signature — two different parameter settings on the supposedly-now-
enabled AMP module producing exactly the same audio — suggests either the parameter writes aren't
reaching the AMP sub-module's actual DSP state at all (a real host/plugin-communication gap
specific to this module, not tried: verifying the parameter change is actually being reflected
back via `getParamNormalized()` after sending it, to confirm the plugin acknowledges the write),
or the AMP module needs its own noise-print/Learn step not yet found (its parameter list has no
obviously-named Learn control, but "Resolution" at a default of exactly `0` is suspicious in the
same way `De-noise amount` at `0` turned out to be a real gate for Repair Assistant — worth
re-examining whether Resolution needs a much larger push, e.g. all the way to `1.0`, or whether
the SQUEAK/PICK modules' own state is somehow interfering when AMP is enabled alongside them at
their existing defaults).

**Updated overall tally: 13 of 17 RX 11 plugins now confirmed genuinely processing real audio**
through this host (Voice De-noise, De-click, De-clip, De-crackle, Mouth De-click, Spectral
De-noise, De-ess, De-reverb, De-plosive, De-hum, Breath Control, Dialogue Isolate, Repair
Assistant). 3 are utility tools with no relevant processing parameter to test (Connect, Monitor,
Spectral Editor — not failures, just out of scope for this kind of test). **Only 1 of 17 —
Guitar De-noise — remains genuinely unexplained** after real, repeated effort with multiple
distinct parameter combinations.

---

## 8. Reference: files and commits from this investigation

- `native/engine/vst3_host/src/addon.cpp` — the host implementation itself.
- `native/engine/vst3_host/README.md` — running log of every verification pass, with exact
  numbers, in chronological order.
- Commits (chronological): `810e993` (metadata-query proof), `afd8fc6` (processing lifecycle,
  `kNotImplemented` first found), `fe6474c` (ADelay proves the host correct), `1ef83d4`
  (Controller/IConnectionPoint bridge, ruled out as the cause), `0eaf3db` (non-fatal
  `setProcessing`, per the Steinberg forum fix), `97dfde9` (bypass-toggle decisive test), `0eb661a`
  (offline file rendering, same conclusion at full-file scale).
