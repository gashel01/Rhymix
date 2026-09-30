import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { gradientFor } from "../gradients";
import "./Select.css";

/**
 * A picker that looks like the rest of the app instead of the OS.
 *
 * Built to replace every native <select> in Create, Inference and Train — the
 * native control cannot show what a voice or a source track actually is, only
 * its name, so a list of thirty trained voices was thirty identical rows of
 * text. This one draws each row's avatar: a song's own cover art when it has
 * one (falling back to the same gradient tile the library uses), or a
 * gradient-and-letter tile for a voice, which never has art of its own.
 *
 * `options` is a flat array for a plain list; `groups` is
 * `[{ label, options }]` for the <optgroup> case (Create's source picker).
 * Each option is `{ value, label, meta, avatar, disabled }` — `avatar` is
 * `{ kind: "cover", seed, url }` or `{ kind: "voice", seed }`, omitted for a
 * plain enum row (Composition, RVC version, sample rate — nothing to picture
 * besides the words). A selectable "none of these" row is just a normal
 * option with `value: ""`, exactly like `<option value="">` was.
 */

const MARGIN = 8;
const SEARCH_THRESHOLD = 8;

function normaliseGroups(options, groups) {
  if (groups && groups.length) return groups;
  if (options && options.length) return [{ label: null, options }];
  return [];
}

function matches(option, query) {
  const haystack = `${option.label || ""} ${option.meta || ""}`.toLowerCase();
  return haystack.includes(query);
}

function Avatar({ avatar, label }) {
  if (!avatar) return null;
  const letter = (label || "?").trim().charAt(0).toUpperCase() || "?";
  const showImage = avatar.kind === "cover" && avatar.url;
  return (
    <span
      className="rx-select-avatar"
      style={showImage ? { backgroundImage: `url(${avatar.url})` } : { background: gradientFor(avatar.seed ?? label) }}
    >
      {!showImage && letter}
    </span>
  );
}

function Row({ option, active, selected, onPick, registerRef }) {
  return (
    <button
      type="button"
      ref={(el) => registerRef(option.value, el)}
      role="option"
      aria-selected={selected}
      disabled={option.disabled}
      data-active={active ? "" : undefined}
      className="rx-select-row"
      onClick={() => onPick(option)}
      // Selecting with the mouse fires on mousedown, ahead of the popover's
      // own outside-mousedown listener, so the click never reaches it as an
      // "outside" click that closes the list before onPick runs.
      onMouseDown={(event) => event.preventDefault()}
    >
      <Avatar avatar={option.avatar} label={option.label} />
      <span className="rx-select-text">
        <span className="rx-select-label">{option.label}</span>
        {option.meta && <span className="rx-select-meta">{option.meta}</span>}
      </span>
      {selected && (
        <svg viewBox="0 0 24 24" aria-hidden="true" className="rx-select-check">
          <path d="M4.5 12.8 9 17.3 19.5 6.8 18 5.3 9 14.3l-3.5-3.5z" />
        </svg>
      )}
    </button>
  );
}

