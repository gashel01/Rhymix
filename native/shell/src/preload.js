const { contextBridge, ipcRenderer } = require("electron");

// Exposed as window.rhymixNative rather than adding to the page's own global scope directly —
// contextIsolation stays on (see main.js), this is the one sanctioned crossing point between
// the renderer and anything native. The Rhymix UI (frontend/src/studio/) builds its actual
// plugin-browsing/hosting feature against this exact shape; the shape is the real contract, not
// an implementation detail — coordinate here before renaming/restructuring it.
contextBridge.exposeInMainWorld("rhymixNative", {
  vst3: {
    // scan(directories: string[]) -> Promise<Array<{path, name, vendor, category}>>
    scan: (directories) => ipcRenderer.invoke("vst3:scan", directories),
    // open(path: string) -> Promise<{instanceId: string}> — opens the plugin's own native
    // editor window, live and interactive, independent of this window until closed.
    open: (pluginPath) => ipcRenderer.invoke("vst3:open", pluginPath),
    // close(instanceId: string) -> Promise<boolean> — closes either kind of editor (standalone
    // window or embedded), same call either way.
    close: (instanceId) => ipcRenderer.invoke("vst3:close", instanceId),
    // openEmbedded({pluginPath, x, y, width, height}) -> Promise<{instanceId: string}>
    // Opens the plugin's editor reparented INTO Rhymix's own window (Studio's right panel is the
    // intended placeholder) instead of a separate floating OS window — x/y/width/height are CSS
    // pixels relative to the renderer's own client area (the same coordinate space
    // getBoundingClientRect() on the placeholder element already gives you). NOTE: not verified
    // under a display scale factor other than 100% — Win32 SetWindowPos works in physical pixels,
    // and whether Electron's coordinate reporting already accounts for that or needs an explicit
    // window.devicePixelRatio correction before calling this wasn't tested on this machine (single
    // 100%-scale monitor only). Test on a scaled display before relying on exact alignment there.
    openEmbedded: (pluginPath, rect) =>
      ipcRenderer.invoke("vst3:openEmbedded", { pluginPath, x: rect.x, y: rect.y, width: rect.width, height: rect.height }),
    // reposition(instanceId, {x, y, width, height}) -> Promise<boolean>
    // Moves/resizes an already-open EMBEDDED instance (throws/rejects if instanceId was opened
    // via open(), not openEmbedded() — standalone windows aren't repositionable through this,
    // they're independent OS windows the user moves themselves). Safe to call on every
    // resize/scroll of the placeholder element; fire-and-forget from the caller's perspective
    // (the promise resolves once the reposition request is queued on the plugin's own window
    // thread, not once the frame has actually repainted).
    reposition: (instanceId, rect) =>
      ipcRenderer.invoke("vst3:reposition", { instanceId, x: rect.x, y: rect.y, width: rect.width, height: rect.height }),
    // renderFile(pluginPath, inputWavPath, outputWavPath) ->
    //   Promise<{success, outputPath, durationSec, sampleRate, channels, setProcessingResult,
    //            inputStats: {min,max,rms,allFinite,sampleCount},
    //            outputStats: {min,max,rms,allFinite,sampleCount}}>
    // Offline, one-shot: reads a real WAV file, runs it through the plugin block by block, writes
    // a real WAV file back out (always 32-bit float PCM). NOT a live playback route — the plugin's
    // sound does not join a lane's live mix; this renders a whole file once and returns. Input
    // format: 16/24/32-bit PCM or 32-bit float WAV. Rejects (throws) on a bad path/unreadable file/
    // plugin without a usable audio bus — inspect the error message, it's specific.
    renderFile: (pluginPath, inputPath, outputPath) =>
      ipcRenderer.invoke("vst3:renderFile", pluginPath, inputPath, outputPath),
    // renderClip({assetUrl, pluginPath}) ->
    //   Promise<{fileId, storedName, originalName, safeDisplayName, durationSec}>
    // The one the Studio UI actually calls: takes a project asset's /api/download/... URL (never
    // a local path — the renderer never has one, see backend/features/studio/storage.py) plus a
    // plugin path, fetches the source audio from the backend, renders it through the plugin
    // (renderFile under the hood), and uploads the result back through the same generic
    // /api/upload endpoint the soundfont-import feature already uses. The returned record is
    // exactly the shape LibraryPanel.js's existing upload handlers already register as an asset
    // with actions.registerAsset(...) — this doesn't touch project state itself, the caller does.
    renderClip: (assetUrl, pluginPath) => ipcRenderer.invoke("vst3:renderClip", { assetUrl, pluginPath }),
  },
  app: {
    // onFlushRequest(handler) — main.js fires this when the window is about to close, so any
    // pending debounced autosave (Studio patches the project 800ms after the last edit) gets one
    // last chance to actually reach the backend instead of being silently dropped by the window
    // closing mid-debounce. handler is async; the window only actually closes once it resolves.
    onFlushRequest: (handler) => {
      ipcRenderer.on("app:flush-before-close", async () => {
        try {
          await handler();
        } finally {
          ipcRenderer.send("app:flush-done");
        }
      });
    },
  },
});
