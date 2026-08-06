import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./Select.module.css";

/**
 * A select whose list we actually own.
 *
 * A native <select> hands its dropdown to the operating system: on Windows it
 * paints a white list with a Windows-blue highlight, ignoring every token in
 * this app, and there is no CSS that reaches it. It is also clipped by nothing
 * and stacked above everything, which is the one thing it does better than
 * most replacements — so this renders its list through a portal to <body> for
 * the same reason: inside a scrolling panel or a backdrop-filtered card, an
 * absolutely positioned menu would be cropped or trapped.
 *
 * Keyboard behaviour follows the WAI-ARIA combobox/listbox pattern rather than
 * being invented: Up/Down move, Home/End jump, Enter/Space commit, Escape
 * cancels, Tab commits and moves on, and typing jumps to a matching label.
 *
 * options: [{ value, label, description?, disabled? }]
 */
const Select = ({
  value,
  onChange,
  options = [],
  placeholder = "Select…",
  disabled = false,
  ariaLabel,
  id,
  className = "",
  menuMaxHeight = 280,
}) => {
  const reactId = useId();
  const listId = `${id || reactId}-listbox`;
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const typeaheadRef = useRef({ text: "", at: 0 });

  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [placement, setPlacement] = useState(null);

  const selectedIndex = useMemo(
    () => options.findIndex((option) => String(option.value) === String(value)),
    [options, value]
  );
  const selected = selectedIndex >= 0 ? options[selectedIndex] : null;

  const firstEnabled = useCallback(
    (from, step) => {
      for (let i = from; i >= 0 && i < options.length; i += step) {
        if (!options[i]?.disabled) return i;
      }
      return -1;
    },
    [options]
  );

  /* Measured against the viewport because the menu is fixed: it opens below the
     trigger unless the space below is smaller than the space above. */
  const position = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const below = window.innerHeight - rect.bottom - 12;
    const above = rect.top - 12;
    const openUp = below < Math.min(menuMaxHeight, 200) && above > below;
    setPlacement({
      left: rect.left,
      width: rect.width,
      top: openUp ? undefined : rect.bottom + 6,
      bottom: openUp ? window.innerHeight - rect.top + 6 : undefined,
      maxHeight: Math.max(120, Math.min(menuMaxHeight, openUp ? above : below)),
    });
  }, [menuMaxHeight]);

  useLayoutEffect(() => {
    if (!open) return undefined;
    position();
    /* Capture phase so a scroll in any ancestor repositions, not just the
       window — the trigger often lives inside a scrolling panel. */
    const onScroll = () => position();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open, position]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (triggerRef.current?.contains(event.target)) return;
      if (menuRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : firstEnabled(0, 1));
  }, [open, selectedIndex, firstEnabled]);

  useEffect(() => {
    if (!open || activeIndex < 0) return;
    menuRef.current
      ?.querySelector(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  const commit = (index) => {
    const option = options[index];
    if (!option || option.disabled) return;
    setOpen(false);
    triggerRef.current?.focus();
    if (String(option.value) !== String(value)) onChange?.(option.value);
  };

  const onKeyDown = (event) => {
    if (disabled) return;

    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
        event.preventDefault();
        setOpen(true);
      }
      return;
    }

    switch (event.key) {
      case "Escape":
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
        return;
      case "Tab":
        // Tab commits and leaves, the way a native select does.
        if (activeIndex >= 0) commit(activeIndex);
        setOpen(false);
        return;
      case "Enter":
      case " ":
        event.preventDefault();
        commit(activeIndex);
        return;
      case "ArrowDown":
        event.preventDefault();
        setActiveIndex((i) => {
          const next = firstEnabled(i + 1, 1);
          return next === -1 ? i : next;
        });
        return;
      case "ArrowUp":
        event.preventDefault();
        setActiveIndex((i) => {
          const next = firstEnabled(i - 1, -1);
          return next === -1 ? i : next;
        });
        return;
      case "Home":
        event.preventDefault();
        setActiveIndex(firstEnabled(0, 1));
        return;
      case "End":
        event.preventDefault();
        setActiveIndex(firstEnabled(options.length - 1, -1));
        return;
      default:
        break;
    }

    // Typeahead: consecutive keystrokes build a prefix, idle for a second resets.
    if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      const now = Date.now();
      const state = typeaheadRef.current;
      state.text = now - state.at > 1000 ? event.key : state.text + event.key;
      state.at = now;
      const needle = state.text.toLowerCase();
      const match = options.findIndex(
        (option) => !option.disabled && String(option.label).toLowerCase().startsWith(needle)
      );
      if (match >= 0) setActiveIndex(match);
    }
  };

  return (
    <>
      <button
        type="button"
        id={id}
        ref={triggerRef}
        className={`${styles.trigger} ${open ? styles.triggerOpen : ""} ${className}`}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        onClick={() => !disabled && setOpen((was) => !was)}
        onKeyDown={onKeyDown}
      >
        <span className={selected ? styles.value : styles.placeholder}>
          {selected ? selected.label : placeholder}
        </span>
        <svg
          className={`${styles.chevron} ${open ? styles.chevronOpen : ""}`}
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M6.5 9.5 12 15l5.5-5.5" />
        </svg>
      </button>

      {open && placement
        ? createPortal(
            <div
              ref={menuRef}
              id={listId}
              role="listbox"
              tabIndex={-1}
              aria-label={ariaLabel}
              aria-activedescendant={activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
              className={styles.menu}
              style={{
                left: placement.left,
                top: placement.top,
                bottom: placement.bottom,
                minWidth: placement.width,
                maxHeight: placement.maxHeight,
              }}
            >
              {options.length === 0 ? (
                <div className={styles.empty}>No options</div>
              ) : (
                options.map((option, index) => {
                  const isSelected = String(option.value) === String(value);
                  return (
                    <div
                      key={option.value}
                      id={`${listId}-${index}`}
                      data-index={index}
                      role="option"
                      aria-selected={isSelected}
                      aria-disabled={option.disabled || undefined}
                      className={[
                        styles.option,
                        index === activeIndex ? styles.optionActive : "",
                        isSelected ? styles.optionSelected : "",
                        option.disabled ? styles.optionDisabled : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      onPointerEnter={() => !option.disabled && setActiveIndex(index)}
                      onClick={() => commit(index)}
                    >
                      <span className={styles.optionBody}>
                        <span className={styles.optionLabel}>{option.label}</span>
                        {option.description ? (
                          <span className={styles.optionDescription}>{option.description}</span>
                        ) : null}
                      </span>
                      {isSelected ? (
                        <svg
                          className={styles.tick}
                          width="15"
                          height="15"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M5 12.5 10 17.5 19 7" />
                        </svg>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>,
            document.body
          )
        : null}
    </>
  );
};

export default Select;
