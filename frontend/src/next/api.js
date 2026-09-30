/**
 * The new UI's view of the backend.
 *
 * One module, because the endpoints it wraps are spread across four Flask
 * blueprints and the shapes they return are not consistent with each other —
 * some keys are snake_case, some camelCase, some jobs carry `assets` and some
 * only carry a legacy `audio_url`. Normalising here means a view never has to
 * know which era of the API it is talking to.
 *
 * Nothing in here throws on a non-2xx by accident: every call either returns
 * data or throws an Error whose message is safe to show a user.
 */

const jsonHeaders = { "Content-Type": "application/json" };

async function request(url, options) {
  let response;
  try {
    response = await fetch(url, options);
  } catch (networkError) {
    throw new Error("Rhymix is not responding. Is the backend running?");
  }
  let body = null;
  try {
    body = await response.json();
  } catch (parseError) {
    body = null;
  }
  if (!response.ok) {
    const error = new Error((body && body.error) || `Request failed (${response.status})`);
    // A plain message loses "was this a 404 because the file is gone, or a
    // 500 because something broke" — callers that need to tell those apart
    // (a waveform that can't be drawn because there is nothing left to read,
    // versus one that just hasn't loaded yet) read this instead of parsing text.
    error.status = response.status;
    throw error;
  }
  return body;
}

const get = (url, signal) => request(url, { signal });
const post = (url, payload, signal) =>
  request(url, { method: "POST", headers: jsonHeaders, body: JSON.stringify(payload || {}), signal });

/* ------------------------------------------------------------------ songs */

/** Every asset a finished generation can carry, in the order a person reads them. */
export const ASSET_KEYS = [
  "full_mix",
  "instrumental",
  "vocals_raw",
  "vocals_rvc",
  "final_mix_rvc",
];

export const ASSET_LABELS = {
  full_mix: "Full mix",
  instrumental: "Instrumental",
  vocals_raw: "Vocals",
  vocals_rvc: "Vocals — converted",
  final_mix_rvc: "Full mix — converted",
};

const assetUrl = (assets, key) => {
  const asset = assets && assets[key];
  return asset && asset.ready ? asset.url : null;
};

/**
 * One generated song, in the shape the views want.
 *
 * The important part is `converted`: a generation run with one of your voices
 * selected produces the vocal twice — once as the model sang it, once re-sung
 * by your own model — plus a second mix. Those are not two tracks, they are one
 * performance in two voices, so they travel together on one record rather than
 * appearing as separate library entries.
 */
export const normaliseSong = (raw) => {
  if (!raw || typeof raw !== "object") return null;
  const assets = raw.assets && typeof raw.assets === "object" ? raw.assets : {};
  const vocalsRvc = assetUrl(assets, "vocals_rvc");
  const finalMixRvc = assetUrl(assets, "final_mix_rvc");
  const fullMix = assetUrl(assets, "full_mix");
  const score = raw.score && typeof raw.score === "object" ? raw.score : null;
  const derivation = raw.derivation_type || "original";

  const own = {
    songId: raw.id,
    mixUrl: fullMix || raw.audio_url || null,
    mixAsset: "full_mix",
    vocalsUrl: assetUrl(assets, "vocals_raw"),
    vocalsAsset: "vocals_raw",
    instrumentalUrl: assetUrl(assets, "instrumental"),
    instrumentalAsset: "instrumental",
  };

  // One switch, so one relationship: being re-sung outranks being derived. A
  // cover that was also converted shows original-against-voice, because that
  // is the pair someone is listening for.
  let takes;
  if (vocalsRvc) {
    takes = [
      takeFrom("original", "original", "--vox", { ...own, kind: "original" }),
      takeFrom("voice", raw.model_name || "my voice", "--conv", {
        ...own,
        kind: "voice",
        voice: raw.model_name || "my voice",
        mixUrl: finalMixRvc || own.mixUrl,
        mixAsset: "final_mix_rvc",
        vocalsUrl: vocalsRvc,
        vocalsAsset: "vocals_rvc",
      }),
    ];
  } else if (DERIVATION_TAKES[derivation]) {
    takes = [
      originalTake(raw.source),
      takeFrom(derivation, DERIVATION_TAKES[derivation], "--vox", { ...own, kind: "derived" }),
    ].filter(Boolean);
  } else {
    takes = [takeFrom("original", "original", "--vox", { ...own, kind: "original" })];
  }

  return {
    takes,
    id: raw.id,
    title: raw.title || "Untitled",
    status: raw.status || "queued",
    progress: Number(raw.progress) || 0,
    statusMessage: raw.status_message || "",
    error: raw.error || null,
    createdAt: raw.created_at || null,
    completedAt: raw.completed_at || null,

    // Which of your voices sang it, if any. Null means it kept the model's own.
    voice: raw.model_name || null,
    // Why that voice never made it onto the track, when it was asked for —
    // the backend only ever sets this once the take is already missing, so
    // its presence and the take's absence say the same thing twice.
    voiceError: raw.voice_error || null,

    instrumental: assetUrl(assets, "instrumental"),
    vocals: assetUrl(assets, "vocals_raw"),
    // `converted` is only ever set when a voice model actually ran.
    converted: vocalsRvc,
    mix: finalMixRvc || assetUrl(assets, "full_mix") || raw.audio_url || null,
    originalMix: assetUrl(assets, "full_mix") || raw.audio_url || null,
    convertedMix: finalMixRvc,

    score: score
      ? { abc: score.url_abc || null, midi: score.url_midi || null }
      : null,

    derivation,
    instrumentalOnly: Boolean(raw.instrumental_only),
    sourceTitle: raw.source_title || (raw.source && raw.source.title) || null,
    sourceSongId: raw.source_song_id || null,
    // The take a derivation was made *from* — kept outside the vocalsRvc/
    // DERIVATION_TAKES switch above so it survives a voice being applied.
    // "one switch" governs which pair a row's player toggles between; this
    // is a separate lookup, for things like "play the hum I recorded".
    sourceRef: originalTake(raw.source),

    // Null until one has been drawn. Cover art runs on the CPU after the song
    // lands, so a fresh track shows its gradient for a few seconds first.
    cover: raw.cover_url || null,

    // Only the detail endpoint carries this; the list leaves it out so a
    // library of fifty tracks is not fifty sets of lyrics over the wire.
    recipe: raw.recipe && typeof raw.recipe === "object" ? raw.recipe : null,
  };
};

