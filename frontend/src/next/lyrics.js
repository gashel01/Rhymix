/**
 * Lyrics, as sections.
 *
 * What arrives is whatever the author and the engine agreed on, which in this
 * library means at least three shapes: "[Chorus]" on its own line, "Chorus:"
 * inline, "Verse 1]" with the opening bracket missing, and — in one real song —
 * fourteen hundred characters with no line breaks at all.
 *
 * This is the display counterpart of backend/features/cover_art/service.py,
 * which does the same parsing to find a hook. Deliberately duplicated rather
 * than shared: one picks a phrase to draw, the other lays text out, and making
 * them one function would give it two masters.
 */

const SECTION_WORDS = "verse|chorus|refrain|hook|bridge|intro|outro|pre-?chorus|drop|break|interlude";

// The marker in all the shapes it actually arrives in.
const MARKER = new RegExp(`[\\[(]?\\s*((?:${SECTION_WORDS})\\s*\\d*)\\s*[\\])::]+`, "i");

// Where a line ended in run-together lyrics: a capitalised word following a
// lowercase one. `[A-Z][a-z]` and not `[A-Z]` so "and I'm lost" stays whole.
const RUN_ON = /(?<=[a-z,])\s+(?=[A-Z][a-z])/;

/**
 * Whether this text lost its line breaks and needs them guessed back.
 *
 * Guessing is only ever a repair. Applied to lyrics that already have proper
 * newlines it does real damage: "Yo, Puff Daddy, Diddy, Combs, whatever name
 * you claim this week" is one line, and every comma-then-capital in it looks
 * exactly like a join — it came out as five lines of one word each.
 *
 * So the question is asked once per song, not once per line: if the text has
 * several short lines already, its own breaks are trusted completely.
 */
function looksRunOn(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length <= 2) return true;
  const longest = Math.max(...lines.map((line) => line.length));
  return longest > 160;
}

const titleCase = (text) =>
  text.replace(/\w\S*/g, (word) => word[0].toUpperCase() + word.slice(1).toLowerCase());

/**
 * Split lyrics into `[{ name, lines }]`.
 *
 * Text before any marker becomes an unnamed opening section rather than being
 * dropped — plenty of songs never label their first verse.
 */
export function parseLyrics(raw) {
  const text = String(raw || "").trim();
  if (!text) return [];

  const sections = [];
  let current = { name: "", lines: [] };
  // Asked once, for the whole song.
  const repair = looksRunOn(text);
  const splitLine = (line) => (repair ? line.split(RUN_ON) : [line]);

  const pushLine = (line) => {
    const clean = line.trim();
    if (clean) current.lines.push(clean);
  };

  const closeSection = () => {
    if (current.name || current.lines.length) sections.push(current);
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    // A marker can sit alone on its line, or open one that continues.
    const match = line.match(MARKER);
    if (match && match.index === 0) {
      closeSection();
      current = { name: titleCase(match[1].trim()), lines: [] };
      const rest = line.slice(match[0].length).trim();
      if (rest) splitLine(rest).forEach(pushLine);
      continue;
    }

    // Markers buried mid-line, which is what happens when the whole song is
    // one paragraph.
    const parts = line.split(new RegExp(MARKER.source, "gi"));
    if (parts.length > 1) {
      let expectName = false;
      for (const part of parts) {
        if (!part) continue;
        if (expectName) {
          closeSection();
          current = { name: titleCase(part.trim()), lines: [] };
          expectName = false;
        } else {
          splitLine(part).forEach(pushLine);
        }
        // Split with one capture group alternates text, capture, text…
        expectName = !expectName;
      }
      continue;
    }

    splitLine(line).forEach(pushLine);
  }
  closeSection();

  return sections.filter((section) => section.lines.length);
}

/** Section names, in the order they appear, without repeats. */
export const sectionNames = (sections) =>
  Array.from(new Set(sections.map((section) => section.name).filter(Boolean)));
