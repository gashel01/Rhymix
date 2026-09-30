import { useCallback, useEffect, useRef, useState } from "react";
import { useMidiHardware } from "./useMidiHardware";

const STORAGE_KEY = "rhymix.studio.midiMacroMappings";

// A stable identity, not an inline arrow — useMidiHardware's effect depends on this reference
// (along with onControlChange) to decide whether to tear down and re-subscribe; a fresh
// () => {} on every render of this hook would flap the underlying MIDI connection on every
// mapping/learn state change, dropping whatever CC message arrived mid-resubscribe.
const NOOP = () => {};

const loadMappings = () => {
  try {
    const raw = window.localStorage?.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

const persistMappings = (mappings) => {
  try {
    window.localStorage?.setItem(STORAGE_KEY, JSON.stringify(mappings));
  } catch {
    // Storage unavailable/full — mappings just won't survive reload, not worth surfacing.
  }
};

/* Zero-mouse macro control: bind a physical MIDI knob/fader (a Control Change message) to any
   numeric app parameter via a "Learn" flow — call startLearning(paramId), move a knob, it's
   bound from then on. One instance of this hook owns the single underlying useMidiHardware CC
   connection; individual controls register their live min/max/onChange via registerParam()
   instead of each opening their own MIDI connection (see MidiMacroButton.js).

   Mappings ({ [paramId]: ccNumber }) persist in localStorage — they're a preference tied to the
   user's own hardware, not project data. */
export const useMidiMacros = () => {
  const [mappings, setMappingsState] = useState(loadMappings);
  const [learningParamId, setLearningParamId] = useState(null);
  const mappingsRef = useRef(mappings);
  const learningRef = useRef(learningParamId);
  const paramsRef = useRef({}); // { [paramId]: { min, max, step, onChange, label } }

  useEffect(() => {
    mappingsRef.current = mappings;
  }, [mappings]);
  useEffect(() => {
    learningRef.current = learningParamId;
  }, [learningParamId]);

  const setMappings = useCallback((updater) => {
    setMappingsState((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      persistMappings(next);
      return next;
    });
  }, []);

  const registerParam = useCallback((paramId, def) => {
    paramsRef.current[paramId] = def;
    return () => {
      delete paramsRef.current[paramId];
    };
  }, []);

  const startLearning = useCallback((paramId) => setLearningParamId(paramId), []);
  const cancelLearning = useCallback(() => setLearningParamId(null), []);

  const removeMapping = useCallback(
    (paramId) => {
      setMappings((prev) => {
        if (!(paramId in prev)) return prev;
        const next = { ...prev };
        delete next[paramId];
        return next;
      });
    },
    [setMappings]
  );

  // Stable identity (no state in its own deps, everything routes through refs) so
  // useMidiHardware's effect doesn't tear down and re-subscribe on every mapping/learn change.
  const handleControlChange = useCallback(
    (ccNumber, value) => {
      const learningParam = learningRef.current;
      if (learningParam) {
        setMappings((prev) => {
          // A CC drives one param at a time — re-learning a param drops its old binding, and
          // binding a CC already used elsewhere reassigns it here instead of silently driving
          // two params from the same knob.
          const next = Object.fromEntries(Object.entries(prev).filter(([, cc]) => cc !== ccNumber));
          next[learningParam] = ccNumber;
          return next;
        });
        setLearningParamId(null);
        return;
      }
      const paramId = Object.keys(mappingsRef.current).find((key) => mappingsRef.current[key] === ccNumber);
      if (!paramId) return;
      const def = paramsRef.current[paramId];
      if (!def) return;
      const ratio = value / 127;
      const raw = def.min + ratio * (def.max - def.min);
      const scaled = def.step ? Math.round(raw / def.step) * def.step : raw;
      def.onChange(Math.min(def.max, Math.max(def.min, scaled)));
    },
    [setMappings]
  );

  useMidiHardware(true, NOOP, undefined, handleControlChange);

  return { mappings, learningParamId, startLearning, cancelLearning, removeMapping, registerParam };
};
