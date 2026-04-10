import os
import sys
import librosa
import traceback
import threading
import collections
import numpy as np
import sounddevice as sd
from dataclasses import dataclass

now_dir = os.getcwd()
sys.path.append(now_dir)

from rvc.realtime.core import AUDIO_SAMPLE_RATE


@dataclass
class ServerAudioDevice:
    index: int = 0
    name: str = ""
    host_api: str = ""
    max_input_channels: int = 0
    max_output_channels: int = 0
    default_samplerate: int = 0


def check_the_device(device, type: str = "input"):
    stream_cls = sd.InputStream if type == "input" else sd.OutputStream
    try:
        with stream_cls(
            device=device["index"],
            dtype=np.float32,
            samplerate=device["default_samplerate"],
        ):
            return True
    except Exception:
        return False


def list_audio_device():
    """
    Function to query audio devices and host api.
    """
    try:
        audio_device_list = sd.query_devices()
    except Exception as e:
        print("An error occurred while querying the audio device:", e)
        audio_device_list = []
    except OSError as e:
        # This error can occur when the libportaudio2 library is missing.
        print("An error occurred while querying the audio device:", e)
        audio_device_list = []

    input_audio_device_list = [
        d
        for d in audio_device_list
        if d["max_input_channels"] > 0 and check_the_device(d, "input")
    ]
    output_audio_device_list = [
        d
        for d in audio_device_list
        if d["max_output_channels"] > 0 and check_the_device(d, "output")
    ]

    try:
        hostapis = sd.query_hostapis()
    except Exception as e:
        print("An error occurred while querying the host api:", e)
        hostapis = []
    except OSError as e:
        # This error can occur when the libportaudio2 library is missing.
        print("An error occurred while querying the host api:", e)
        hostapis = []

    audio_input_device = []
    audio_output_device = []

    for d in input_audio_device_list:
        input_audio_device = ServerAudioDevice(
            index=d["index"],
            name=d["name"],
            host_api=hostapis[d["hostapi"]]["name"],
            max_input_channels=d["max_input_channels"],
            max_output_channels=d["max_output_channels"],
            default_samplerate=d["default_samplerate"],
        )
        audio_input_device.append(input_audio_device)

    for d in output_audio_device_list:
        output_audio_device = ServerAudioDevice(
            index=d["index"],
            name=d["name"],
            host_api=hostapis[d["hostapi"]]["name"],
            max_input_channels=d["max_input_channels"],
            max_output_channels=d["max_output_channels"],
            default_samplerate=d["default_samplerate"],
        )
        audio_output_device.append(output_audio_device)

    return audio_input_device, audio_output_device


# ---------------------------------------------------------------------------
# InferenceThread
# ---------------------------------------------------------------------------
# Decouples GPU inference from the real-time sounddevice callback so that
# the audio I/O thread is never blocked by GPU work.
#
# Data flow:
#   sounddevice input callback  -->  _input_deque  (ring, maxlen=2)
#                                          |
#                                  InferenceThread  (background)
#                                          |
#                                  _output_deque  (ring, maxlen=4)
#                                          |
#   sounddevice output callback  <--  pop oldest frame  (silence if empty)
#   sounddevice monitor callback <--  same output deque
#
# Using collections.deque(maxlen=N) as a lock-free ring buffer:
#   - Input full  → oldest input is auto-dropped  (GPU too slow → skip stale audio)
#   - Output full → oldest output is auto-dropped  (playback stalls → keep fresh)
#   - Output empty → silence returned              (pipeline warming up)
# ---------------------------------------------------------------------------

class InferenceThread(threading.Thread):
    """Background thread that runs VC inference and feeds the output ring buffer."""

    def __init__(self, callbacks, audio_params: dict, block_frame: int):
        super().__init__(daemon=True, name="vc-inference")
        self.callbacks = callbacks
        self.params = audio_params
        self.block_frame = block_frame

        # input_deque: raw mic frames waiting to be processed.
        # maxlen=2 → if inference falls >2 blocks behind, stale audio is discarded.
        self._input_deque: collections.deque = collections.deque(maxlen=2)

        # output_deque: processed frames ready for playback.
        # maxlen=4 → ~4 blocks of headroom; oldest auto-dropped when output stalls.
        self._output_deque: collections.deque = collections.deque(maxlen=4)

        self._stop_event = threading.Event()
        self._has_input = threading.Event()
        self.latency: float = 0.0
        self._silence = np.zeros(block_frame, dtype=np.float32)

    # ------------------------------------------------------------------
    # Called from sounddevice input callback (real-time thread)
    # ------------------------------------------------------------------
    def push_input(self, mono_float32: np.ndarray):
        self._input_deque.append(mono_float32)
        self._has_input.set()

    # ------------------------------------------------------------------
    # Called from sounddevice output + monitor callbacks (real-time threads)
    # Returns a processed frame; returns silence if none is ready yet.
    # ------------------------------------------------------------------
    def pop_output(self) -> np.ndarray:
        try:
            return self._output_deque.popleft()
        except IndexError:
            return self._silence.copy()

    # ------------------------------------------------------------------
    # Background inference loop
    # ------------------------------------------------------------------
    def run(self):
        p = self.params
        while not self._stop_event.is_set():
            # Wait for input to arrive (or stop signal)
            self._has_input.wait(timeout=0.05)
            self._has_input.clear()

            # Process every pending frame — if multiple queued, process each one.
            # The output deque auto-drops stale frames if we produce faster than playback.
            while self._input_deque and not self._stop_event.is_set():
                indata_mono = self._input_deque.popleft()
                try:
                    out_wav, _, perf, _ = self.callbacks.change_voice(
                        indata_mono,
                        p["f0_up_key"],
                        p["index_rate"],
                        p["protect"],
                        p["volume_envelope"],
                        p["f0_autotune"],
                        p["f0_autotune_strength"],
                        p["proposed_pitch"],
                        p["proposed_pitch_threshold"],
                    )
                    self.latency = perf[1]
                    self._output_deque.append(out_wav * p["output_audio_gain"])
                except Exception as exc:
                    print(f"[InferenceThread] error: {exc}")
                    print(traceback.format_exc())
                    # On error, push silence so playback stays continuous
                    self._output_deque.append(self._silence.copy())

    def stop(self):
        self._stop_event.set()
        self._has_input.set()  # unblock the .wait() so the thread exits
        self.join(timeout=2.0)


