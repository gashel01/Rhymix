import React from "react";
import { GENRE_RECS, toKey } from "./constants";

export function GenrePanel({ ui, t, genreText, genreTokens, usedGenreKeys, onGenreTextChange, addGenreToken, removeGenreToken }) {
  const { Panel, Pill, Input } = ui;
  return (
    <Panel style={{ marginBottom: 14 }}>
      <div style={{ display: "grid", gap: 10 }}>
        <div style={{ fontWeight: 950, letterSpacing: -0.2, color: t.text }}>Genre</div>
        {genreTokens.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {genreTokens.map((g) => (
              <Pill key={g} tone="neutral" onDelete={() => removeGenreToken(g)}>
                {g}
              </Pill>
            ))}
          </div>
        )}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {GENRE_RECS.filter((r) => !usedGenreKeys.has(toKey(r))).map((r) => (
            <Pill key={r} tone="primary" onClick={() => addGenreToken(r)} title="Add genre">
              {r}
            </Pill>
          ))}
        </div>
        <Input value={genreText} onChange={onGenreTextChange} placeholder="Type genres/styles… e.g., Synthwave, Electro-pop" />
      </div>
    </Panel>
  );
}
