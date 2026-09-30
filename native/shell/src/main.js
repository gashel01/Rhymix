const { app, BrowserWindow, Menu, protocol, net, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const { pathToFileURL } = require("url");

// Native VST3 host addon (native/engine/vst3_host/) — built separately with cmake-js against
// this same Electron version's ABI. Loaded lazily and defensively: a missing/mismatched-ABI
// build shouldn't take down the whole shell, just the plugin-hosting IPC handlers below.
let vst3Host = null;
try {
  vst3Host = require(path.join(__dirname, "..", "..", "engine", "vst3_host", "index.js"));
} catch (err) {
  console.warn("[rhymix-shell] native VST3 host addon failed to load — plugin hosting IPC will be unavailable:", err.message);
}

// Chromium's default GPU compositing path on Windows conflicts with a natively reparented
// WS_CHILD window (the VST3 plugin editor embedded in Studio's right panel, see
// registerVst3Ipc's vst3:openEmbedded below): the child's own rendering never composites into
// the visible surface, so the embedded editor is a solid black rectangle. Confirmed by hand —
// real desktop screenshots, not webContents.capturePage() (which can't see a reparented native
// child's GPU-composited content at all and would have reported success either way): launching
// with --disable-gpu on the command line made the plugin's controls render correctly, launching
// without it (the app's actual/only real launch path — this app is never started with CLI flags)
// left them black. Trying just `--disable-features=DirectComposition` first did NOT fix it
// (verified: still solid black) — the conflict isn't specific to that one feature, so this falls
// back to disabling hardware acceleration outright, baked into the app itself so it's in effect
// on the exact same `electron .` launch the user actually uses, no flag required from them.
app.disableHardwareAcceleration();

// Loads the real frontend/build if present, otherwise falls back to the placeholder page with a
// console warning instead of crashing. See native/shell/README.md for what's still not wired up
// (native engine bridge, packaging, macOS).
//
// Served over a custom "app://" scheme, NOT loadFile()/file://. A file:// origin is "null" in
// Chromium and outbound fetch()/XHR from it is blocked/unreliable regardless of the backend's
// CORS headers being correct — confirmed by hand: loadFile() + a CORS-permissive Flask backend
// still failed every fetch with a bare "TypeError: Failed to fetch". A registered custom scheme
// gives the page a real, stable origin ("app://rhymix") that CORS negotiates normally.

const FRONTEND_BUILD_DIR = path.join(__dirname, "..", "..", "..", "frontend", "build");
const FRONTEND_BUILD_INDEX = path.join(FRONTEND_BUILD_DIR, "index.html");
const BACKEND_ORIGIN = "http://localhost:5000";

protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

function registerAppProtocol() {
  protocol.handle("app", (request) => {
    const requestUrl = new URL(request.url);

    // /api/* must be reverse-proxied to the real Flask backend, not resolved against
    // frontend/build/. An earlier version of this handler didn't special-case this: any
    // /api/... request fell through the "file doesn't exist under build/" branch below into the
    // SPA index.html fallback, which happily returned 200 with an HTML body — a silent failure
    // that looked like success (status 200) unless you actually checked the response body/
    // content-type, which is exactly what the first pass at verifying this didn't do.
    if (requestUrl.pathname.startsWith("/api/")) {
      const backendUrl = `${BACKEND_ORIGIN}${requestUrl.pathname}${requestUrl.search}`;
      // request.signal must be forwarded: without it, an incoming request the renderer
      // abandons (e.g. an <audio> element cancelling an in-flight Range fetch the instant a
      // new seek supersedes it) never cancels the outgoing net.fetch to Flask, leaving it
      // running to completion for no one and tying up one of Chromium's ~6 concurrent
      // connections to this origin in the meantime.
      const init = { method: request.method, headers: request.headers, signal: request.signal };
      if (request.method !== "GET" && request.method !== "HEAD" && request.body) {
        init.body = request.body;
        init.duplex = "half"; // required by the fetch spec when body is a stream
      }
      return net.fetch(backendUrl, init);
    }

    let filePath = path.join(FRONTEND_BUILD_DIR, decodeURIComponent(requestUrl.pathname));
    // SPA fallback: any non-/api path that isn't a real build file (client-side routes, or a
    // missing build altogether) resolves to index.html, same as a static file server configured
    // for a single-page app.
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = FRONTEND_BUILD_INDEX;
    }
    return net.fetch(pathToFileURL(filePath).toString());
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Studio's autosave is debounced 800ms after the last edit (StudioPage.js/StudioView.js) — a
  // window closed mid-debounce would silently drop whatever changed in that last window (this is
  // exactly what happened repeatedly to this session's own test scripts, killing the process
  // right after scripting a change). Block the actual close once, give the renderer a chance to
  // flush any pending save, then let it through.
  let readyToClose = false;
  win.on("close", (event) => {
    if (readyToClose) return;
    event.preventDefault();
    ipcMain.once("app:flush-done", () => {
      readyToClose = true;
      win.close();
    });
    win.webContents.send("app:flush-before-close");
    // Backstop: don't hang the window shut forever if the renderer never responds (e.g. it
    // crashed, or hadn't finished loading enough to have registered the handler at all).
    setTimeout(() => {
      if (!readyToClose) {
        readyToClose = true;
        win.close();
      }
    }, 2000);
  });

  if (fs.existsSync(FRONTEND_BUILD_INDEX)) {
    // The app has two frontends sharing one build: App.js picks between them by checking
    // window.location.pathname.startsWith("/next") — loading "/index.html" landed on the
    // legacy MUI shell instead of the native /next UI this whole native-shell effort is for.
    // "/next" (no trailing path) matches that check and lets NextApp's own hash router pick
    // its usual default sub-view, same as visiting /next in a browser with no hash.
    win.loadURL("app://rhymix/next");
  } else {
    console.warn(
      `[rhymix-shell] frontend build not found at ${FRONTEND_BUILD_INDEX} — falling back to placeholder.html. Run "npm run build" in frontend/ first.`
    );
    win.loadFile(path.join(__dirname, "placeholder.html"));
  }
}

// IPC surface for the VST3 host addon. This is the exact contract the Rhymix UI (running in the
// renderer, via preload.js's contextBridge) calls against — kept here rather than inline in
// createWindow() since it's app-lifetime state (open plugin instances), not per-window.
// Per-user plugin folder, alongside the machine-wide C:\Program Files\Common Files\VST3\ —
// writing there needs no admin/UAC elevation, unlike Program Files. Steinberg doesn't standardize
// a per-user Windows VST3 location the way it does on macOS, so this is Rhymix's own: anything a
// user (or a dev testing without admin rights, which is how this one first got used) drops here
// shows up in scans without needing an installer.
const USER_VST3_DIR = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Rhymix", "VST3") : null;

function registerVst3Ipc() {
  ipcMain.handle("vst3:scan", async (_event, directories) => {
    if (!vst3Host) throw new Error("Native VST3 host addon is not loaded");
    const requested = Array.isArray(directories) ? directories : [];
    const dirs = USER_VST3_DIR ? [...requested, USER_VST3_DIR] : requested;
    return vst3Host.scanPlugins(dirs);
  });
  ipcMain.handle("vst3:open", async (_event, pluginPath) => {
    if (!vst3Host) throw new Error("Native VST3 host addon is not loaded");
    return vst3Host.openPluginEditor(pluginPath);
  });
  ipcMain.handle("vst3:close", async (_event, instanceId) => {
    if (!vst3Host) throw new Error("Native VST3 host addon is not loaded");
    return vst3Host.closePluginEditor(instanceId);
  });
  // Embedded editor: reparented as a WS_CHILD of whichever window actually asked, not a
  // standalone floating window. BrowserWindow.fromWebContents(event.sender) is the standard
  // Electron pattern for "give me the window this IPC call came from" — the renderer never
  // passes its own handle, since it doesn't have one (getNativeWindowHandle() isn't exposed to
  // renderer code, on purpose — it's real native OS access).
  ipcMain.handle("vst3:openEmbedded", async (event, { pluginPath, x, y, width, height }) => {
    if (!vst3Host) throw new Error("Native VST3 host addon is not loaded");
    const callerWindow = BrowserWindow.fromWebContents(event.sender);
    if (!callerWindow) throw new Error("Could not resolve the calling window");
    const parentHandle = callerWindow.getNativeWindowHandle();
    return vst3Host.openPluginEditorEmbedded(pluginPath, parentHandle, x, y, width, height);
  });
  ipcMain.handle("vst3:reposition", async (_event, { instanceId, x, y, width, height }) => {
    if (!vst3Host) throw new Error("Native VST3 host addon is not loaded");
    return vst3Host.repositionPluginEditor(instanceId, x, y, width, height);
  });
  ipcMain.handle("vst3:renderFile", async (_event, pluginPath, inputPath, outputPath) => {
    if (!vst3Host) throw new Error("Native VST3 host addon is not loaded");
    return vst3Host.renderAudioFile(pluginPath, inputPath, outputPath);
  });
  // Higher-level than renderFile: the renderer never gets a local filesystem path for a
  // project asset (public_project_payload deliberately strips "path" before an asset ever
  // reaches the client, see backend/features/studio/storage.py) — it only has a /api/download/...
  // URL. This handler does the three steps that bridges that gap, all in the main process, which
  // has both real network access to fetch the source audio and a real filesystem to hand
  // renderAudioFile the paths it needs: fetch the asset's bytes from the backend, render them
  // through the plugin to a temp file, then upload that temp file back through the SAME generic
  // /api/upload endpoint the SF2 import feature already uses — so the renderer just needs to
  // register the returned record as a new asset the exact same way it already does there.
  ipcMain.handle("vst3:renderClip", async (_event, { assetUrl, pluginPath }) => {
    if (!vst3Host) throw new Error("Native VST3 host addon is not loaded");
    if (!assetUrl || !pluginPath) throw new Error("renderClip requires assetUrl and pluginPath");

    const jobId = crypto.randomUUID();
    const tempDir = path.join(os.tmpdir(), "rhymix-vst3-render");
    fs.mkdirSync(tempDir, { recursive: true });
    const inputPath = path.join(tempDir, `${jobId}-in.wav`);
    const outputPath = path.join(tempDir, `${jobId}-out.wav`);

    try {
      const sourceRes = await fetch(`${BACKEND_ORIGIN}${assetUrl}`);
      if (!sourceRes.ok) throw new Error(`Could not fetch source audio (${sourceRes.status})`);
      const sourceBytes = Buffer.from(await sourceRes.arrayBuffer());
      fs.writeFileSync(inputPath, sourceBytes);

      const renderResult = await vst3Host.renderAudioFile(pluginPath, inputPath, outputPath);
      if (!renderResult?.success) throw new Error("Plugin render did not report success");

      const outputBytes = fs.readFileSync(outputPath);
      const pluginName = path.basename(pluginPath, path.extname(pluginPath));
      const form = new FormData();
      form.append(
        "file",
        new Blob([outputBytes], { type: "audio/wav" }),
        `${pluginName}-render-${jobId.slice(0, 8)}.wav`
      );
      const uploadRes = await fetch(`${BACKEND_ORIGIN}/api/upload`, { method: "POST", body: form });
      if (!uploadRes.ok) throw new Error(`Upload of rendered audio failed (${uploadRes.status})`);
      const uploadBody = await uploadRes.json();
      const record = uploadBody?.files?.[0];
      if (!record?.fileId) throw new Error("Upload response missing fileId");

      return {
        fileId: record.fileId,
        storedName: record.storedName,
        originalName: record.originalName,
        safeDisplayName: record.safeDisplayName,
        durationSec: renderResult.durationSec,
      };
    } finally {
      try {
        fs.unlinkSync(inputPath);
      } catch {}
      try {
        fs.unlinkSync(outputPath);
      } catch {}
    }
  });
}

app.whenReady().then(() => {
  // The /next UI is a fully custom interface with its own sidebar and controls — the default
  // Electron File/Edit/View/Window/Help menu bar is generic dev-shell chrome that doesn't belong
  // on top of it.
  Menu.setApplicationMenu(null);
  registerAppProtocol();
  registerVst3Ipc();
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
