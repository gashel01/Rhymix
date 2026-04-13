import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import AudioTableActions from "./AudioTableActions";

describe("AudioTableActions cover action", () => {
  it("renders cover table action and calls handler with selected tracks", () => {
    const handleCoverWithTracks = jest.fn();
    const rows = [
      { id: "a", name: "A" },
      { id: "b", name: "B" },
    ];

    render(
      <AudioTableActions
        selectedRows={["b"]}
        trackPairs={rows}
        onSelectAll={() => {}}
        onClear={() => {}}
        onDelete={() => {}}
        handleCoverWithTracks={handleCoverWithTracks}
      />
    );

    fireEvent.click(screen.getByText("Cover"));
    expect(handleCoverWithTracks).toHaveBeenCalledWith([{ id: "b", name: "B" }]);
  });
});
