import React from "react";

import { useMasterAudio } from "../../masterAudio";
import { VolumeIcon } from "../../studio/components/StudioIcons";
import RadarPan from "../../studio/components/RadarPan";

/**
 * The one volume/pan control for the whole app — every sound played,
 * Studio's mix or a Library preview, goes through the node this reads and
 * writes (see masterAudio.js). Lives in the shell's persistent rail, not
 * inside StudioView, specifically so it's there before Studio has ever been
 * opened, not just once it has.
 *
 * Same markup and classes as Studio's own former "Main" panel — reusing
 * StudioView.css's .studio-master-* rules, which are bundled globally
 * regardless of whether StudioView itself has ever rendered. Those rules are
 * all written as `#rx-studio-master-slot .studio-master-*` — a *descendant*
 * selector — so the id has to sit on a wrapper, not on the same element as
 * .studio-master-panel itself; putting both on one node matched every rule
 * for the elements nested inside it but not the `#rx-studio-master-slot
 * .studio-master-panel` rule itself, which is where the padding lives (a
 * div and its own id aren't a descendant relationship). It's a leftover
 * name from when this was a portal target rather than a component, kept
 * only because the CSS still keys off it.
 */
export default function MasterFader() {
  const { volume, pan, setVolume, setPan } = useMasterAudio();

  return (
    <div id="rx-studio-master-slot">
      <div className="studio-master-panel">
        <div className="studio-master-row">
          <span className="studio-master-label">Main</span>
          <VolumeIcon size={14} />
        </div>
        <div className="studio-master-controls">
          <input
            type="range"
            className="studio-master-volume"
            min="0"
            max="1.25"
            step="0.01"
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            title={`Volume — ${Math.round(volume * 100)}%`}
            aria-label="Master volume"
          />
          <div className="studio-master-pan-group">
            <RadarPan size={40} value={pan} onChange={setPan} />
            <span className="studio-master-pan-value">
              {Math.abs(pan) < 0.02 ? "C" : `${pan < 0 ? "L" : "R"}${Math.round(Math.abs(pan) * 100)}`}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
