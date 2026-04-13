import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import CreateSongView from "./index";

jest.mock("../../utils/apiService", () => ({
  getCoverSourceSong: jest.fn(async () => ({
    source_song: {
      source_song_id: "upload:file-1",
      title: "Source Song",
      audioUrl: "/api/download/raw_vocals/file-1",
      instrumentalUrl: "/api/download/instrumental/file-1",
      vocalsUrl: "/api/download/raw_vocals/file-1",
      hasAudio: true,
    },
  })),
  startCoverGeneration: jest.fn(async () => ({ job_id: "cover-job-1" })),
  getCoverGenerationStatus: jest.fn(async () => ({
    id: "cover-job-1",
    status: "completed",
    progress: 100,
    status_message: "done",
    assets: {},
  })),
}));

const { startCoverGeneration } = require("../../utils/apiService");

describe("CreateSongView cover mode", () => {
  beforeEach(() => {
    global.IntersectionObserver = class {
      observe() {}
      disconnect() {}
    };
    global.fetch = jest.fn(async (url) => {
      if (String(url).includes("/api/song-generation/jobs")) {
        return { ok: true, json: async () => ({ jobs: [] }) };
      }
      if (String(url).includes("/api/available-models")) {
        return {
          ok: true,
          json: async () => ({
            models: [
              {
                name: "voice-a",
                checkpoints: [
                  { filename: "voice-a-e100.pth", epochs: 100, isBest: true, size_mb: 42 },
                ],
              },
            ],
          }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("renders in cover mode and submits to cover API", async () => {
    render(
      <CreateSongView
        initialMode="cover"
        sourceSongId="upload:file-1"
        initialSourceSong={{
          sourceSongId: "upload:file-1",
          title: "Source Song",
          audioUrl: "/api/download/raw_vocals/file-1",
          instrumentalUrl: "/api/download/instrumental/file-1",
          vocalsUrl: "/api/download/raw_vocals/file-1",
        }}
      />
    );

    expect(await screen.findByText("Create Cover")).not.toBeNull();

    fireEvent.change(screen.getByPlaceholderText("e.g. Midnight Lights (Cover)"), {
      target: { value: "My Cover" },
    });
    fireEvent.change(screen.getByDisplayValue("None (Original Voice)"), {
      target: { value: "voice-a" },
    });

    fireEvent.click(screen.getByText("Create cover"));

    await waitFor(() => expect(startCoverGeneration).toHaveBeenCalledTimes(1));
    expect(startCoverGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        source_song_id: "upload:file-1",
        title: "My Cover",
        target_voice: "voice-a",
        lyrics: null,
        audio_cover_strength: 1,
      })
    );
  });
});