/* ------------------------------------------------------------------ takes */

/**
 * The versions of a track you can switch between.
 *
 * Every track has at least one, and the first is always the original — the
 * audio an operation was performed *on*. A voice conversion, a cover and a
 * lyric rewrite each add a second take beside it, so the row can answer "what
 * did this sound like before?" without leaving the library.
 *
 * A take is self-describing: which library id its waveforms come from, which
 * asset of that id, and the audio behind each. That is what lets the original
 * of a conversion live in a completely different track's directory while the
 * row draws both of them the same way.
 */
const DERIVATION_TAKES = { cover: "cover", lyric_rewrite: "rewrite", hum: "song" };

const takeFrom = (key, label, tint, parts) => ({ key, label, tint, ...parts });

/**
 * Name the takes, once they are all on the same row.
 *
 * A voice that appears once is just its own name; the same voice tried several
 * times becomes "anne v1", "anne v2". Numbering only when there is something
 * to number keeps the common row — one original, one voice — reading as plain
 * English instead of as a version log.
 */
const labelTakes = (takes) => {
  const total = {};
  takes.forEach((item) => {
    if (item.kind === "voice") total[item.voice] = (total[item.voice] || 0) + 1;
  });
  const seen = {};
  return takes.map((item) => {
    if (item.kind !== "voice") return item;
    const index = (seen[item.voice] = (seen[item.voice] || 0) + 1);
    return { ...item, label: total[item.voice] > 1 ? `${item.voice} v${index}` : item.voice };
  });
};

/**
 * One row per track and voice.
 *
 * A conversion is not a second track — it is a track sung differently — so it
 * belongs on the row of whatever it was sung over rather than under a title of
 * its own. But one row cannot hold two different voices: "original, anne,
 * dualipaimported" asks you to compare three things that are not comparable,
 * and hides that two separate pieces of work happened. So a track sung in two
 * voices becomes two rows, each offering its original and that one voice.
 *
 * Several runs of the *same* voice do share a row: those are versions of one
 * attempt — you nudged the pitch and ran it again — and that is exactly what
 * the v1/v2 pills are for.
 *
 * Anything whose source is no longer in the library keeps a row of its own,
 * because there is nowhere else for it to go.
 */
/**
 * The universal reference key for a row: what its own children point back to
 * as their parent, and what a "cover of X" / "from X" link is made of. Songs
 * carry a bare job id everywhere else in this module, but a parent reference
 * always needs the prefix — bare and prefixed can collide across kinds
 * otherwise, and this is the one place both directions have to agree.
 */
export const trackKey = (row) =>
  row.kind === "upload" || row.kind === "conversion" ? row.id : `songgen:${row.id}`;

