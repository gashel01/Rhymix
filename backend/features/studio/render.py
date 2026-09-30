import subprocess
import uuid
from pathlib import Path

from backend.paths.manager import paths
from backend.features.studio.assets import probe_audio, resolve_asset_path


def _db_to_gain(db_value: float | None) -> float:
    try:
        return 10 ** (float(db_value or 0.0) / 20.0)
    except Exception:
        return 1.0


def _safe_stem_name(value: str, fallback: str) -> str:
    cleaned = "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in str(value or ""))
    cleaned = cleaned.strip("_")
    return cleaned or fallback


def _included_lanes(lanes: list) -> list:
    """Lanes that count towards a mix: solo wins, otherwise everything unmuted."""
    solo_lanes = {lane["id"] for lane in lanes if lane.get("solo")}
    if solo_lanes:
        return [lane for lane in lanes if lane.get("id") in solo_lanes]
    return [lane for lane in lanes if not lane.get("mute")]


def _wet_dry(filters: list, in_label: str, next_label, mix: float, effect_expr: str) -> str:
    """Split `in_label`, run one branch through `effect_expr`, blend it back
    with the untouched branch weighted by `mix`.

    Most of ffmpeg's audio filters have no "how much of this" knob of their
    own — aecho's out_gain, chorus's out_gain and so on all scale the whole
    processed signal, not the balance between it and the original. Splitting
    and re-mixing by hand is what makes a lane's "Mix" slider behave like the
    wet/dry knob on every other effect in every other DAW, uniformly across
    all four effects that have one, instead of four different approximations
    of it.
    """
    if mix <= 0:
        return in_label
    dry, wet_in, wet_out, dry_g, wet_g, out = (next_label() for _ in range(6))
    filters.append(f"[{in_label}]asplit=2[{dry}][{wet_in}]")
    filters.append(f"[{wet_in}]{effect_expr}[{wet_out}]")
    filters.append(f"[{dry}]volume={1 - mix:.4f}[{dry_g}]")
    filters.append(f"[{wet_out}]volume={mix:.4f}[{wet_g}]")
    filters.append(f"[{dry_g}][{wet_g}]amix=inputs=2:normalize=0:dropout_transition=0[{out}]")
    return out


def _fx_num(section: dict, key: str, default: float) -> float:
    """`section.get(key) or default` treats an explicit 0 the same as
    "unset" — Python's `or` doesn't know the difference, and a 0% Mix or a
    0-semitone Pitch Shift are both real, meaningful settings a slider can
    be dragged to, not the same thing as the key never having been touched."""
    value = section.get(key)
    return float(value) if value is not None else default


def _fx_enabled(section: dict | None) -> bool:
    return bool(section) and bool(section.get("enabled"))


def _apply_lane_fx(filters: list, in_label: str, fx: dict, next_label) -> str:
    """Chain a lane's configured effects onto `in_label`, in a fixed order,
    returning the label the signal ends up on.

    Gated on `enabled`, not mere key presence: useStudioPlayback.js — the
    Web Audio engine behind the in-browser preview, the other thing besides
    this module that ever turns a lane's fx record into sound — has always
    read it that way (see audioMath.js's resolveFxParams). A slider moving
    writes numbers into the record long before its switch is flipped on, and
    treating that key existing as "on" would have made a render sound
    different from what playing the same project back in the browser sounds
    like — the two silently disagreeing about what "off" means.
    """
    current = in_label

    pitch = fx.get("pitch")
    if pitch is not None:
        semitones = _fx_num(pitch, "semitones", 0)
        if semitones:
            ratio = 2 ** (semitones / 12.0)
            out = next_label()
            # Pitch without a tempo change: speed the signal up (which shifts
            # both pitch and tempo together), then stretch the tempo back
            # down by the same ratio. No rubberband/soundtouch dependency
            # required — standard ffmpeg build, at the cost of the light
            # artifacting this trick is known for on extreme shifts.
            filters.append(
                f"[{current}]asetrate=48000*{ratio:.6f},aresample=48000,atempo={1 / ratio:.6f}[{out}]"
            )
            current = out

    lowpass = fx.get("lowpass")
    if _fx_enabled(lowpass):
        cutoff = max(20.0, _fx_num(lowpass, "cutoff", 12000))
        out = next_label()
        filters.append(f"[{current}]lowpass=f={cutoff:.1f}[{out}]")
        current = out

    echo = fx.get("echo")
    if _fx_enabled(echo):
        delay_ms = max(1, int(_fx_num(echo, "time", 0.25) * 1000))
        feedback = min(0.9, max(0.0, _fx_num(echo, "feedback", 0.3)))
        mix = min(1.0, max(0.0, _fx_num(echo, "mix", 0.25)))
        current = _wet_dry(
            filters, current, next_label, mix, f"aecho=0.9:0.9:{delay_ms}:{feedback:.3f}"
        )

    reverb = fx.get("reverb")
    if _fx_enabled(reverb):
        decay = min(8.0, max(0.5, _fx_num(reverb, "decay", 2.5)))
        mix = min(1.0, max(0.0, _fx_num(reverb, "mix", 0.25)))
        # No convolution reverb without an impulse-response file to feed
        # afir — a short cascade of decaying echo taps approximates a
        # diffuse room instead of a single slap-back repeat, spread wider
        # as "Decay" grows the way a real reverb's tail would lengthen.
        taps_delay = "|".join(str(max(1, int(step * decay * 60))) for step in (1, 1.9, 3.1, 4.3))
        taps_decay = "|".join(f"{value:.3f}" for value in (0.5, 0.35, 0.22, 0.12))
        current = _wet_dry(
            filters, current, next_label, mix, f"aecho=0.9:0.9:{taps_delay}:{taps_decay}"
        )

    distortion = fx.get("distortion")
    if _fx_enabled(distortion):
        drive = min(100.0, max(0.0, _fx_num(distortion, "drive", 20)))
        amount = drive / 100.0
        boost = 1.0 + drive / 12.0
        current = _wet_dry(
            filters, current, next_label, amount, f"volume={boost:.4f},asoftclip=type=tanh"
        )

    chorus = fx.get("chorus")
    if _fx_enabled(chorus):
        rate = min(5.0, max(0.1, _fx_num(chorus, "rate", 0.8)))
        depth_ms = min(30.0, max(0.1, _fx_num(chorus, "depth", 0.012) * 1000))
        base_delay_ms = min(50.0, max(1.0, _fx_num(chorus, "time", 0.02) * 1000))
        mix = min(1.0, max(0.0, _fx_num(chorus, "mix", 0.3)))
        current = _wet_dry(
            filters,
            current,
            next_label,
            mix,
            f"chorus=0.6:0.9:{base_delay_ms:.2f}:{depth_ms:.2f}:{rate:.2f}:2",
        )

    return current


