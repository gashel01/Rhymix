import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import "./Sheet.css";

/**
 * A modal panel.
 *
 * Portalled to the body for the same reason the menus are: anything anchored
 * inside a scrolling list gets clipped by it. Focus moves into the sheet on
 * open and returns to whatever opened it on close, because a dialog you can
 * tab behind is a dialog that has swallowed the keyboard.
 */
export default function Sheet({ title, subtitle, onClose, footer, children }) {
  const panelRef = useRef(null);
  const openerRef = useRef(null);

  useEffect(() => {
    openerRef.current = document.activeElement;
    const panel = panelRef.current;
    if (panel) {
      const first = panel.querySelector("textarea, input, button, [tabindex]");
      (first || panel).focus();
    }
    // The page behind must not scroll under the sheet.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKey = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      if (openerRef.current && openerRef.current.focus) openerRef.current.focus();
    };
  }, [onClose]);

  return createPortal(
    <div className="rx rx-detached">
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */}
      <div className="rx-scrim" onClick={onClose} role="presentation" />
      <div
        className="rx-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={panelRef}
        tabIndex={-1}
      >
        <header className="rx-sheet-head">
          <div>
            <h2>{title}</h2>
            {subtitle && <span className="hint">{subtitle}</span>}
          </div>
          <button type="button" className="iconbtn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="rx-sheet-body">{children}</div>
        {footer && <footer className="rx-sheet-foot">{footer}</footer>}
      </div>
    </div>,
    document.body
  );
}