export const mergeLibrary = (songs, uploads, conversions) => {
  // A hum recording is scratch material for the song it seeds, not a track
  // in its own right the way an import is — once a song has been generated
  // from it, its own row would just be the same "original" take that song's
  // take switcher already offers, one hop away, under the same title. It
  // stays a normal row (and stays pickable from Create's own picker) for as
  // long as nothing has actually used it yet.
  const consumedHumSources = new Set(
    songs.filter((song) => song.derivation === "hum" && song.sourceSongId).map((song) => song.sourceSongId)
  );
  const visibleUploads = uploads.filter((upload) => !consumedHumSources.has(upload.id));

  const hosts = new Map();
  const bases = [...songs, ...visibleUploads];
  bases.forEach((track) => hosts.set(track.id, { ...track, takes: [...track.takes] }));

  const orphans = [];
  conversions.forEach((group) => {
    const host = group.sourceId ? hosts.get(group.sourceId) : null;
    if (!host) {
      orphans.push({ ...group, rowId: group.id, takes: labelTakes(group.takes) });
      return;
    }
    host.takes.push(...group.voiceTakes);
  });

  const rows = [];
  hosts.forEach((track) => {
    // Everything that is not a voice: the link to this track's own parent
    // (cheap — a reference, safe to repeat), and, if this track is itself a
    // cover or a rewrite, its own performance (a real recording, not a
    // reference). `home` is at most two items, and the anchor a voice row
    // hangs off is only ever the LAST one — its own performance one hop back,
    // never the whole chain to whatever that was in turn derived from. A
    // voice row is never allowed to carry more than one anchor: that was the
    // bug, the entire `home` array — reference and recording both — copied
    // into every voice split, which put the same cover on screen twice.
    const home = track.takes.filter((item) => item.kind !== "voice");
    const voiced = track.takes.filter((item) => item.kind === "voice");
    const anchor = home[home.length - 1];
    // A plain song's `home` is one item — the bare original pill, which the
    // voice rows already carry as their own anchor. Giving it a row of its
    // own would just be that same pill again with nothing beside it. A cover
    // or rewrite's `home` is two — the link back, and the performance itself
    // — and that performance is worth a row: "what this sounded like before
    // any voice" is a real, distinct thing to listen to.
    const isDerived = home.length > 1;

    if (!voiced.length) {
      rows.push({ ...track, rowId: track.id, takes: home, runIds: [], ownsSong: true });
      return;
    }
    if (isDerived) {
      rows.push({ ...track, rowId: track.id, takes: home, runIds: [], ownsSong: true });
    }

    // Group by voice, keeping the order they were made in.
    const byVoice = new Map();
    voiced.forEach((item) => {
      const list = byVoice.get(item.voice);
      if (list) list.push(item);
      else byVoice.set(item.voice, [item]);
    });
    byVoice.forEach((takes, voice) => {
      const runIds = takes.map((item) => item.runId).filter(Boolean);
      // A voice row is as new as the most recent thing done on it — usually a
      // conversion run made long after the song itself, which is what "newest
      // first" means to someone scanning the library. Falls back to the
      // song's own date when a take never got one of its own.
      const rowCreatedAt = [track.createdAt, ...takes.map((item) => item.createdAt)]
        .filter(Boolean)
        .sort()
        .pop();
      rows.push({
        ...track,
        rowId: `${track.id}::${voice}`,
        takes: labelTakes([anchor, ...takes]),
        voice,
        runIds,
        createdAt: rowCreatedAt || track.createdAt,
        // Whether this row is the track itself or only work done on it. A row
        // made purely of conversion runs can be deleted without touching the
        // song they were sung over — which is what you mean when you delete
        // one voice and keep the other.
        ownsSong: runIds.length !== takes.length,
      });
    });
  });

  return [...rows, ...orphans]
    .map((row) => (row.takes ? { ...row, takes: labelTakes(row.takes) } : row))
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
};

const originalTake = (source) =>
  source && (source.mixUrl || source.vocalsUrl)
    ? takeFrom("original", "original", "--vox", {
        kind: "original",
        songId: source.id,
        mixUrl: source.mixUrl,
        mixAsset: source.mixAsset || "full_mix",
        vocalsUrl: source.vocalsUrl,
        vocalsAsset: source.vocalsAsset || "vocals_raw",
        instrumentalUrl: source.instrumentalUrl,
        instrumentalAsset: source.instrumentalAsset || "instrumental",
      })
    : null;

export const MODE_LABELS = {
  0: "Melody and chords",
  1: "Melody only",
  2: "Direct generation",
};

export const isSongDone = (song) => song && song.status === "completed";
export const isSongFailed = (song) => song && song.status === "failed";
export const isSongRunning = (song) => song && !isSongDone(song) && !isSongFailed(song);

export const listSongs = async (signal) => {
  const body = await get("/api/song-generation/jobs", signal);
  const jobs = Array.isArray(body) ? body : body && body.jobs;
  return (jobs || [])
    .map(normaliseSong)
    .filter(Boolean)
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
};

export const getSong = async (jobId, signal) =>
  normaliseSong(await get(`/api/song-generation/${encodeURIComponent(jobId)}`, signal));

export const startSong = (params, signal) => post("/api/song-generation/start", params, signal);

/**
 * Delete a track, whatever kind it is.
 *
 * Three kinds, three endpoints. Sending every id to the song-generation route
 * meant deleting an import or a conversion asked the server for a job that
 * does not exist, got a 404, and reported a failure for a row that was still
 * there afterwards.
 *
 * A conversion row stands for every version behind it, so all of them go.
 */
/** Delete specific conversion runs and nothing else. */
export const deleteRuns = (runIds) => post("/api/delete-inference-runs", { runIds });

/**
 * Drop the voice a song was generated with, keeping the song.
 *
 * The take a generation produced is not a run — it lives in the song's own
 * directory — so removing it is a different request from removing an
 * inference. What is left is the original, and whatever was converted after.
 */