MASTER_PRESETS = {
    "spotify": -14.0,
    "apple_music": -16.0,
    "youtube": -14.0,
    "loud": -9.0,
}


def _master_filter(mix_label: str, filters: list, next_label, master: dict | None) -> str:
    """Loudness-normalize and true-peak-limit the final mix so the export is
    actually upload-ready, not just a technically-clean WAV. Uses ffmpeg's
    single-pass loudnorm — good enough for "hit the target and don't clip",
    not mastering-grade precision (that needs loudnorm's two-pass mode)."""
    if not master or not master.get("enabled"):
        return mix_label
    target_lufs = master.get("targetLufs")
    if target_lufs is None:
        target_lufs = MASTER_PRESETS.get(master.get("preset"), -14.0)
    true_peak_db = float(master.get("truePeakDb", -1.0))
    out = next_label()
    filters.append(
        f"[{mix_label}]loudnorm=I={float(target_lufs):.1f}:TP={true_peak_db:.1f}:LRA=11[{out}]"
    )
    return out


def _render_clips(
    clips: list,
    assets: dict,
    lane_gain: dict,
    output_name: str,
    lane_fx: dict | None = None,
    master: dict | None = None,
) -> dict:
    """Mix a set of clips down to one wav via a single ffmpeg pass.

    Clips are grouped by lane so a lane's effects (lane_fx) hear that lane's
    own finished arrangement — every one of its clips already trimmed, faded,
    gained and positioned on the timeline — the same signal a solo button
    would isolate, rather than one clip's audio in isolation.
    """
    lane_fx = lane_fx or {}
    inputs = []
    filters = []
    lane_clip_labels: dict[str, list] = {}
    lane_order: list = []
    label_counter = [0]

    def next_label():
        label_counter[0] += 1
        return f"l{label_counter[0]}"

    for clip in clips:
        path = resolve_asset_path(assets, clip.get("sourceAssetId"))
        if not path:
            continue

        idx = len(inputs)
        inputs.append(str(path))

        src_start = max(0.0, float(clip.get("srcStartSec") or 0.0))
        src_end = float(clip.get("srcEndSec") or 0.0)
        if src_end <= src_start:
            src_end = src_start + 0.01
        clip_len = max(0.01, src_end - src_start)
        timeline_start = max(0.0, float(clip.get("timelineStartSec") or 0.0))
        fade_in = max(0.0, float(clip.get("fadeInSec") or 0.0))
        fade_out = max(0.0, float(clip.get("fadeOutSec") or 0.0))
        lane_id = clip.get("laneId")
        lane_db = lane_gain.get(lane_id, 0.0)
        clip_db = float(clip.get("gainDb") or 0.0)
        gain = _db_to_gain(lane_db + clip_db)

        label = f"a{idx}"
        delay_ms = int(timeline_start * 1000)

        filter_parts = [
            f"[{idx}:a]atrim=start={src_start}:end={src_end}",
            "asetpts=PTS-STARTPTS",
        ]
        if fade_in > 0:
            filter_parts.append(f"afade=t=in:st=0:d={fade_in}")
        if fade_out > 0 and clip_len > fade_out:
            filter_parts.append(f"afade=t=out:st={clip_len - fade_out}:d={fade_out}")
        if gain != 1.0:
            filter_parts.append(f"volume={gain}")
        if delay_ms > 0:
            filter_parts.append(f"adelay={delay_ms}|{delay_ms}")
        # Filters inside one chain are comma-separated; ";" separates chains.
        # Joining with ";" turned the output pad into a chain of its own and
        # ffmpeg rejected the graph with "No such filter: ''".
        filters.append(f"{','.join(filter_parts)}[{label}]")

        if lane_id not in lane_clip_labels:
            lane_clip_labels[lane_id] = []
            lane_order.append(lane_id)
        lane_clip_labels[lane_id].append(label)

    if not inputs:
        raise RuntimeError("No audio sources found for render")

    lane_bus_labels = []
    for lane_id in lane_order:
        clip_labels = lane_clip_labels[lane_id]
        if len(clip_labels) == 1:
            bus = clip_labels[0]
        else:
            bus = next_label()
            joined = "".join(f"[{label}]" for label in clip_labels)
            filters.append(f"{joined}amix=inputs={len(clip_labels)}:normalize=0:dropout_transition=0[{bus}]")

        fx = lane_fx.get(lane_id)
        if fx:
            bus = _apply_lane_fx(filters, bus, fx, next_label)
        lane_bus_labels.append(bus)

    mix_label = "mixout"
    if len(lane_bus_labels) == 1:
        filters.append(f"[{lane_bus_labels[0]}]anull[{mix_label}]")
    else:
        labels_joined = "".join(f"[{label}]" for label in lane_bus_labels)
        filters.append(
            f"{labels_joined}amix=inputs={len(lane_bus_labels)}:normalize=0:dropout_transition=0[{mix_label}]"
        )

    mix_label = _master_filter(mix_label, filters, next_label, master)

    output_path = paths.EXPORT_DIR / output_name

    cmd = ["ffmpeg", "-y"]
    for inp in inputs:
        cmd += ["-i", inp]
    cmd += ["-filter_complex", ";".join(filters), "-map", f"[{mix_label}]", str(output_path)]

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "Render failed")

    info = probe_audio(output_path)
    return {
        "path": str(output_path),
        "url": f"/api/download/exports/{output_name}",
        "durationSec": info.get("durationSec", 0.0),
        "sampleRate": info.get("sampleRate"),
        "fileName": output_name,
    }


