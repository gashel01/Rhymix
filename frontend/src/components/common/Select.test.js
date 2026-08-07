import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import Select from "./Select";

const OPTIONS = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Bravo", description: "second" },
  { value: "c", label: "Charlie" },
];

const setup = (props = {}) => {
  const onChange = jest.fn();
  const utils = render(
    <Select value="a" onChange={onChange} options={OPTIONS} ariaLabel="Pick one" {...props} />
  );
  return { onChange, trigger: screen.getByRole("button", { name: "Pick one" }), ...utils };
};

describe("Select — closed", () => {
  it("shows the selected label, not the value", () => {
    const { trigger } = setup();
    expect(trigger).toHaveTextContent("Alpha");
  });

  it("shows the placeholder when the value matches nothing", () => {
    setup({ value: "zzz", placeholder: "Nothing here" });
    expect(screen.getByRole("button", { name: "Pick one" })).toHaveTextContent("Nothing here");
  });

  it("renders no listbox until opened", () => {
    setup();
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("reports collapsed state to assistive tech", () => {
    const { trigger } = setup();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveAttribute("aria-haspopup", "listbox");
  });
});

describe("Select — opening", () => {
  it("opens on click and marks the current option selected", () => {
    const { trigger } = setup();
    fireEvent.click(trigger);
    const list = screen.getByRole("listbox");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const selected = within(list).getAllByRole("option").filter(
      (o) => o.getAttribute("aria-selected") === "true"
    );
    expect(selected).toHaveLength(1);
    expect(selected[0]).toHaveTextContent("Alpha");
  });

  it("renders the list outside the trigger's subtree", () => {
    // It is portalled on purpose: inside a scrolling panel or a
    // backdrop-filtered card, an in-place menu is cropped or trapped.
    const { trigger } = setup();
    fireEvent.click(trigger);
    expect(trigger.contains(screen.getByRole("listbox"))).toBe(false);
  });

  it("shows descriptions, which a native <option> cannot render", () => {
    const { trigger } = setup();
    fireEvent.click(trigger);
    expect(screen.getByText("second")).not.toBeNull();
  });

  it("closes again on a second click", () => {
    const { trigger } = setup();
    fireEvent.click(trigger);
    fireEvent.click(trigger);
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});

describe("Select — choosing", () => {
  it("reports the value, not the label", () => {
    const { trigger, onChange } = setup();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("option", { name: /Bravo/ }));
    expect(onChange).toHaveBeenCalledWith("b");
  });

  it("closes after a choice", () => {
    const { trigger } = setup();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("option", { name: /Charlie/ }));
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("does not fire when the choice is already the value", () => {
    const { trigger, onChange } = setup();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("option", { name: /Alpha/ }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("ignores a disabled option", () => {
    const { trigger, onChange } = setup({
      options: [...OPTIONS, { value: "d", label: "Delta", disabled: true }],
    });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("option", { name: /Delta/ }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).not.toBeNull();
  });
});

describe("Select — keyboard", () => {
  const activeIndex = () =>
    Number(screen.getByRole("listbox").getAttribute("aria-activedescendant").split("-").pop());

  it("opens on ArrowDown at the current selection", () => {
    const { trigger } = setup({ value: "b" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(screen.getByRole("listbox")).not.toBeNull();
    expect(activeIndex()).toBe(1);
  });

  it("moves down, then to the end, then home", () => {
    const { trigger } = setup();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(activeIndex()).toBe(1);
    fireEvent.keyDown(trigger, { key: "End" });
    expect(activeIndex()).toBe(2);
    fireEvent.keyDown(trigger, { key: "Home" });
    expect(activeIndex()).toBe(0);
  });

  it("stops at the ends instead of wrapping", () => {
    const { trigger } = setup();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(trigger, { key: "ArrowUp" });
    fireEvent.keyDown(trigger, { key: "ArrowUp" });
    expect(activeIndex()).toBe(0);
  });

  it("commits on Enter", () => {
    const { trigger, onChange } = setup();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("b");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("cancels on Escape and hands focus back", () => {
    const { trigger, onChange } = setup();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("jumps to a label by typing, the way a native select does", () => {
    const { trigger } = setup();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(trigger, { key: "c" });
    expect(activeIndex()).toBe(2);
  });

  it("skips a disabled option when moving", () => {
    const { trigger } = setup({
      options: [
        { value: "a", label: "Alpha" },
        { value: "b", label: "Bravo", disabled: true },
        { value: "c", label: "Charlie" },
      ],
    });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(activeIndex()).toBe(2);
  });
});

describe("Select — disabled and empty", () => {
  it("does not open when disabled", () => {
    const { trigger } = setup({ disabled: true });
    fireEvent.click(trigger);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("says so when there is nothing to choose", () => {
    const { trigger } = setup({ options: [] });
    fireEvent.click(trigger);
    expect(screen.getByText("No options")).not.toBeNull();
  });
});
