"""Characterisation tests for the studio render and MIDI export paths.

These describe what the code does today, so a refactor has something to answer
to. They are deliberately pure: ffmpeg is never invoked — `_render_clips` is
exercised with `subprocess.run` patched, and the assertions are about the
filter graph it builds. That graph is where a real bug lived: the per-clip
filter chain was joined with ";" instead of ",", which made the output pad a
chain of its own and ffmpeg rejected the whole thing with "No such filter: ''".
The mixdown had therefore never worked.
"""

import unittest
from types import SimpleNamespace
from unittest.mock import patch

from backend.features.studio import render
from backend.features.studio.midi_export import _rescale, _ticks_at


class DbToGainTests(unittest.TestCase):
    def test_zero_db_is_unity(self):
        self.assertAlmostEqual(render._db_to_gain(0), 1.0)

    def test_minus_six_db_is_about_half_amplitude(self):
        self.assertAlmostEqual(render._db_to_gain(-6), 0.5012, places=3)

    def test_plus_six_db_roughly_doubles(self):
        self.assertAlmostEqual(render._db_to_gain(6), 1.9953, places=3)

    def test_none_is_unity(self):
        # Lanes created before gainDb existed carry None rather than 0.
        self.assertAlmostEqual(render._db_to_gain(None), 1.0)

    def test_garbage_falls_back_to_unity_rather_than_raising(self):
        self.assertAlmostEqual(render._db_to_gain("loud"), 1.0)


class SafeStemNameTests(unittest.TestCase):
    def test_keeps_plain_names(self):
        self.assertEqual(render._safe_stem_name("Vocals", "lane"), "Vocals")

    def test_replaces_separators(self):
        # This is the guard that keeps a lane name out of the filesystem: a
        # name like "../../etc/passwd" must not survive as path syntax.
        self.assertEqual(render._safe_stem_name("../../etc/passwd", "lane"), "etc_passwd")

    def test_strips_surrounding_underscores(self):
        self.assertEqual(render._safe_stem_name("  lead  ", "lane"), "lead")

    def test_empty_falls_back(self):
        self.assertEqual(render._safe_stem_name("", "lane"), "lane")
        self.assertEqual(render._safe_stem_name("///", "lane"), "lane")


class IncludedLanesTests(unittest.TestCase):
    def test_everything_unmuted_when_no_solo(self):
        lanes = [{"id": "a"}, {"id": "b", "mute": True}, {"id": "c"}]
        self.assertEqual([l["id"] for l in render._included_lanes(lanes)], ["a", "c"])

    def test_solo_wins_over_unmuted(self):
        lanes = [{"id": "a"}, {"id": "b", "solo": True}, {"id": "c"}]
        self.assertEqual([l["id"] for l in render._included_lanes(lanes)], ["b"])

    def test_solo_wins_even_when_that_lane_is_also_muted(self):
        # Current behaviour, worth pinning: solo is checked first and mute is
        # never consulted, so a lane that is both solo and muted still plays.
        lanes = [{"id": "a"}, {"id": "b", "solo": True, "mute": True}]
        self.assertEqual([l["id"] for l in render._included_lanes(lanes)], ["b"])

    def test_empty_input(self):
        self.assertEqual(render._included_lanes([]), [])