def render_mixdown(project_payload: dict, master: dict | None = None) -> dict:
    lanes = project_payload.get("lanes") or []
    clips = project_payload.get("clips") or []
    assets = project_payload.get("assets") or {}

    include_lanes = _included_lanes(lanes)
    include_lane_ids = {lane.get("id") for lane in include_lanes}
    lane_gain = {lane.get("id"): float(lane.get("gainDb") or 0.0) for lane in include_lanes}
    lane_fx = {lane.get("id"): lane["fx"] for lane in include_lanes if lane.get("fx")}

    usable_clips = [clip for clip in clips if clip.get("laneId") in include_lane_ids]
    if not usable_clips:
        raise RuntimeError("No clips available to render")

    return _render_clips(
        usable_clips,
        assets,
        lane_gain,
        f"studio_mix_{uuid.uuid4().hex}.wav",
        lane_fx=lane_fx,
        master=master,
    )


def render_stems(project_payload: dict) -> dict:
    """Render one file per lane instead of a single mix.

    This is what makes the arrangement usable outside the app: a mixdown is a
    finished artefact, stems are material you can take into a DAW. Lanes keep
    their own gain but are each rendered in isolation, so the files line up on
    a common timeline when re-imported.
    """
    lanes = project_payload.get("lanes") or []
    clips = project_payload.get("clips") or []
    assets = project_payload.get("assets") or {}

    # Solo is a monitoring state, not an export intent: honouring it here would
    # silently export a single lane. Muted lanes are an explicit "off", so those
    # are still skipped.
    include_lanes = [lane for lane in lanes if not lane.get("mute")]
    if not include_lanes:
        raise RuntimeError("No lanes available to render")

    batch = uuid.uuid4().hex[:8]
    stems = []
    skipped = []

    for position, lane in enumerate(include_lanes):
        lane_id = lane.get("id")
        lane_clips = [clip for clip in clips if clip.get("laneId") == lane_id]
        if not lane_clips:
            continue

        lane_gain = {lane_id: float(lane.get("gainDb") or 0.0)}
        lane_fx = {lane_id: lane["fx"]} if lane.get("fx") else {}
        stem_name = _safe_stem_name(lane.get("name"), f"lane{position + 1}")
        output_name = f"studio_stem_{batch}_{position + 1:02d}_{stem_name}.wav"

        try:
            rendered = _render_clips(lane_clips, assets, lane_gain, output_name, lane_fx=lane_fx)
        except RuntimeError as exc:
            # One unusable lane shouldn't lose the whole export.
            skipped.append({"lane": lane.get("name") or lane_id, "reason": str(exc)})
            continue

        rendered["laneId"] = lane_id
        rendered["laneName"] = lane.get("name")
        stems.append(rendered)

    if not stems:
        raise RuntimeError("No lane produced any audio to export")

    return {"stems": stems, "skipped": skipped, "count": len(stems)}
