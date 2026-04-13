import os
import torch
import wget

from rvc.lib.predictors.RMVPE import RMVPE0Predictor
from torchfcpe import spawn_infer_model_from_pt
import torchcrepe
import numpy as np

_HF_BASE = "https://huggingface.co/IAHispano/Applio/resolve/main/Resources/predictors"
_PREDICTORS_DIR = os.path.join("rvc", "models", "predictors")


def _ensure_predictor(filename):
    """Return the local path to a predictor weight, downloading it first if absent."""
    dest = os.path.join(_PREDICTORS_DIR, filename)
    if not os.path.exists(dest):
        os.makedirs(_PREDICTORS_DIR, exist_ok=True)
        url = f"{_HF_BASE}/{filename}"
        print(f"\nDownloading {url} to {_PREDICTORS_DIR}...")
        wget.download(url, out=dest)
        print()  # newline after wget's inline progress bar
    return dest


class RMVPE:
    def __init__(self, device, model_name="rmvpe.pt", sample_rate=16000, hop_size=160):
        self.device = device
        self.sample_rate = sample_rate
        self.hop_size = hop_size
        self.model = RMVPE0Predictor(
            _ensure_predictor(model_name),
            device=self.device,
        )

    def get_f0(self, x, filter_radius=0.03):
        f0 = self.model.infer_from_audio(x, thred=filter_radius)
        return f0


class CREPE:
    def __init__(self, device, sample_rate=16000, hop_size=160):
        self.device = device
        self.sample_rate = sample_rate
        self.hop_size = hop_size

    def get_f0(self, x, f0_min=50, f0_max=1100, p_len=None, model="full"):
        if p_len is None:
            p_len = x.shape[0] // self.hop_size

        if not torch.is_tensor(x):
            x = torch.from_numpy(x)

        batch_size = 512

        f0, pd = torchcrepe.predict(
            x.float().to(self.device).unsqueeze(dim=0),
            self.sample_rate,
            self.hop_size,
            f0_min,
            f0_max,
            model=model,
            batch_size=batch_size,
            device=self.device,
            return_periodicity=True,
        )
        pd = torchcrepe.filter.median(pd, 3)
        f0 = torchcrepe.filter.mean(f0, 3)
        f0[pd < 0.1] = 0
        f0 = f0[0].cpu().numpy()

        return f0


class FCPE:
    def __init__(self, device, sample_rate=16000, hop_size=160):
        self.device = device
        self.sample_rate = sample_rate
        self.hop_size = hop_size
        self.model = spawn_infer_model_from_pt(
            _ensure_predictor("fcpe.pt"),
            self.device,
            bundled_model=True,
        )

    def get_f0(self, x, p_len=None, filter_radius=0.006):
        if p_len is None:
            p_len = x.shape[0] // self.hop_size

        if not torch.is_tensor(x):
            x = torch.from_numpy(x)

        f0 = (
            self.model.infer(
                x.float().to(self.device).unsqueeze(0),
                sr=self.sample_rate,
                decoder_mode="local_argmax",
                threshold=filter_radius,
            )
            .squeeze()
            .cpu()
            .numpy()
        )

        return f0
