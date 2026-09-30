import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * A dropdown menu anchored to whatever opened it.
 *
 * Rendered through a portal and positioned `fixed`, because a menu opened from
 * a row inside a scrolling list would otherwise be clipped by that list's own
 * overflow. The coordinates are measured from the trigger after mount, then
 * flipped when the menu would fall off the right edge or the bottom — which is
 * what stops a menu on the last row from opening below the window.
 */

const MARGIN = 8;

export function MenuItem({ children, shortcut, danger, checked, disabled, title, onSelect, close }) {
  return (
    <button
      type="button"
      className={`mi${danger ? " danger" : ""}`}
      title={title}
      // A checkable item is a radio, not a plain menuitem: only menuitemradio
      // and menuitemcheckbox carry aria-checked, and the sort menu is a
      // one-of-many choice.
      role={checked === undefined ? "menuitem" : "menuitemradio"}
      aria-checked={checked === undefined ? undefined : String(Boolean(checked))}
      aria-disabled={disabled ? "true" : undefined}
      onClick={() => {
        if (disabled) return;
        if (onSelect) onSelect();
        if (close) close();
      }}
    >
      <span className="msp">{children}</span>
      {shortcut && <span className="sc">{shortcut}</span>}
    </button>
  );
}

export const MenuSeparator = () => <div className="msep" />;
export const MenuLabel = ({ children }) => <div className="mlabel">{children}</div>;

function Popover({ anchor, onClose, children }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);

  useLayoutEffect(() => {
    const menu = ref.current;
    if (!menu || !anchor) return;
    const trigger = anchor.getBoundingClientRect();
    const { width, height } = menu.getBoundingClientRect();

    let left = trigger.right - width;
    if (left < MARGIN) left = Math.min(trigger.left, window.innerWidth - width - MARGIN);
    let top = trigger.bottom + 6;
    if (top + height > window.innerHeight - MARGIN) {
      top = Math.max(MARGIN, trigger.top - height - 6);
    }
    setPos({ left: Math.max(MARGIN, left), top });
  }, [anchor]);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape") onClose();
    };
    const onPointer = (event) => {
      if (ref.current && !ref.current.contains(event.target) && !anchor.contains(event.target)) {
        onClose();
      }
    };
    // "scroll" doesn't bubble, but a capturing window listener still sees it
    // from any scrollable descendant — including the menu's own overflow-y
    // list. Without this check, a menu long enough to scroll closed itself
    // the moment you tried.
    const onScroll = (event) => {
      if (ref.current && ref.current.contains(event.target)) return;
      onClose();
    };
    // `true` so a click anywhere closes the menu before that click's own
    // handler runs — otherwise opening a second menu closes it immediately.
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer, true);
    window.addEventListener("resize", onClose);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer, true);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [anchor, onClose]);

  return (
    <div
      ref={ref}
      className="rx-menu"
      role="menu"
      // Hidden until measured, so it never flashes in the top-left corner.
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}
    >
      {children}
    </div>
  );
}

/**
 * `children` is a render function receiving `close`, so an item can dismiss the
 * menu after doing its work without every caller wiring that up.
 */
export default function Menu({ label = "More", className = "iconbtn", trigger = "···", children }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef(null);
  const close = useCallback(() => setOpen(false), []);

  return (
    <>
      <button
        type="button"
        ref={anchorRef}
        className={className}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((value) => !value)}
      >
        {trigger}
      </button>
      {open &&
        createPortal(
          <div className="rx rx-detached">
            <Popover anchor={anchorRef.current} onClose={close}>
              {typeof children === "function" ? children(close) : children}
            </Popover>
          </div>,
          document.body
        )}
    </>
  );
}