class RenderClipsFilterGraphTests(unittest.TestCase):
    """What ffmpeg is actually asked to do, without running it."""

    def _run(self, clips, lane_gain=None):
        captured = {}

        def fake_run(cmd, **_kwargs):
            captured["cmd"] = cmd
            return SimpleNamespace(returncode=0, stderr="", stdout="")

        with patch.object(render, "resolve_asset_path", side_effect=lambda _a, aid: f"/audio/{aid}.wav"), \
             patch.object(render.subprocess, "run", side_effect=fake_run), \
             patch.object(render, "probe_audio", return_value={"durationSec": 1.0, "sampleRate": 44100}):
            render._render_clips(clips, {}, lane_gain or {}, "out.wav")

        cmd = captured["cmd"]
        return cmd[cmd.index("-filter_complex") + 1]

    def test_one_clip_chain_is_comma_joined(self):
        graph = self._run([
            {"sourceAssetId": "x", "srcStartSec": 0, "srcEndSec": 2, "laneId": "l"},
        ])
        # The regression: everything up to the output pad is ONE chain.
        self.assertIn("[0:a]atrim=start=0.0:end=2.0,asetpts=PTS-STARTPTS[a0]", graph)
        self.assertNotIn("asetpts=PTS-STARTPTS;[a0]", graph)

    def test_chains_are_semicolon_separated_from_each_other(self):
        graph = self._run([
            {"sourceAssetId": "x", "srcStartSec": 0, "srcEndSec": 2, "laneId": "l"},
            {"sourceAssetId": "y", "srcStartSec": 0, "srcEndSec": 2, "laneId": "l"},
        ])
        self.assertEqual(graph.count(";"), 2)  # two clip chains + the amix chain
        self.assertIn("[a0][a1]amix=inputs=2", graph)

    def test_single_clip_still_gets_an_output_pad(self):
        graph = self._run([
            {"sourceAssetId": "x", "srcStartSec": 0, "srcEndSec": 1, "laneId": "l"},
        ])
        self.assertIn("[a0]anull[mixout]", graph)

    def test_lane_and_clip_gain_add_in_db_before_conversion(self):
        graph = self._run(
            [{"sourceAssetId": "x", "srcStartSec": 0, "srcEndSec": 1, "laneId": "l", "gainDb": -6}],
            lane_gain={"l": -6},
        )
        # -6 and -6 sum to -12 dB, not multiply as two separate volume filters.
        self.assertIn("volume=", graph)
        self.assertEqual(graph.count("volume="), 1)

    def test_timeline_offset_becomes_adelay_in_milliseconds(self):
        graph = self._run([
            {"sourceAssetId": "x", "srcStartSec": 0, "srcEndSec": 1, "timelineStartSec": 1.5, "laneId": "l"},
        ])
        self.assertIn("adelay=1500|1500", graph)

    def test_zero_offset_adds_no_delay_filter(self):
        graph = self._run([
            {"sourceAssetId": "x", "srcStartSec": 0, "srcEndSec": 1, "timelineStartSec": 0, "laneId": "l"},
        ])
        self.assertNotIn("adelay", graph)

    def test_fade_out_is_skipped_when_longer_than_the_clip(self):
        graph = self._run([
            {"sourceAssetId": "x", "srcStartSec": 0, "srcEndSec": 1, "fadeOutSec": 5, "laneId": "l"},
        ])
        self.assertNotIn("afade=t=out", graph)

    def test_degenerate_range_is_widened_rather_than_producing_an_empty_trim(self):
        graph = self._run([
            {"sourceAssetId": "x", "srcStartSec": 3, "srcEndSec": 3, "laneId": "l"},
        ])
        self.assertIn("atrim=start=3.0:end=3.01", graph)

    def test_no_resolvable_source_raises(self):
        with patch.object(render, "resolve_asset_path", return_value=None):
            with self.assertRaises(RuntimeError):
                render._render_clips([{"sourceAssetId": "gone"}], {}, {}, "out.wav")


class MidiTickTests(unittest.TestCase):
    def test_ticks_at_uses_bpm_and_ppq(self):
        # One second at 120 BPM is two beats; at 480 ppq that is 960 ticks.
        self.assertEqual(_ticks_at(1.0, 120, 480), 960)

    def test_ticks_at_zero(self):
        self.assertEqual(_ticks_at(0.0, 120, 480), 0)

    def test_rescale_between_resolutions(self):
        self.assertEqual(_rescale(480, 480, 960), 960)
        self.assertEqual(_rescale(960, 960, 480), 480)

    def test_rescale_is_identity_when_ppq_matches(self):
        self.assertEqual(_rescale(123, 480, 480), 123)


if __name__ == "__main__":
    unittest.main()