export const deleteSongConversion = (jobId) =>
  request(`/api/song-generation/${encodeURIComponent(jobId)}/conversion`, { method: "DELETE" });

export const deleteSong = async (track) => {
  const id = String(typeof track === "string" ? track : track?.id || "");
  const runIds = typeof track === "object" && Array.isArray(track?.runIds) ? track.runIds : [];
  // A row that is only work done on a track — one voice among several — takes
  // its own runs with it and leaves the track alone. Deleting "anne" must not
  // take "dualipaimported" and the song with it.
  if (runIds.length && !id.startsWith("run:") && track?.ownsSong === false) {
    return post("/api/delete-inference-runs", { runIds });
  }
  // Otherwise the row is the track, and its conversions go too: left behind
  // they would have no source and would come back as rows of their own.
  if (runIds.length && !id.startsWith("run:")) {
    await post("/api/delete-inference-runs", { runIds }).catch(() => null);
  }
  if (id.startsWith("run:")) {
    return post("/api/delete-inference-runs", {
      runIds: runIds.length ? runIds : [id.slice(4)],
    });
  }
  if (id.startsWith("upload:")) {
    return request(`/api/uploads/${encodeURIComponent(id.slice(7))}`, { method: "DELETE" });
  }
  return request(`/api/song-generation/delete/${encodeURIComponent(id)}`, { method: "DELETE" });
};

/**
 * Regenerate a song with new words over the same music.
 *
 * This is the whole point of keeping the score: the engine is handed back the
 * notes it wrote last time, so the melody, the chords and the arrangement
 * survive and only the lyrics change.
 */
export const rewriteLyrics = (jobId, lyrics, title, signal) =>
  post(
    `/api/song-generation/${encodeURIComponent(jobId)}/rewrite-lyrics`,
    title ? { lyrics, title } : { lyrics },
    signal
  );

export const listProviders = (signal) => get("/api/song-generation/providers", signal);

/* ------------------------------------------------------------- cover art */

/**
 * Redraw one track's cover. Returns as soon as the work is queued.
 *
 * A conversion normally wears its source's cover rather than owning one - see
 * `song.cover` before calling this for one, and don't if it's already set,
 * the same check the backend itself makes. This only exists for when that
 * inheritance comes up empty (the source has no cover and never can, an
 * upload deleted out from under it, say): the run gets one of its own rather
 * than staying blank forever for something it has no control over.
 */
export const makeCover = (trackId, seed) => {
  const id = String(trackId || "");
  const body = seed == null ? {} : { seed };
  if (id.startsWith("run:")) {
    return post(`/api/inference/${encodeURIComponent(id.slice(4))}/cover`, body);
  }
  if (id.startsWith("upload:")) {
    return post(`/api/uploads/${encodeURIComponent(id.slice(7))}/cover`, body);
  }
  return post(`/api/song-generation/${encodeURIComponent(id)}/cover`, body);
};

/** Draw a cover for every song that has none. */
export const startCoverBackfill = () => post("/api/cover-art/backfill", {});
export const coverBackfillStatus = (signal) => get("/api/cover-art/backfill", signal);

/* ----------------------------------------------------------------- voices */

/** Trained RVC voices. The backend calls them models; people call them voices. */
export const listVoices = async (signal) => {
  const body = await get("/api/available-models", signal);
  const models = Array.isArray(body) ? body : (body && (body.models || body.available_models)) || [];
  return models
    .map((model) => {
      if (typeof model === "string") return { id: model, name: model, epochs: null, checkpoints: [] };
      // Every epoch a run saved is kept on disk, so a voice that drifted too
      // far can be rolled back rather than retrained. They arrive newest-first.
      const checkpoints = (Array.isArray(model.checkpoints) ? model.checkpoints : []).filter(
        (checkpoint) => checkpoint && checkpoint.path
      );
      return {
        id: model.modelId || model.id || model.model_name || model.name,
        name: model.name || model.model_name || model.modelId,
        epochs: model.epochs ?? model.epoch ?? null,
        sizeMb: Number(model.size_mb) || null,
        sampleRate: model.sampleRate || null,
        createdAt: model.created || null,
        status: model.status || "completed",
        checkpoints: checkpoints.map((checkpoint) => ({
          epochs: checkpoint.epochs,
          isBest: Boolean(checkpoint.isBest),
          sizeMb: Number(checkpoint.size_mb) || null,
          path: checkpoint.path,
          filename: checkpoint.filename,
        })),
        // What a job has to carry for the voice conversion to actually run.
        // `model_name` alone is not enough: the RVC step reads params["model"]
        // and returns silently when it is missing, which looks exactly like a
        // generation that simply chose not to convert anything.
        forInference: {
          name: model.name,
          indexPath: model.indexPath,
          checkpoints,
          selectedCheckpoint: checkpoints.find((c) => c.isBest) || checkpoints[0] || null,
        },
      };
    })
    .filter((voice) => voice.id);
};

/* ------------------------------------------------------- voices, online */

