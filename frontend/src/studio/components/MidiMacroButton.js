import { useEffect } from "react";

/* Drop next to any numeric control to make it MIDI-mappable — registers its live range/setter
   with the shared useMidiMacros() engine (see hooks/useMidiMacros.js) so an incoming Control
   Change on the bound CC number drives it directly, no mouse involved. Renders nothing if MIDI
   macros aren't wired up for this view (macros is optional) so it's safe to sprinkle in without
   every caller needing the engine. */
const MidiMacroButton = ({ macros, paramId, label, min, max, step, value, onChange }) => {
  useEffect(() => {
    if (!macros) return undefined;
    return macros.registerParam(paramId, { min, max, step, onChange, label });
  }, [macros, paramId, min, max, step, onChange, label]);

  if (!macros) return null;

  const ccNumber = macros.mappings[paramId];
  const isLearning = macros.learningParamId === paramId;

  if (isLearning) {
    return (
      <button
        type="button"
        className="studio-midi-macro-btn learning"
        onClick={() => macros.cancelLearning()}
        title="Move a knob/fader on your MIDI controller now"
      >
        Learning…
      </button>
    );
  }

  if (ccNumber != null) {
    return (
      <button
        type="button"
        className="studio-midi-macro-btn mapped"
        onClick={() => macros.removeMapping(paramId)}
        title={`Mapped to CC ${ccNumber} — click to unmap`}
      >
        CC {ccNumber}
      </button>
    );
  }

  return (
    <button
      type="button"
      className="studio-midi-macro-btn"
      onClick={() => macros.startLearning(paramId)}
      title={`Map ${label || "this"} to a MIDI knob/fader`}
    >
      Learn
    </button>
  );
};

export default MidiMacroButton;
