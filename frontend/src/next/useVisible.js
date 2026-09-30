import { useEffect, useState } from "react";

/**
 * Whether an element has ever scrolled into view.
 *
 * A library page of twenty tracks used to fetch every waveform and every
 * duration the moment the list rendered — two or three small requests per
 * row, all fired in the same instant regardless of whether the row was
 * on-screen or eighteen rows below the fold. This is what a row's data
 * fetching gates on instead: nothing loads until it is about to be seen, and
 * once it has been seen there is no reason to keep watching, so the observer
 * disconnects rather than toggling back to `false` on scrolling away.
 *
 * `rootMargin` starts the fetch a little before the row actually reaches the
 * viewport, so scrolling down does not visibly outrun its own waveforms.
 */

export default function useVisible(ref, rootMargin = "400px") {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (visible) return undefined;
    const el = ref.current;
    if (!el) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) setVisible(true);
      },
      { rootMargin }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, rootMargin, visible]);

  return visible;
}