/**
 * Search the voice-models.com directory.
 *
 * The backend scrapes an HTML table out of that site, so a 500 here usually
 * means the directory changed its markup rather than that anything local is
 * wrong — the error message says which, and is worth showing verbatim.
 */
export const searchOnlineVoices = async (query, page = 1, signal) => {
  const text = String(query || "").trim();
  if (!text) return { models: [], totalPages: 1, page: 1 };
  const body = await get(
    `/api/search-online-models?query=${encodeURIComponent(text)}&page=${encodeURIComponent(page)}`,
    signal
  );
  return {
    models: (body.models || []).map((model) => ({
      name: model.name,
      url: model.url,
      modelId: model.modelId,
      author: model.author,
      tags: Array.isArray(model.tags) ? model.tags : [],
      epochs: model.epochs ?? null,
      sizeMb: model.size_mb ? Number(model.size_mb) : null,
      files: model.files || {},
    })),
    totalPages: Number(body.total_pages) || 1,
    page: Number(body.current_page) || Number(page) || 1,
  };
};

/**
 * Start downloading a directory voice.
 *
 * `localName` becomes the folder it installs into, so it is what the voice will
 * be called everywhere afterwards — the directory's own titles are long and
 * full of punctuation, which is why this is asked rather than derived.
 */
export const downloadVoice = (model, localName) =>
  post("/api/download-model", {
    url: model.url,
    modelName: model.name,
    modelId: model.modelId,
    userQuery: localName,
    files: model.files || {},
  });

export const downloadStatus = (jobId, signal) =>
  get(`/api/models/download/status/${encodeURIComponent(jobId)}`, signal);

export const isDownloadRunning = (job) =>
  job && job.status !== "completed" && job.status !== "failed";

/* ---------------------------------------------------------------- library */

/**
 * Add audio to the library.
 *
 * Multipart, so it does not go through `request()` — that one sets a JSON
 * content type, and setting any content type by hand on a FormData body
 * strips the multipart boundary the server needs to parse it.
 */
export const uploadFiles = async (files) => {
  const form = new FormData();
  Array.from(files || []).forEach((file) => form.append("files", file));
  let response;
  try {
    response = await fetch("/api/upload", { method: "POST", body: form });
  } catch (networkError) {
    throw new Error("Rhymix is not responding. Is the backend running?");
  }
  let body = null;
  try {
    body = await response.json();
  } catch (parseError) {
    body = null;
  }
  if (!response.ok) throw new Error((body && body.error) || `Upload failed (${response.status})`);
  return body?.files || [];
};

/**
 * Tracks you imported, in the same shape as a generated one.
 *
 * Deliberately not /api/available-files: that endpoint hides anything without
 * separated stems, because it was written for the processing screen where an
 * unprocessed file is not yet work. In a library it is a track, and one that
 * vanishes the moment you import it reads as a failed import.
 *
 * The shape matches `normaliseSong` closely enough that the list, the row and
 * the waveform pair all render an upload without knowing what it is. `kind`
 * is what tells the few places that do care.
 */
export const listUploads = async (signal) => {
  const body = await get("/api/uploads", signal);
  return (body?.uploads || [])
    .filter((file) => file.hasAudio)
    .map((file) => ({
      kind: "upload",
      id: `upload:${file.fileId}`,
      // An import has one version of itself and no history: the file you
      // brought in is the original, and the selector says exactly that.
      takes: [
        takeFrom("original", "original", "--vox", {
          kind: "original",
          songId: `upload:${file.fileId}`,
          mixUrl: file.audioUrl,
          mixAsset: "full_mix",
          vocalsUrl: file.vocalsUrl,
          vocalsAsset: "vocals_raw",
          instrumentalUrl: file.instrumentalUrl,
          instrumentalAsset: "instrumental",
        }),
      ],
      fileId: file.fileId,
      title: file.name || file.originalName || "Imported track",
      status: "completed",
      progress: 100,
      createdAt: file.createdAt || null,

      voice: null,
      converted: null,
      instrumental: file.instrumentalUrl,
      vocals: file.vocalsUrl,
      mix: file.audioUrl,
      originalMix: file.audioUrl,
      convertedMix: null,

      score: null,
      recipe: null,
      derivation: "upload",
      sourceTitle: null,

      // Drawn from the filename when the track was imported; null until it
      // lands, which takes a couple of seconds of CPU.
      cover: file.coverUrl || null,

      // null when it has never been through separation; otherwise the
      // pipeline's own state, which is what the row polls on.
      processing: file.processing || null,
    }));
};

/**
 * Split an imported track into vocals and instrumental.
 *
 * Same UVR pipeline the generator uses on its own output — which is why an
 * upload ends up displaying, playing and training exactly like a generated
 * song once this has run. Returns as soon as the work is queued; the upload's
 * `processing` field is how you follow it.
 */
export const separateUpload = (fileId) =>
  post("/api/process", { fileIds: [fileId], process: true, segment: false, export: false, clean: false });

