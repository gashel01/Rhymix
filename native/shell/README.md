# Rhymix native shell — Electron skeleton

Status: **functionally working end-to-end on Windows** — renders the real `/next` Studio UI with
live backend data, real clicks/interaction work (clip selection, transport play), the API bridge
genuinely round-trips real data (verified by reading actual bytes/behavior, not status codes
alone — an earlier pass here gave a false positive on the API bridge specifically, see "A
correction" below), and **audio actually plays out of the speakers** — confirmed in person by
Gaël after launching the real app (`npm start` in this directory), not scripted. **Bridges real
VST3 plugin hosting through to the renderer** (`window.rhymixNative.vst3.{scan,open,close,
renderFile}`, verified end to end — see "Confirmed: VST3 plugin hosting reaches the renderer via
IPC" below) — **and this is now a real Studio feature**, not just a verified contract: every
lane's "..." menu can scan, list, and open a real plugin's editor window. `renderFile` offline-
renders a real WAV through a plugin (verified: a tone-then-silence test file rendered through
ADelay comes back silence-then-tone, exactly matching its delay time). Still a skeleton past that:
no native low-latency audio I/O (ASIO/WASAPI), no packaging, no macOS, no live playback routing
(a plugin's sound doesn't join a lane's live mix during playback — offline rendering only). See
`native/README.md` and `docs/NATIVE_SHELL_PLAN.md` for why Electron was picked over Tauri and the
overall phasing.

## A correction

An earlier version of this doc claimed the API bridge was "confirmed working end-to-end" based on
a `fetch("/api/studio/projects")` call returning HTTP `200`. That check only looked at the status
code, not the response body. `main.js`'s custom `app://` protocol handler at the time had no
special case for `/api/*` paths, so those requests fell through into the same SPA
index.html-fallback logic used for missing static files — meaning the "200" was real, but the
body was the app's own HTML shell, not backend data. A pathname-routing check ("does it load
`/next`") happened to also look like it passed for the same underlying reason. Re-checking the
actual response body (`content-type`, JSON-parseability) surfaced this. Fixed properly below —
this time verified by reading the actual bytes back, not just the status code.

## What's here, and what's actually confirmed

- `package.json` — Electron `^33.0.0` as the only devDependency. **Confirmed:** `npm install`
  succeeds on this Windows machine (70 packages, no install errors; `npm audit` reports 2
  high-severity advisories in transitive deps, not addressed here — review before shipping).
- `src/main.js` — serves `frontend/build/` under a registered custom `app://rhymix/` scheme,
  loading `app://rhymix/next` specifically, and reverse-proxies any `/api/*` request straight to
  the real Flask backend (`http://localhost:5000`) instead of letting it fall into the
  static-file/SPA-fallback logic (falls back to `src/placeholder.html` over `file://` with a
  `console.warn` if the build is missing, so it never crashes on a fresh checkout without a
  frontend build).
  **Confirmed on Windows, by reading actual response bodies, against the exact committed
  `main.js`:**
  - The window renders the real mounted React app on the **native `/next` UI**, not the legacy
    MUI shell (`window.location.pathname` is `/next`; the rendered sidebar shows the `/next` nav —
    Library, Create, Voices, Studio, Settings — not the legacy nav's "Create Song"/"Models"
    items).
  - `fetch("/api/studio/projects")` from inside that window returns `content-type:
    application/json`, a body that actually parses as JSON, and a real project count (136) — not
    just a `200` (see "A correction" above for why that distinction mattered here).
  - `fetch("/api/download/exports/<a real export file>.wav")` returns `content-type: audio/wav`
    and the exact real byte length of that file (727118 bytes) — binary responses proxy
    correctly too, not just JSON, which matters for actual audio playback working.
  - A real multipart `FormData` `POST` to `/api/upload` from inside the window was received and
    processed by the backend (returned a real `fileId`, not a fallback) — the `duplex: "half"`
    body-forwarding for non-GET requests works, not just header-only GETs. (Test file deleted
    after verification.)
  - A real `EventSource` against `/api/jobs/<id>/events` (a live render job, triggered for this
    test) received genuine incremental events through the proxy — `queued` → `running` →
    `completed`, each arriving separately over time, not one buffered response — confirming SSE's
    streaming semantics survive the proxy, which the job-progress UI depends on. (The
    auto-reconnect-then-error after the server closes the completed job's stream is normal
    `EventSource` behavior per spec, not a proxy bug.) Test clip removed from the demo project
    after verification.
- `src/preload.js` — empty preload script stub, sandboxed/contextIsolation left on (security
  default — do not turn this off to "make it easier" to bridge native code later; the N-API
  bridge to `native/engine/` should go through a proper `contextBridge.exposeInMainWorld` API,
  not by disabling isolation).

## The fixes, in the order they were actually needed

**1. `file://` itself blocks outbound fetches regardless of CORS.** The first attempt loaded the
build with `win.loadFile()` (a `file://` origin). Every `fetch()` from a `file://` page came back
`TypeError: Failed to fetch`, regardless of the backend's CORS headers being genuinely correct
(`Access-Control-Allow-Origin` echoed properly, confirmed with `curl -H "Origin: null"` directly
against Flask) — Chromium treats `file://` as an opaque/`null` origin and blocks or mishandles
outbound fetches from it independent of what the server allows. Fixed by registering a real,
privileged custom scheme (`app://`, via `protocol.registerSchemesAsPrivileged` +
`protocol.handle`) and loading `app://rhymix/next` instead, giving the page a real, stable origin.

**2. A custom scheme alone doesn't make `/api/*` reach the backend — it needs an explicit
proxy.** Registering `app://` and serving `frontend/build/` off it fixed the *origin* problem, but
`protocol.handle`'s job is to answer every request under that scheme, including `/api/...` ones —
and the handler's only logic was "serve this file from `frontend/build/`, or fall back to
`index.html` if it doesn't exist." An `/api/...` path is never a real file under `frontend/build/`,
so every API call silently resolved to the SPA fallback and returned the app's own HTML with a
`200` — the false positive described above. Fixed by special-casing `/api/*` inside the same
handler: reverse-proxy it to `http://localhost:5000` (forwarding method, headers, and body/
`duplex: "half"` for non-GET requests) instead of falling through to the file-serving branch.

**3. Default Electron chrome doesn't belong on a fully custom UI.** The default
File/Edit/View/Window/Help application menu bar Electron shows unless told otherwise is generic
dev-shell chrome sitting on top of an interface that already has its own sidebar and controls.
Removed with `Menu.setApplicationMenu(null)`.

Separately, `frontend/src/utils/apiBase.js` (centralizing the ~19 places across the whole app that
each built their own relative `/api/...` URL) is still in the tree and still harmless/correct, but
turned out **not to be what fixes the Electron case** — under `app://`, `window.location.protocol`
is `"app:"`, not `"file:"`, so `apiBase.js`'s own detection never treats it as needing an absolute
URL, and the interceptor never engages there. The real fix lives entirely in `main.js`'s protocol
handler. `apiBase.js` still matters for a genuinely different scenario (e.g. a static build hosted
separately from its API), so it wasn't removed, but earlier text here overstated its role in this
specific fix.

## Confirmed: Studio actually renders real project data inside the shell

Loaded `app://rhymix/next#studio?projectId=<a real test project>` and captured the window with
`webContents.capturePage()` (not a description — an actual screenshot, sent to Gaël, then deleted
from the repo since it's point-in-time verification output, not something to keep versioned). It
showed: real lanes (Vocals, Mix, Instrumental, Stems, Generated Layers, MIDI) with a real
waveform-rendered clip, the real 13-asset library list, and real project metadata (120 BPM, C
minor) populated in the right panel — not a blank screen, an error boundary, or stale mock data.
This confirms the *rendering* path works end-to-end with live backend data, which the earlier API
probes alone didn't (they proved individual requests worked, not that the whole app assembles
correctly from them).

## Confirmed: real interaction inside the window works, not just rendering

Dispatched genuine `PointerEvent`s at a real clip's on-screen coordinates (not a scripted call
into React internals) — it selected (`studio-clip selected` class applied) and the floating AI
bar appeared, exactly like clicking it with a mouse in a browser. Separately, clicking the real
transport Play button advanced the on-screen clock (`0:00.000` → `0:00.750`) with no JS error
thrown. This is real DOM event handling and component state working inside the shell, not just a
static render.

## Confirmed: audio actually plays

Launched the real app for real (`npm start` in this directory, not a scripted headless probe) and
Gaël confirmed in person that sound comes out when pressing Play on a clip. This was the one thing
left that no script could verify — the transport clock advancing only proved the playback *logic*
ran without erroring, not that Web Audio API output actually reached a speaker. It does.

## Confirmed: VST3 plugin hosting reaches the renderer via IPC

`src/main.js` `require()`s the native VST3 host addon (`native/engine/vst3_host/`, see that
README for the full addon-level evidence) defensively — a missing/ABI-mismatched build logs a
warning and disables just the `vst3:*` IPC handlers, not the whole shell — and wires three
`ipcMain.handle` calls straight to it. `src/preload.js` exposes them via `contextBridge` (
`contextIsolation` stays `true`, unchanged) as:

```js
window.rhymixNative.vst3.scan(directories: string[])  -> Promise<Array<{path, name, vendor, category}>>
window.rhymixNative.vst3.open(path: string)            -> Promise<{instanceId: string}>
window.rhymixNative.vst3.close(instanceId: string)      -> Promise<boolean>
window.rhymixNative.vst3.openEmbedded(pluginPath: string, {x, y, width, height}) -> Promise<{instanceId: string}>
window.rhymixNative.vst3.reposition(instanceId: string, {x, y, width, height})    -> Promise<boolean>
window.rhymixNative.vst3.renderFile(pluginPath, inputWavPath, outputWavPath)
                                                        -> Promise<{success, outputPath, durationSec,
                                                            sampleRate, channels, setProcessingResult,
                                                            inputStats, outputStats}>
```

**Verified from inside a real launched Electron renderer**, not just the addon called directly
from bare Node — via `webContents.executeJavaScript()` against the actual running shell:

```
window.rhymixNative.vst3.scan(["C:/Program Files/Common Files/VST3/iZotope"]) → 17 real entries
window.rhymixNative.vst3.open(dexedPath) → {ok: true, instanceId: "vst3-..."}
window.rhymixNative.vst3.close(instanceId) → {closed: true}
window.rhymixNative.vst3.renderFile(adelayPath, inputWav, outputWav) → real success + real stats,
  matching the direct-addon result exactly (see engine/vst3_host/README.md for the actual numbers)
```

An open editor runs on its own dedicated thread (confirmed not to block Node's event loop — see
`engine/vst3_host/README.md`) and rendered a real, visually-inspected Dexed GUI while the shell's
own JS kept running.

**This is now a real Studio feature, not just a verified IPC contract.** Every lane's "..." menu
in `frontend/src/studio/components/TrackList.js` has a "VST3 Plugins" section (rendered only when
`window.rhymixNative.vst3` exists — absent, not broken, in the browser build) that scans, lists,
and opens a real plugin editor window on click, verified through actual DOM interaction against
the real running shell (clicked the real Scan button, got the real 17-entry list, clicked a real
plugin, watched its button flip to "Close"/active once the real window opened). Fixing this UI
surfaced and fixed a real `scanPlugins` bug: it only looked one directory level deep, so pointing
it at the conventional root install folder (`C:\Program Files\Common Files\VST3\`) found nothing —
real plugins live one level down, under a per-vendor subfolder. Now recursive.

## Confirmed: an editor can be reparented into the shell's own window, not just opened standalone

`open()` above always pops a separate, standalone top-level OS window for the plugin's editor.
`openEmbedded(pluginPath, {x, y, width, height})` and `reposition(instanceId, {x, y, width,
height})` are the new alternative: the editor's `HWND` is created as a `WS_CHILD` of the
*calling* Electron window from the start (resolved server-side via
`BrowserWindow.fromWebContents(event.sender).getNativeWindowHandle()`, never a renderer-supplied
handle — renderers don't get raw native window handles), so it renders genuinely inside Rhymix's
own window bounds instead of as a separate OS window. `x`/`y`/`width`/`height` are CSS pixels in
the renderer's own client-area coordinate space (the same space `getBoundingClientRect()` on a
placeholder element returns).

**Verified from inside the real running shell, via real desktop screenshots** (Electron's own
`webContents.capturePage()` doesn't see a reparented native child — it's OS-composited, not part
of Chromium's own paint — so a real screen capture, not `capturePage()`, is the only valid proof
here):

```
openEmbedded(Dexed.vst3, {x: 900, y: 100, width: 400, height: 500})
  → screenshot: Dexed's real GUI rendered inside the Rhymix window's own bounds at that position.
reposition(instanceId, {x: 100, y: 300, width: 600, height: 300})
  → screenshot: same GUI moved live to the new position/size, no reopen.
close(instanceId)
  → screenshot: window fully gone, no orphaned remnant, same close() call as a standalone editor.
```

Full detail and the native-layer implementation (`WS_CHILD` creation, the `WM_APP_REPOSITION`
cross-thread message, why `closePluginEditor` needed no changes) is in
`engine/vst3_host/README.md`'s "Embedded editor windows" section.

**Not built this pass** (separate, subsequent work): the actual Studio right-panel placeholder
UI in `frontend/src/studio/` that calls `openEmbedded`/`reposition`, a resize-observer to keep it
in sync with real layout changes, and a UI toggle for embedded (default) vs. standalone (opt-in,
via the existing `open()`/`close()`, unchanged) — today's "VST3 Plugins" lane menu still only
calls `open()`. Also not verified: behavior under a display scale factor other than 100% (see
the engine README for why).

## What's still genuinely unverified

- **macOS** — nothing in this repo has ever been built, launched, or code-signed on a Mac. Every
  macOS-specific claim anywhere in `native/` is written from documentation, not tested.
- **Packaging** (`electron-builder` or equivalent) — not added yet; the app only runs via
  `npm start` from source, there's no installer/signed binary to hand someone else.
- **Native low-latency audio I/O** (ASIO/WASAPI) — audio still plays through the same Web Audio
  API path the browser build already used; VST3 hosting is wired (see above), but a lower-latency
  native audio path specifically hasn't been built.
- **Live playback routing** — `renderFile` is real but offline/one-shot; a plugin's sound does not
  join a lane's live mix during playback. That's a separate, much larger real-time-systems project
  (shared memory, a dedicated audio thread, sample-accurate sync), not attempted.
- **Parameter automation, GUI-embedded-in-chrome, crash isolation** — see
  `engine/vst3_host/README.md`'s "What's not here" for the full list.

## Explicit next steps (not done here)

1. Build a Studio feature around `renderFile` — pick a clip + a plugin from the lane menu, render
   it, register the result as a new project asset (mirrors what the "VST3 Plugins" open-editor
   feature already does for browsing, one step further).
2. macOS build/launch/notarization and Windows installer config — needs a real Mac for the
   former; entirely unverified from this environment.
3. Packaging with `electron-builder` (or equivalent) so the app is a real installable artifact
   instead of something only runnable from source via `npm start`.
