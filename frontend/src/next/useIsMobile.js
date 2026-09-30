import { useEffect, useState } from "react";

/**
 * Whether we are on a phone.
 *
 * A media query in CSS cannot move an element to a different parent, and the
 * phone layout is not the desktop one with different padding: the bottom bar
 * holds five items where the rail holds seven, and a track row shows one
 * waveform where the desktop shows two. Those are different trees, so the
 * breakpoint is read here as well — once, and on the same number the
 * stylesheets use.
 */

export const MOBILE_QUERY = "(max-width: 768px)";

export default function useIsMobile() {
  const [mobile, setMobile] = useState(
    () => typeof window !== "undefined" && window.matchMedia(MOBILE_QUERY).matches
  );

  useEffect(() => {
    const query = window.matchMedia(MOBILE_QUERY);
    const onChange = (event) => setMobile(event.matches);
    query.addEventListener("change", onChange);
    setMobile(query.matches);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return mobile;
}
