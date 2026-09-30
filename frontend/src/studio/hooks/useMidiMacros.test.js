import { renderHook, act } from "@testing-library/react";
import { useMidiHardware } from "./useMidiHardware";
import { useMidiMacros } from "./useMidiMacros";

/* Fakes navigator.requestMIDIAccess with a single input whose listener we can drive directly
   with synthetic MIDIMessageEvent-like objects — there's no physical MIDI hardware in any CI/dev
   environment, so this is the only way to exercise the real parsing/dispatch code paths rather
   than just asserting "it compiles". */
const makeFakeMidiAccess = () => {
  const listeners = new Set();
  const input = {
    addEventListener: (type, handler) => {
      if (type === "midimessage") listeners.add(handler);
    },
    removeEventListener: (type, handler) => {
      if (type === "midimessage") listeners.delete(handler);
    },
  };
  const access = {
    inputs: { forEach: (fn) => fn(input) },
    onstatechange: null,
  };
  const fireMessage = (data) => {
    listeners.forEach((handler) => handler({ data }));
  };
  return { access, fireMessage };
};

beforeEach(() => {
  window.localStorage.clear();
});

describe("useMidiHardware", () => {
  test("parses note-on/off and forwards Control Change separately, unaffected by each other", async () => {
    const { access, fireMessage } = makeFakeMidiAccess();
    navigator.requestMIDIAccess = jest.fn().mockResolvedValue(access);

    const onNoteOn = jest.fn();
    const onNoteOff = jest.fn();
    const onControlChange = jest.fn();

    renderHook(() => useMidiHardware(true, onNoteOn, onNoteOff, onControlChange));
    await act(async () => {
      await Promise.resolve();
    });

    act(() => fireMessage([0x90, 60, 100])); // note-on, middle C, velocity 100
    expect(onNoteOn).toHaveBeenCalledWith(60, 100);

    act(() => fireMessage([0x80, 60, 0])); // note-off
    expect(onNoteOff).toHaveBeenCalledWith(60);

    act(() => fireMessage([0x90, 64, 0])); // note-on with velocity 0 == note-off, per the MIDI spec
    expect(onNoteOff).toHaveBeenCalledWith(64);

    act(() => fireMessage([0xb0, 21, 64])); // Control Change: CC 21, value 64
    expect(onControlChange).toHaveBeenCalledWith(21, 64);

    // CC traffic must never be mistaken for note events.
    expect(onNoteOn).toHaveBeenCalledTimes(1);
  });
});

describe("useMidiMacros", () => {
  test("learn binds a CC to a param, then that CC drives the param's onChange scaled to its range", async () => {
    const { access, fireMessage } = makeFakeMidiAccess();
    navigator.requestMIDIAccess = jest.fn().mockResolvedValue(access);

    const { result } = renderHook(() => useMidiMacros());
    await act(async () => {
      await Promise.resolve();
    });

    const onChange = jest.fn();
    act(() => {
      result.current.registerParam("arp.gate", { min: 10, max: 100, step: 5, onChange });
    });

    act(() => result.current.startLearning("arp.gate"));
    expect(result.current.learningParamId).toBe("arp.gate");

    // The next CC message on the controller should bind, not apply yet as "learning" —
    // it becomes the mapping.
    act(() => fireMessage([0xb0, 21, 0]));
    expect(result.current.mappings["arp.gate"]).toBe(21);
    expect(result.current.learningParamId).toBeNull();

    // Now moving that same knob should drive the param: CC value 127 (max) -> param max (100).
    act(() => fireMessage([0xb0, 21, 127]));
    expect(onChange).toHaveBeenCalledWith(100);

    // CC value 0 -> param min (10).
    act(() => fireMessage([0xb0, 21, 0]));
    expect(onChange).toHaveBeenLastCalledWith(10);

    // Midpoint (~63/127) should land near the middle of the range, snapped to the 5-wide step.
    onChange.mockClear();
    act(() => fireMessage([0xb0, 21, 63]));
    const applied = onChange.mock.calls[0][0];
    expect(applied).toBeGreaterThanOrEqual(50);
    expect(applied).toBeLessThanOrEqual(60);
    expect(applied % 5).toBe(0);

    // An unmapped CC number must never touch the param.
    onChange.mockClear();
    act(() => fireMessage([0xb0, 99, 127]));
    expect(onChange).not.toHaveBeenCalled();
  });

  test("removeMapping clears the binding and persists across a fresh hook instance", async () => {
    const { access, fireMessage } = makeFakeMidiAccess();
    navigator.requestMIDIAccess = jest.fn().mockResolvedValue(access);

    const { result } = renderHook(() => useMidiMacros());
    await act(async () => {
      await Promise.resolve();
    });
    act(() => {
      result.current.registerParam("arp.swing", { min: 0, max: 75, step: 5, onChange: jest.fn() });
    });
    act(() => result.current.startLearning("arp.swing"));
    act(() => fireMessage([0xb0, 7, 100]));
    expect(result.current.mappings["arp.swing"]).toBe(7);

    act(() => result.current.removeMapping("arp.swing"));
    expect(result.current.mappings["arp.swing"]).toBeUndefined();

    // A second, independent hook instance reading the same localStorage key must see the
    // mapping is really gone, not just removed from in-memory state.
    navigator.requestMIDIAccess = jest.fn().mockResolvedValue(makeFakeMidiAccess().access);
    const { result: result2 } = renderHook(() => useMidiMacros());
    expect(result2.current.mappings["arp.swing"]).toBeUndefined();
  });
});
