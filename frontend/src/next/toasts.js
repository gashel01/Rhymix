import React, { createContext, useCallback, useContext, useMemo, useState } from "react";

/**
 * Notifications.
 *
 * They collect in the top bar rather than flashing past in a corner. A toast
 * that has faded is gone: a generation that failed while you were reading
 * lyrics left no trace, and "did that work?" had no answer anywhere in the
 * interface. Here the last run's outcome is still there when you look up.
 *
 * The provider keeps the name `useToasts` and the `notify` / `fail` pair so
 * every caller stays unchanged — only where they land moved.
 */

const NotificationContext = createContext(null);

const LIMIT = 30;
let nextId = 0;

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const [seen, setSeen] = useState(0);

  const push = useCallback((message, kind) => {
    const text = String(message || "").trim();
    if (!text) return;
    nextId += 1;
    setItems((list) => [{ id: nextId, text, kind, at: Date.now() }, ...list].slice(0, LIMIT));
  }, []);

  const value = useMemo(
    () => ({
      notify: (message) => push(message, "info"),
      fail: (message) => push(message, "error"),
      items,
      // Unread is a count of what arrived since the list was last opened.
      unread: Math.max(0, items.length - seen),
      markSeen: () => setSeen(items.length),
      clear: () => {
        setItems([]);
        setSeen(0);
      },
    }),
    [push, items, seen]
  );

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}

export const useToasts = () => {
  const context = useContext(NotificationContext);
  if (!context) throw new Error("useToasts must be used inside a ToastProvider");
  return context;
};

/** How long ago, in the roughest terms that are still useful. */
export const timeAgo = (at) => {
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
};
