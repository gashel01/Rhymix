import React, { useState } from "react";

/**
 * A collapsible block of form.
 *
 * The chevron is part of the heading rather than a separate control, because
 * the whole heading is the hit target — a 12px arrow is not something anyone
 * wants to aim at. `actions` sits on the right and never toggles: those are
 * things you do to the section's contents, not to the section.
 */
export default function Section({ title, actions, children, defaultOpen = true, muted = false }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="rx-section" data-open={open ? "" : undefined} data-muted={muted ? "" : undefined}>
      <header className="rx-section-head">
        <button
          type="button"
          className="rx-section-toggle"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" className="rx-chev">
            <path d="M7.4 9.2 12 13.8l4.6-4.6L18 10.6l-6 6-6-6z" />
          </svg>
          {title}
        </button>
        {actions && <span className="rx-section-actions">{actions}</span>}
      </header>
      {open && <div className="rx-section-body">{children}</div>}
    </section>
  );
}