# ---------------------------------------------------------------------------
# Audio class
# ---------------------------------------------------------------------------

class Audio:
    def __init__(
        self,
        callbacks,
        f0_up_key: int = 0,
        index_rate: float = 0.5,
        protect: float = 0.5,
        volume_envelope: float = 1,
        f0_autotune: bool = False,
        f0_autotune_strength: float = 1,
        proposed_pitch=False,
        proposed_pitch_threshold: float = 155.0,
        input_audio_gain: float = 1.0,
        output_audio_gain: float = 1.0,
        monitor_audio_gain: float = 1.0,
        monitor: bool = False,
    ):
        self.callbacks = callbacks
        self.stream = None
        self.monitor = None
        self.running = False
        self.input_audio_gain = input_audio_gain
        self.output_audio_gain = output_audio_gain
        self.monitor_audio_gain = monitor_audio_gain
        self.use_monitor = monitor
        self.f0_up_key = f0_up_key
        self.index_rate = index_rate
        self.protect = protect
        self.volume_envelope = volume_envelope
        self.f0_autotune = f0_autotune
        self.f0_autotune_strength = f0_autotune_strength
        self.proposed_pitch = proposed_pitch
        self.proposed_pitch_threshold = proposed_pitch_threshold
        self.latency: float = 0.0

        # InferenceThread is created fresh on each start() call
        self._inference_thread: "InferenceThread | None" = None

    def get_input_audio_device(self, index: int):
        audioinput, _ = list_audio_device()
        serverAudioDevice = [x for x in audioinput if x.index == index]
        return serverAudioDevice[0] if len(serverAudioDevice) > 0 else None

    def get_output_audio_device(self, index: int):
        _, audiooutput = list_audio_device()
        serverAudioDevice = [x for x in audiooutput if x.index == index]
        return serverAudioDevice[0] if len(serverAudioDevice) > 0 else None

    # ------------------------------------------------------------------
    # sounddevice callbacks — must finish in microseconds
    # ------------------------------------------------------------------

    def audio_stream_callback(
        self, indata: np.ndarray, outdata: np.ndarray, frames, times, status
    ):
        """
        Real-time audio I/O callback — NO INFERENCE HAPPENS HERE.

        Input:  apply gain → mono → push to InferenceThread input deque
        Output: pop latest processed frame from InferenceThread output deque
        """
        try:
            thread = self._inference_thread
            if thread is None:
                outdata[:] = 0
                return

            # Push mic audio to inference thread
            mono = librosa.to_mono((indata * self.input_audio_gain).T)
            thread.push_input(mono)

            # Pull processed audio (silence if inference hasn't caught up yet)
            out_wav = thread.pop_output()
            self.latency = thread.latency

            output_channels = outdata.shape[1]
            outdata[:] = (
                np.repeat(out_wav, output_channels).reshape(-1, output_channels)
            )
        except Exception as error:
            print(f"An error occurred while running the audio stream: {error}")
            print(traceback.format_exc())
            outdata[:] = 0

    def audio_monitor_callback(
        self, outdata: np.ndarray, frames, times, status
    ):
        """
        Monitor output callback.

        Reads from the InferenceThread output ring-buffer with monitor_audio_gain.
        Outputs silence if the deque is empty — NEVER drops or skips frames.
        """
        try:
            thread = self._inference_thread
            if thread is None:
                outdata[:] = 0
                return

            out_wav = thread.pop_output()
            output_channels = outdata.shape[1]
            outdata[:] = (
                np.repeat(out_wav, output_channels).reshape(-1, output_channels)
                * self.monitor_audio_gain
            )
        except Exception as error:
            print(f"An error occurred while running the audio monitor: {error}")
            print(traceback.format_exc())
            outdata[:] = 0

    # ------------------------------------------------------------------

    def run_audio_stream(
        self,
        block_frame: int,
        input_device_id: int,
        output_device_id: int,
        output_monitor_id: int,
        input_max_channel: int,
        output_max_channel: int,
        output_monitor_max_channel: int,
        input_extra_setting,
        output_extra_setting,
        output_monitor_extra_setting,
    ):
        # Build audio parameter dict for InferenceThread
        audio_params = {
            "f0_up_key": self.f0_up_key,
            "index_rate": self.index_rate,
            "protect": self.protect,
            "volume_envelope": self.volume_envelope,
            "f0_autotune": self.f0_autotune,
            "f0_autotune_strength": self.f0_autotune_strength,
            "proposed_pitch": self.proposed_pitch,
            "proposed_pitch_threshold": self.proposed_pitch_threshold,
            "output_audio_gain": self.output_audio_gain,
        }

        # Launch the inference background thread
        self._inference_thread = InferenceThread(
            self.callbacks, audio_params, block_frame
        )
        self._inference_thread.start()

        # Open the I/O stream
        self.stream = sd.Stream(
            callback=self.audio_stream_callback,
            latency="low",
            dtype=np.float32,
            device=(input_device_id, output_device_id),
            blocksize=block_frame,
            samplerate=AUDIO_SAMPLE_RATE,
            channels=(input_max_channel, output_max_channel),
            extra_settings=(input_extra_setting, output_extra_setting),
        )
        self.stream.start()

        # Open the monitor output stream (reads same output ring-buffer)
        if self.use_monitor:
            self.monitor = sd.OutputStream(
                callback=self.audio_monitor_callback,
                dtype=np.float32,
                device=output_monitor_id,
                blocksize=block_frame,
                samplerate=AUDIO_SAMPLE_RATE,
                channels=output_monitor_max_channel,
                extra_settings=output_monitor_extra_setting,
            )
            self.monitor.start()

    def stop(self):
        self.running = False

        # Stop inference thread first so callbacks don't race on teardown
        if self._inference_thread is not None:
            self._inference_thread.stop()
            self._inference_thread = None

        if self.stream is not None:
            self.stream.close()
            self.stream = None

        if self.monitor is not None:
            self.monitor.close()
            self.monitor = None

    def start(
        self,
        input_device_id: int,
        output_device_id: int,
        output_monitor_id: int = None,
        exclusive_mode: bool = False,
        asio_input_channel: int = -1,
        asio_output_channel: int = -1,
        asio_output_monitor_channel: int = -1,
        read_chunk_size: int = 192,
    ):
        self.stop()

        input_audio_device = self.get_input_audio_device(input_device_id)
        output_audio_device = self.get_output_audio_device(output_device_id)
        input_channels = input_audio_device.max_input_channels
        output_channels = output_audio_device.max_output_channels

        (
            input_extra_setting,
            output_extra_setting,
            output_monitor_extra_setting,
            monitor_channels,
        ) = (None, None, None, None)
        wasapi_exclusive_mode = bool(exclusive_mode)

        if input_audio_device and "WASAPI" in input_audio_device.host_api:
            input_extra_setting = sd.WasapiSettings(
                exclusive=wasapi_exclusive_mode, auto_convert=not wasapi_exclusive_mode
            )
        elif (
            input_audio_device
            and "ASIO" in input_audio_device.host_api
            and asio_input_channel != -1
        ):
            input_extra_setting = sd.AsioSettings(
                channel_selectors=[asio_input_channel]
            )
            input_channels = 1

        if output_audio_device and "WASAPI" in output_audio_device.host_api:
            output_extra_setting = sd.WasapiSettings(
                exclusive=wasapi_exclusive_mode, auto_convert=not wasapi_exclusive_mode
            )
        elif (
            input_audio_device
            and "ASIO" in input_audio_device.host_api
            and asio_output_channel != -1
        ):
            output_extra_setting = sd.AsioSettings(
                channel_selectors=[asio_output_channel]
            )
            output_channels = 1

        if self.use_monitor:
            output_monitor_device = self.get_output_audio_device(output_monitor_id)
            monitor_channels = output_monitor_device.max_output_channels

            if output_monitor_device and "WASAPI" in output_monitor_device.host_api:
                output_monitor_extra_setting = sd.WasapiSettings(
                    exclusive=wasapi_exclusive_mode,
                    auto_convert=not wasapi_exclusive_mode,
                )
            elif (
                output_monitor_device
                and "ASIO" in output_monitor_device.host_api
                and asio_output_monitor_channel != -1
            ):
                output_monitor_extra_setting = sd.AsioSettings(
                    channel_selectors=[asio_output_monitor_channel]
                )
                monitor_channels = 1

        block_frame = int((read_chunk_size * 128 / 48000) * AUDIO_SAMPLE_RATE)

        try:
            self.run_audio_stream(
                block_frame,
                input_device_id,
                output_device_id,
                output_monitor_id,
                input_channels,
                output_channels,
                monitor_channels,
                input_extra_setting,
                output_extra_setting,
                output_monitor_extra_setting,
            )
            self.running = True
        except Exception as error:
            print(f"An error occurred while streaming audio: {error}")
            print(traceback.format_exc())