/** Per-file processing state, for the few ids you are watching. */
export const uploadStatuses = async (fileIds, signal) => {
  const ids = (fileIds || []).filter(Boolean);
  if (!ids.length) return {};
  const body = await get(`/api/tracks/status?ids=${encodeURIComponent(ids.join(","))}`, signal);
  const rows = Array.isArray(body) ? body : [];
  return Object.fromEntries(rows.map((row) => [row.trackId, row.processing || null]));
};

/* ------------------------------------------------------------- inference */

/**
 * Re-sing an existing vocal with one of your voices.
 *
 * The track object is the minimum the backend resolves an input from: a
 * fileId, and which of the two vocal folders to read it from. That is the same
 * shape the song pipeline builds for its own output, so anything the library
 * can separate can be converted.
 */
export const startInference = (model, track, params) =>
  post("/api/start-inference", { model, track, params: params || {} });

/**
 * Finished conversions, in the library's shape.
 *
 * A run is a third kind of track: not generated, not imported, but made from
 * one of those by re-singing it. It has one file — the converted vocal — so it
 * shows as a single waveform rather than a pair.
 */
/**
 * Conversions, grouped into one row per track-and-voice.
 *
 * Re-singing the same vocal with the same model twice is not two tracks. It is
 * the same idea attempted twice — you nudged the pitch, or the index rate, and
 * ran it again — and listing both as separate library entries buried the
 * original under near-duplicates of itself. They become versions on one row
 * instead: v1, v2, v3, with the newest selected, next to the original they
 * were all sung over.
 *
 * Runs whose source is unknown group under their own id, so an orphan is never
 * folded into someone else's row.
 */
export const listInferenceRuns = async (signal) => {
  const body = await get("/api/past-inference-results", signal);
  const runs = (body?.results || []).map((run) => {
    const asset = (kind) => `/api/inference/${encodeURIComponent(run.runId)}/audio/${kind}`;
    // The run always has a vocal. It has an instrumental and a mix when the
    // track it was sung over had music to find — which is the normal case, and
    // is what makes a conversion a track rather than a loose a cappella.
    const vocals = asset("vocals");
    const instrumental = run.hasInstrumental ? asset("instrumental") : null;
    return {
      raw: run,
      groupKey: `${run.songJobId || run.inputFileId || run.sourceRunId || run.runId}::${
        run.modelName || ""
      }`,
      vocals,
      instrumental,
      mix: run.hasMix ? asset("mix") : vocals,
    };
  });

  const groups = new Map();
  runs.forEach((item) => {
    const list = groups.get(item.groupKey);
    if (list) list.push(item);
    else groups.set(item.groupKey, [item]);
  });

  return Array.from(groups.values()).map((versions) => {
    // The backend sorts newest first; versions read oldest first, so v1 is the
    // first attempt and the last pill is the one you just ran.
    const ordered = [...versions].reverse();
    const newest = ordered[ordered.length - 1];
    const run = newest.raw;
    const sourceName =
      run.inputDisplayName || run.inputOriginalName || run.songJobId || "a track";

    // Named by labelTakes once the row they belong to is known: folded into
    // their source's row they sit beside whatever else was done to it, and
    // numbering only makes sense against that whole set.
    const voiceTakes = ordered.map((item) =>
      takeFrom(`run:${item.raw.runId}`, item.raw.modelName || "my voice", "--conv", {
        kind: "voice",
        voice: item.raw.modelName || "my voice",
        runId: item.raw.runId,
        songId: `run:${item.raw.runId}`,
        mixUrl: item.mix,
        mixAsset: "final_mix_rvc",
        vocalsUrl: item.vocals,
        vocalsAsset: "vocals_rvc",
        instrumentalUrl: item.instrumental,
        instrumentalAsset: "instrumental",
        // So a row built from this take (see mergeLibrary) can sort by when
        // the conversion actually happened, not the original song's own age.
        createdAt: item.raw.createdAt || null,
      })
    );
    const takes = [originalTake(run.source), ...voiceTakes].filter(Boolean);

    return {
      kind: "conversion",
      // The library row these belong on, when it is still there. Null means
      // the source is gone and this has to stand on its own.
      sourceId: run.source ? run.source.id : null,
      voiceTakes,
      id: `run:${run.runId}`,
      // Every run behind this row, newest last. Deleting the row means all of
      // them: the row *is* the group, and leaving orphans behind would make it
      // reappear empty.
      runIds: ordered.map((item) => item.raw.runId),
      takes,
      runId: run.runId,
      title: `${sourceName} — ${run.modelName}`,
      status: "completed",
      progress: 100,
      createdAt: run.createdAt || null,

      voice: run.modelName || null,
      // `converted` stays null: there is one voice here and no second take of
      // the same audio to switch between. What marks this as your voice is
      // `kind` and `voice`.
      converted: null,
      vocals: newest.vocals,
      instrumental: newest.instrumental,
      mix: newest.mix,
      originalMix: null,
      convertedMix: newest.mix,

      score: null,
      recipe: null,
      derivation: "conversion",
      sourceTitle: run.inputDisplayName || null,

      // Inherited from the track it re-sang: same song, different voice.
      cover: run.coverUrl || null,
      params: run.params || null,
    };
  });
};

