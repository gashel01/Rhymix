# Architecture Decision: Native Shell + Plugin Hosting for Rhymix

**Status:** Proposed · **Date:** 2026-09-24 · **Decision owners:** Founding eng

> This document was drafted by AI-run research (3 parallel research agents + 1 synthesis pass)
> at Gaël's request, while he was disconnected. It is a strong starting point, **not** a
> substitute for legal review before anything ships commercially — see §5.

---

## 1. Executive Recommendation

Build the native shell in **Electron**, not Tauri, wrapping the existing React UI and bridging
to a native C++ audio engine via N-API — Tauri's Rust-FFI translation layer and its lack of any
precedent for embedding native plugin GUIs make it the riskier bet for a DAW, even though it
loses on install size/RAM. For plugin hosting, host **VST3 via Steinberg's now-MIT-licensed VST3
SDK (3.8.0+)** and **AU via Apple's Apache-2.0 AudioUnitSDK**, paired with a **custom/lightweight
C++ hosting layer instead of JUCE** — this combination is commercial-closed-source-safe, has zero
licensing fees, and triggers no GPL obligation, which was not reliably true before Steinberg's
October 2025 re-license. Layer in **CLAP support as a secondary, low-cost format** (MIT-licensed,
simpler ABI, real reference host available) once VST3/AU hosting is solid — it's cheap insurance
for Bitwig/REAPER-adjacent boutique-synth users but must not be primary, since its plugin catalog
is still a small fraction of VST3's and no major vendor (NI, Waves, iZotope, Arturia) ships it yet.

---

## 2. Shell Framework: Electron vs Tauri

| Factor | Electron | Tauri |
|---|---|---|
| Reuse existing React UI | Equally easy — both render standard web content | Equally easy |
| Bridge to native C++ audio engine | Mature path (Node N-API / node-addon-api + cmake-js); real precedent | Requires a Rust FFI wrapper (cxx/bindgen) around the C++ engine first — extra layer, no real-time-audio precedent |
| Embedding native VST/AU plugin GUIs (HWND/NSView reparenting) | Manual but documented, with working community patterns | Same manual work, but reparenting into/over an OS webview is far less trodden — no known production audio example |
| Real-time audio safety | Audio runs in native addon/child process, not Chromium's JS thread — GC/event-loop jank stays confined to UI chrome | Same isolation achievable, but less proven in this domain |
| Install size / idle RAM | ~150MB+, higher idle RAM | ~3–10MB webview-based, ~75% less idle RAM |
| Packaging/signing | electron-builder: battle-tested (dual SHA-1/SHA-256 signing, mature installers, solid notarization flow) | Newer tooling; some reported notarization build issues |
| Known production precedent | Several real DAW/plugin-host examples exist | None found |

**Verdict:** Electron's size/RAM disadvantage is proportionally minor once a native audio engine
and plugin SDKs are bundled anyway. Electron wins on the two things that actually carry
engineering risk for this app: native C++ bridging and native plugin-GUI embedding.

---

## 3. Licensing Path (Precise)

**SDKs to use:**
- **VST3 SDK ≥ 3.8.0** (`steinbergmedia/vst3sdk`) — plain **MIT License**, confirmed in the
  repo's `LICENSE.txt`. This replaced the old dual GPLv3/proprietary-commercial model in
  October 2025.
- **AudioUnitSDK** (`apple/AudioUnitSDK`) — **Apache License 2.0**, royalty-free.
- **No JUCE.** Build the hosting layer directly against these SDKs (custom or thin MIT-licensed
  C++ wrapper) instead of JUCE, which is dual-licensed AGPLv3/paid-commercial.

**What the terms actually require:**
- **Fees:** None. No revenue-based fee, no membership, no signed developer agreement for VST3.
  AU is free as part of the OS/Xcode SDK.
- **Copyleft:** None. MIT and Apache-2.0 both permit closed-source commercial use with no
  source-disclosure obligation.
