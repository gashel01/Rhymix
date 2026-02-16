from __future__ import annotations

from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, Field

LABELS = ["kick", "snare", "hat", "clap"]
MIDI_MAP = {"kick": 36, "snare": 38, "clap": 39, "hat": 42}


class StartSessionRequest(BaseModel):
    sample_rate: int = Field(default=16000, alias="sampleRate", ge=8000, le=96000)
    window_sec: float = Field(default=0.25, alias="windowSec", ge=0.08, le=1.0)
    target_hits_per_label: int = Field(default=25, alias="targetHitsPerLabel", ge=4, le=200)

    class Config:
        populate_by_name = True


class StartSessionResponse(BaseModel):
    session_id: str = Field(alias="sessionId")
    labels: List[str]
    next_label: str = Field(alias="nextLabel")

    class Config:
        populate_by_name = True


class Recommendation(BaseModel):
    action: Literal["next", "retake"]
    message: str


class TakeQuality(BaseModel):
    snr_db_median: float = Field(alias="snrDbMedian")
    clip_ratio_max: float = Field(alias="clipRatioMax")
    rms_median: float = Field(alias="rmsMedian")

    class Config:
        populate_by_name = True


class TakeResponse(BaseModel):
    label: str
    take_id: str = Field(alias="takeId")
    duration_sec: float = Field(alias="durationSec")
    detected_hits: int = Field(alias="detectedHits")
    added: int
    skipped: int
    skip_reasons_top: Dict[str, int] = Field(alias="skipReasonsTop")
    quality: TakeQuality
    balance: Dict[str, int]
    consistency: Optional[float] = None
    predicted_top: Dict[str, int] = Field(default_factory=dict, alias="predictedTop")
    need_more: Dict[str, int] = Field(default_factory=dict, alias="needMore")
    recommendation: Recommendation

    class Config:
        populate_by_name = True


class TrainResponse(BaseModel):
    status: Literal["trained", "insufficient_samples", "insufficient_labels", "training_failed"]
    counts: Dict[str, int]
    cv_accuracy_mean: Optional[float] = Field(default=None, alias="cvAccuracyMean")
    cv_accuracy_std: Optional[float] = Field(default=None, alias="cvAccuracyStd")
    confusion_preview: List[Dict[str, object]] = Field(default_factory=list, alias="confusionPreview")

    class Config:
        populate_by_name = True


class ReviewItem(BaseModel):
    sample_id: str = Field(alias="sampleId")
    confidence: float
    quality_score: float = Field(alias="qualityScore")
    audio_url: str = Field(alias="audioUrl")
    review_reason: str = Field(default="low_quality", alias="reviewReason")

    class Config:
        populate_by_name = True


class ReviewResponse(BaseModel):
    label: str
    items: List[ReviewItem]


class DeleteResponse(BaseModel):
    ok: bool


class SessionStatusResponse(BaseModel):
    session_id: str = Field(alias="sessionId")
    labels: List[str]
    counts: Dict[str, int]
    next_label: str = Field(alias="nextLabel")
    target_hits_per_label: int = Field(alias="targetHitsPerLabel")
    sample_rate: int = Field(alias="sampleRate")
    window_sec: float = Field(alias="windowSec")
    model_trained: bool = Field(alias="modelTrained")
    last_take: Optional[dict] = Field(default=None, alias="lastTake")

    class Config:
        populate_by_name = True
