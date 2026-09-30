/* Plugins confirmed, via extensive testing (see docs/RX11_VST3_INVESTIGATION.md), to either not
   actually process audio through this host or not be applicable as a render/insert effect at
   all. Filtered out of what the UI shows rather than deleted from scan results at the native
   layer, so re-testing one later (see the investigation doc's open items) just means removing it
   from this list, not touching native/engine/vst3_host/. */
export const KNOWN_NONFUNCTIONAL_VST3_PLUGINS = new Set([
  // Confirmed via the bypass-parameter decisive test, including proper latency accounting and
  // multiple targeted parameter attempts (Sensitivity, Resolution, explicit AMP bypass) — output
  // stayed bit-identical every time. Root cause still open; see the investigation doc's Guitar
  // De-noise section before re-enabling.
  "RX 11 Guitar De-noise",
  // Utility/companion tools, not audio-effect plugins in the sense this picker means: RX Connect
  // routes audio to the standalone RX Application rather than processing inline; RX Monitor is a
  // metering tool; RX Spectral Editor is a visual editing surface, not an insertable effect.
  "RX 11 Connect",
  "RX 11 Monitor",
  "RX 11 Spectral Editor",
]);

export const filterUsableVstPlugins = (plugins) =>
  (Array.isArray(plugins) ? plugins : []).filter((plugin) => !KNOWN_NONFUNCTIONAL_VST3_PLUGINS.has(plugin?.name));
