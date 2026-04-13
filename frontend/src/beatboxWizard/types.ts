export type DrumLabel = "kick" | "snare" | "hat" | "clap";

export const LABELS: DrumLabel[] = ["kick", "snare", "hat", "clap"];

export type WizardState =
  | "idle"
  | "requesting_mic"
  | "recording"
  | "processing"
  | "results"
  | "review"
  | "training"
  | "done";

export type StartSessionRequest = {
  sampleRate: number;
  windowSec: number;
  targetHitsPerLabel: number;
};

export type StartSessionResponse = {
  sessionId: string;
  labels: DrumLabel[];
  nextLabel: DrumLabel;
};

export type TakeResponse = {
  label: DrumLabel;
  takeId: string;
  durationSec: number;
  detectedHits: number;
  added: number;
  skipped: number;
  skipReasonsTop: Record<string, number>;
  quality: {
    snrDbMedian: number;
    clipRatioMax: number;
    rmsMedian: number;
  };
  balance: Record<DrumLabel, number>;
  consistency?: number | null;
  predictedTop?: Record<string, number>;
  needMore?: Record<string, number>;
  recommendation: {
    action: "next" | "retake";
    message: string;
  };
};

export type TrainResponse = {
  status: "trained" | "insufficient_samples" | "insufficient_labels" | "training_failed";
  counts: Record<DrumLabel, number>;
  cvAccuracyMean?: number;
  cvAccuracyStd?: number;
  confusionPreview: Array<{ true: DrumLabel; pred: DrumLabel; n: number }>;
};

export type ReviewResponse = {
  label: DrumLabel;
  items: Array<{
    sampleId: string;
    confidence: number;
    qualityScore: number;
    audioUrl: string;
    reviewReason?: string;
  }>;
};

export type StatusResponse = {
  sessionId: string;
  labels: DrumLabel[];
  counts: Record<DrumLabel, number>;
  nextLabel: DrumLabel;
  targetHitsPerLabel: number;
  sampleRate: number;
  windowSec: number;
  modelTrained: boolean;
  lastTake: TakeResponse | null;
};
