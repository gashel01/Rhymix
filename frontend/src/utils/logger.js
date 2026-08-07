/**
 * Development-only logging.
 *
 * The app had 34 `console.log` calls left over from debugging — render traces,
 * fetched payloads, click handlers — all of which shipped to production and
 * printed into a user's console. Deleting them loses information that is
 * genuinely useful while working; leaving them is noise plus a small leak of
 * internal shape.
 *
 * `process.env.NODE_ENV` is inlined by the bundler, so in a production build
 * the condition folds to `false` and the whole call is dropped as dead code —
 * the arguments are never even evaluated.
 *
 * console.error and console.warn are deliberately NOT wrapped: a failure the
 * user can hit should stay visible in production.
 */
const isDev = process.env.NODE_ENV !== "production";

export const devLog = (...args) => {
  if (isDev) console.log(...args);
};

export default devLog;