export const inferenceStatus = (jobId, signal) =>
  get(`/api/inference-status/${encodeURIComponent(jobId)}`, signal);

/** Conversions still running server-side — how the library rebuilds its
 * "Converting" placeholder after a refresh, since the job that started it
 * was never anything but local component state until now. */
export const listActiveInferenceJobs = async (signal) => {
  const body = await get("/api/inference-jobs", signal);
  return Array.isArray(body?.jobs) ? body.jobs : [];
};

export const isInferenceRunning = (job) =>
  job && !["completed", "failed", "error", "cancelled"].includes(String(job.status || ""));

/** Sensible starting point; every one of these is a real backend parameter. */
export const INFERENCE_DEFAULTS = {
  pitch: 0,
  indexRate: 0.75,
  volumeEnvelope: 1,
  protectVoiced: 0.5,
  f0Method: "rmvpe",
  // Off by default: shifting formants on a conversion that did not need it
  // distorts a timbre that was fine.
  formantShifting: false,
  formantQfrency: 1.0,
  formantTimbre: 1.0,
};

export const F0_METHODS = ["rmvpe", "crepe", "fcpe", "harvest", "pm"];

/* --------------------------------------------------------------- waveform */

/**
 * Peaks for one asset of a generated song, or null when there are none.
 *
 * The backend computes these once and caches them, so this costs a few KB
 * rather than the whole WAV. Failure returns null rather than throwing: a
 * missing waveform should cost you a nice picture, not the ability to play.
 *
 * The payload is one flat [min, max, min, max, ...] array per channel; we only
 * ever draw the first, since a stereo mix and its mono fold look the same at
 * this size.
 */
/* Peaks are requested twice for the same asset — once to draw the waveform,
   once to put a duration in the row — and a library of twenty tracks would make
   forty requests for twenty answers. The response never changes for a given
   asset, so one in-flight promise per key is shared by every caller. */
const peaksCache = new Map();

/* A conversion and an import both hold the same three tracks as a generated
   song, under their own names. Every caller speaks in asset keys, so the
   translation lives here — asking an upload for "vocals_raw" used to 404 and
   leave an empty box where a waveform belonged. */
const RUN_KINDS = {
  full_mix: "mix",
  final_mix_rvc: "mix",
  instrumental: "instrumental",
  vocals_raw: "vocals",
  vocals_rvc: "vocals",
};

const UPLOAD_KINDS = {
  full_mix: "",
  final_mix_rvc: "",
  instrumental: "/instrumental",
  vocals_raw: "/vocals",
  vocals_rvc: "/vocals",
};

export const fetchPeaks = async (jobId, assetKey, signal) => {
  if (!jobId || !assetKey) return null;
  const cacheKey = `${jobId}/${assetKey}`;
  if (peaksCache.has(cacheKey)) return peaksCache.get(cacheKey);
  // Deliberately not passing `signal` into the shared promise: one component
  // unmounting must not cancel the fetch the others are still waiting on.
  const pending = fetchPeaksUncached(jobId, assetKey);
  peaksCache.set(cacheKey, pending);
  return pending;
};

async function fetchPeaksUncached(jobId, assetKey) {
  try {
    // Three kinds of track, three routes, one cache. The id's own prefix says
    // which: an import, a conversion run, or a generated song.
    const id = String(jobId);
    const url = id.startsWith("upload:")
      ? `/api/uploads/${encodeURIComponent(id.slice(7))}/waveform${
          UPLOAD_KINDS[assetKey] ?? ""
        }`
      : id.startsWith("run:")
      ? `/api/inference/${encodeURIComponent(id.slice(4))}/waveform/${RUN_KINDS[assetKey] || "mix"}`
      : `/api/song-generation/${encodeURIComponent(id)}/waveform/${encodeURIComponent(assetKey)}`;
    const body = await get(url);
    const channels = body && body.peaks;
    const first = Array.isArray(channels) ? channels[0] : null;
    if (!Array.isArray(first) || !first.length) return null;
    return { peaks: first, duration: Number(body.duration) || 0 };
  } catch (error) {
    // A 404 here means the backend looked and there is genuinely no file to
    // read - an upload's audio deleted out from under its own record, say.
    // Worth telling apart from "hasn't loaded yet" or a transient network
    // hiccup, which look the same but aren't permanent.
    if (error.status === 404) return { missing: true };
    return null;
  }
}

/** Forget a song's cached peaks — after a delete, or a regeneration. */
export const forgetPeaks = (jobId) => {
  Array.from(peaksCache.keys())
    .filter((key) => key.startsWith(`${jobId}/`))
    .forEach((key) => peaksCache.delete(key));
};

/* --------------------------------------------------------------- training */