- **Attribution/trademark:** Only triggered if the word "VST" or Steinberg's Compatible logo is
  used in branding/marketing. If used, Steinberg's usage guidelines require the ® symbol on
  first use plus "VST is a registered trademark of Steinberg Media Technologies GmbH" in
  credits/docs, and logo placement rules if the logo is shown. **Fully avoidable** by not
  branding with the VST name — MIT code rights are unaffected either way. Recommendation: keep
  the attribution line in an About/credits box regardless (costs nothing, removes ambiguity) and
  skip the logo.
- **Platform cost, not a plugin-hosting fee:** macOS code-signing/notarization requires the
  standard $99/year Apple Developer Program — applies to shipping *any* signed macOS app,
  unrelated to AU hosting specifically.
- **VST2 exclusion:** VST2 SDK/API source is explicitly *not* covered by the MIT re-license and
  remains under old, now largely unavailable proprietary terms. Do not pull in VST2
  compatibility shims from older forks/tutorials — target VST3 only.

**Does this avoid GPL and JUCE fees?** Yes, per the primary sources checked (Steinberg's own
`LICENSE.txt`/Developer Portal, Apple's own `LICENSE.txt`). Both GPLv3 exposure and JUCE's
AGPLv3/commercial-fee dilemma are avoided by this SDK combination.

**⚠️ Needs legal review before shipping:**
- The VST3 MIT re-license is very recent (Oct 2025); confirm the exact SDK commit/version
  vendored into the build is ≥3.8.0 and carries the MIT `LICENSE.txt`, not an older cached copy.
- Get actual counsel sign-off on applicability to Rhymix's specific packaging/distribution model
  before commercial launch — this document is research synthesis, not legal advice.

---

## 4. Phased Build Plan

**Phase 1 — Native shell, no plugin hosting.**
Electron shell wrapping the existing React UI; native C++ addon (N-API) for real audio I/O
(ASIO/WASAPI/CoreAudio) and MIDI hardware I/O. *Reason: validates the shell/bridge architecture
and delivers immediate DAW-usability wins (low-latency audio, real MIDI) before taking on the
much larger complexity of plugin hosting.*

**Phase 2 — VST3 + AU hosting.**
Add the MIT VST3 SDK and Apache-2.0 AudioUnitSDK behind the native engine; implement plugin
scanning, processing, and native GUI window embedding (HWND/NSView reparenting). *Reason:
VST3/AU covers the overwhelming majority of the commercial plugin market — this is the format
work that actually unlocks third-party instruments/effects for users.*

**Phase 3 — CLAP support.**
Layer in CLAP hosting using `free-audio/clap-host` as a scaffold and `clap-validator` for
conformance. *Reason: CLAP's flat C ABI is meaningfully cheaper to integrate once the
plugin-hosting scaffolding (scanning, GUI embedding, processing loop) already exists from Phase
2 — best done as a cheap incremental add-on, not a parallel first effort, given its still-small
plugin catalog.*

---

## 5. What We Could Not Verify Here

- **No macOS machine used** to actually build/sign/notarize an AU-hosting binary or confirm
  real-world NSView plugin-GUI reparenting behavior — this is research from documentation/source,
  not a working prototype.
- **No lawyer review** of the VST3 MIT re-license's applicability to Rhymix's specific commercial
  packaging, or of the trademark-avoidance strategy — flagged explicitly above as required
  before shipping.
- **No production Tauri-based DAW or native-plugin-hosting app was found** during research, so
  the Tauri risk assessment is inferred from absence of precedent, not from a failed attempt —
  a viable pattern may exist but wasn't discoverable.
- **CLAP catalog breadth is a moving target** (Cubase/Nuendo support is "announced," undated);
  re-check the Phase 3 cost/benefit against catalog growth closer to implementation time.
- **The Oct 2025 MIT re-license is recent** enough that secondary sources (tutorials, forum
  posts, older SDK copies) may still describe the retired GPLv3/proprietary regime — re-verify
  any code or guidance pulled from pre-Oct-2025 sources against the current `LICENSE.txt`.

---

## Related

- UX/product gap backlog for the "speed beatmaker" positioning: `docs/SPEED_BEATMAKER_UX_BACKLOG.md`
- Scaffold (unbuilt, unverified) for the phase-1 native engine: `native/`