function Popover({ anchor, width, groups, value, onPick, onClose, searchable }) {
  const rootRef = useRef(null);
  const searchRef = useRef(null);
  const rowRefs = useRef(new Map());
  const [pos, setPos] = useState(null);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups;
    return groups
      .map((group) => ({ ...group, options: group.options.filter((option) => matches(option, q)) }))
      .filter((group) => group.options.length);
  }, [groups, query]);

  const flat = useMemo(() => filtered.flatMap((group) => group.options), [filtered]);
  const [highlight, setHighlight] = useState(() => Math.max(0, flat.findIndex((o) => o.value === value)));

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el || !anchor) return;
    const trigger = anchor.getBoundingClientRect();
    const { height } = el.getBoundingClientRect();
    let top = trigger.bottom + 6;
    if (top + height > window.innerHeight - MARGIN) {
      top = Math.max(MARGIN, trigger.top - height - 6);
    }
    setPos({ left: trigger.left, top, width: trigger.width });
    // Re-measured only on open and on width change — repositioning on every
    // filtered-height change would fight the user's scroll inside the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor, width]);

  useEffect(() => {
    (searchable ? searchRef.current : rootRef.current)?.focus();
  }, [searchable]);

  useEffect(() => {
    const node = rowRefs.current.get(flat[highlight]?.value);
    node?.scrollIntoView({ block: "nearest" });
  }, [highlight, flat]);

  useEffect(() => {
    // The filtered set changes shape as you type; keeping a stale index would
    // highlight a row that is no longer there, or none at all.
    setHighlight((current) => Math.min(Math.max(current, 0), Math.max(0, flat.length - 1)));
  }, [flat.length]);

  const pick = useCallback(
    (option) => {
      if (option.disabled) return;
      onPick(option);
      onClose();
    },
    [onPick, onClose]
  );

  const onKeyDown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((i) => (i + 1) % Math.max(1, flat.length));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((i) => (i - 1 + flat.length) % Math.max(1, flat.length));
    } else if (event.key === "Home") {
      event.preventDefault();
      setHighlight(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setHighlight(Math.max(0, flat.length - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (flat[highlight]) pick(flat[highlight]);
    }
  };

  useEffect(() => {
    const onPointer = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target) && !anchor.contains(event.target)) {
        onClose();
      }
    };
    // "scroll" doesn't bubble, but it does still reach a capturing window
    // listener from any scrollable descendant — including the option list
    // itself. Without this check, scrolling past the first few voices closed
    // the list before you ever reached the rest of it.
    const onScroll = (event) => {
      if (rootRef.current && rootRef.current.contains(event.target)) return;
      onClose();
    };
    document.addEventListener("mousedown", onPointer, true);
    window.addEventListener("resize", onClose);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onPointer, true);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [anchor, onClose]);

  return (
    <div
      ref={rootRef}
      className="rx-select-pop"
      role="listbox"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      style={pos ? { left: pos.left, top: pos.top, width: pos.width } : { left: -9999, top: -9999, width }}
    >
      {searchable && (
        // No onKeyDown here on purpose — it bubbles to the listbox root below,
        // which is where arrow/enter/escape are actually handled. Attaching
        // the same handler here too would run it twice per keypress (once on
        // the input, once again as the bubbled event reaches the root).
        <input
          ref={searchRef}
          type="text"
          className="rx-select-search"
          placeholder="Search…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      )}
      <div className="rx-select-list">
        {filtered.length === 0 && <div className="rx-select-empty">No matches</div>}
        {filtered.map((group, gi) => (
          <div key={group.label || gi}>
            {group.label && <div className="rx-select-group">{group.label}</div>}
            {group.options.map((option) => (
              <Row
                key={option.value}
                option={option}
                selected={option.value === value}
                active={flat[highlight]?.value === option.value}
                onPick={pick}
                registerRef={(v, el) => {
                  if (el) rowRefs.current.set(v, el);
                  else rowRefs.current.delete(v);
                }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Select({
  id,
  value,
  onChange,
  options,
  groups,
  placeholder = "Select…",
  ariaLabel,
  disabled,
  className,
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef(null);
  const close = useCallback(() => setOpen(false), []);

  const groupsNormalised = useMemo(() => normaliseGroups(options, groups), [options, groups]);
  const total = useMemo(() => groupsNormalised.reduce((sum, g) => sum + g.options.length, 0), [groupsNormalised]);
  const selected = useMemo(() => {
    for (const group of groupsNormalised) {
      const found = group.options.find((option) => option.value === value);
      if (found) return found;
    }
    return null;
  }, [groupsNormalised, value]);

  return (
    <>
      <button
        type="button"
        id={id}
        ref={anchorRef}
        className={`rx-select-trigger${className ? ` ${className}` : ""}`}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        data-empty={selected ? undefined : ""}
        onClick={() => setOpen((v) => !v)}
      >
        <Avatar avatar={selected?.avatar} label={selected?.label} />
        <span className="rx-select-text">
          <span className="rx-select-label">{selected ? selected.label : placeholder}</span>
          {selected?.meta && <span className="rx-select-meta">{selected.meta}</span>}
        </span>
        <svg viewBox="0 0 24 24" aria-hidden="true" className="rx-select-chev">
          <path d="M7.4 9.2 12 13.8l4.6-4.6L18 10.6l-6 6-6-6z" />
        </svg>
      </button>
      {open &&
        createPortal(
          <div className="rx rx-detached">
            <Popover
              anchor={anchorRef.current}
              width={anchorRef.current?.getBoundingClientRect().width}
              groups={groupsNormalised}
              value={value}
              searchable={total > SEARCH_THRESHOLD}
              onPick={(option) => onChange(option.value)}
              onClose={close}
            />
          </div>,
          document.body
        )}
    </>
  );
}