/** A training run — what a poll loop needs to decide progress and whether to keep going. */
const normaliseTrainingJob = (raw) => {
  if (!raw || typeof raw !== "object" || !raw.id) return null;
  return {
    id: raw.id,
    modelName: raw.model_name || "",
    status: raw.status || "queued",
    progress: Number(raw.progress) || 0,
    logs: Array.isArray(raw.logs) ? raw.logs : [],
    startedAt: raw.started_at || null,
    completedAt: raw.completed_at || null,
    error: raw.error || null,
  };
};

const TRAINING_TERMINAL = ["completed", "failed", "cancelled", "interrupted"];
export const isTrainingRunning = (job) => Boolean(job) && !TRAINING_TERMINAL.includes(job.status);
export const isTrainingFailed = (job) =>
  Boolean(job) && ["failed", "cancelled", "interrupted"].includes(job.status);

/** Every run the backend still remembers — live or finished — newest first. */
export const listTrainingJobs = async (signal) => {
  const body = await get("/api/training-jobs", signal);
  return (Array.isArray(body?.jobs) ? body.jobs : [])
    .map(normaliseTrainingJob)
    .filter(Boolean)
    .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
};

export const getTrainingStatus = async (jobId, signal) =>
  normaliseTrainingJob(await get(`/api/training-status/${encodeURIComponent(jobId)}`, signal));

/**
 * Upload the dataset a training run will learn from.
 *
 * Multipart, not JSON — the backend reads `request.files.getlist("vocals")`,
 * so this bypasses `post()`'s JSON body entirely and lets the browser set its
 * own boundary header.
 */
export const prepareTrainingDataset = (modelName, files, sampleRate, signal) => {
  const formData = new FormData();
  files.forEach((file) => formData.append("vocals", file));
  formData.append("modelName", modelName);
  formData.append("sampleRate", String(sampleRate));
  return request("/api/prepare-training-dataset", { method: "POST", body: formData, signal });
};

export const startTraining = (params, signal) => post("/api/start-training", params, signal);

export const cancelTraining = (jobId) =>
  post(`/api/training-jobs/${encodeURIComponent(jobId)}/cancel`, {});

/* -------------------------------------------------------------- diarisation */

const normaliseTalkingStatus = (raw) => ({
  status: (raw && raw.status) || "unknown",
  statusMessage: (raw && raw.status_message) || "",
  error: (raw && raw.error) || null,
});

/** Every terminal state the backend actually returns — not just the two obvious ones. */
export const TALKING_TERMINAL = [
  "completed",
  "completed_but_no_speakers",
  "completed_but_no_directory",
  "failed",
  "error",
];
export const isTalkingDone = (job) => Boolean(job) && TALKING_TERMINAL.includes(job.status);
export const isTalkingFailed = (job) => Boolean(job) && job.status !== "completed" && isTalkingDone(job);

export const uploadTalkingFile = (file, signal) => {
  const formData = new FormData();
  formData.append("audio", file);
  return request("/api/upload-talking", { method: "POST", body: formData, signal });
};

export const getTalkingStatus = async (jobId, signal) =>
  normaliseTalkingStatus(await get(`/api/talking-status/${encodeURIComponent(jobId)}`, signal));

/** Speaker splits diarisation has already produced, read straight off disk. */
export const listTalkingDatasets = async (signal) => {
  const body = await get("/api/available-talking-datasets", signal);
  return (Array.isArray(body?.datasets) ? body.datasets : []).map((row) => ({
    id: row.name,
    name: row.name,
    speakerCount: Number(row.speaker_count) || 0,
    sampleCount: Number(row.sample_count) || 0,
  }));
};

const basename = (path) => String(path || "").split(/[\\/]/).pop();

/**
 * A playable/downloadable URL for one segment.
 *
 * `/api/speaker-samples` hands back its own `url` per segment, built as
 * `/api/play-segment/<file>?path=...` — but the endpoint that serves the
 * file never reads `path`; it wants `speaker` and `job_id` query params.
 * That payload field 404s. This builds the request the endpoint actually
 * understands instead of trusting it.
 */
export const segmentUrl = (datasetName, speakerId, filename) =>
  `/api/play-segment/${encodeURIComponent(filename)}?speaker=${encodeURIComponent(
    speakerId
  )}&job_id=${encodeURIComponent(`dataset-${datasetName}`)}`;

/** Speaker folders are named speaker_01, speaker_02, ... by the diarisation
 * script itself — every other route on this dataset zero-pads the same way.
 * Nothing serves the list of names, only a count, so this rebuilds it. */
export const speakerIds = (count) =>
  Array.from({ length: Math.max(0, count) }, (_, i) => `speaker_${String(i + 1).padStart(2, "0")}`);

export const listSpeakerSamples = async (datasetName, speakerId, signal) => {
  const body = await get(
    `/api/speaker-samples/${encodeURIComponent(`dataset-${datasetName}`)}/${encodeURIComponent(speakerId)}`,
    signal
  );
  return (Array.isArray(body?.samples) ? body.samples : []).map((row) => ({
    id: row.id,
    name: row.name,
    duration: Number(row.duration) || 0,
    url: segmentUrl(datasetName, speakerId, basename(row.path)),
  }));
};
