// Loaded automatically by react-scripts before every test file.
//
// jsdom implements the DOM, not the browser. Several APIs this app relies on
// simply do not exist there, and a component that touches one during mount
// throws before a single assertion runs — which is why the two component tests
// in this repo failed with "IntersectionObserver is not defined" rather than
// with anything about their own subject.
//
// These are minimal stand-ins: enough for a component to mount and for a test
// to assert on what it renders. A test that actually depends on observer or
// audio behaviour should stub it explicitly rather than lean on these.

import "@testing-library/jest-dom";

class NoopObserver {
  constructor(callback) {
    this.callback = callback;
  }
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

if (typeof window !== "undefined") {
  if (!window.IntersectionObserver) {
    window.IntersectionObserver = NoopObserver;
    global.IntersectionObserver = NoopObserver;
  }
  if (!window.ResizeObserver) {
    window.ResizeObserver = NoopObserver;
    global.ResizeObserver = NoopObserver;
  }

  // Used by theme code to pick light/dark. jsdom has no media engine.
  if (!window.matchMedia) {
    window.matchMedia = (query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    });
  }

  // jsdom lays nothing out, so scrolling has nothing to scroll to.
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }

  // Waveform code creates object URLs for blobs it never actually decodes here.
  if (typeof URL !== "undefined") {
    if (!URL.createObjectURL) URL.createObjectURL = () => "blob:test";
    if (!URL.revokeObjectURL) URL.revokeObjectURL = () => {};
  }
}
