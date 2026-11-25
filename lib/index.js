/**
 * Node half of the balance strip. The browser half in `lib/client.js` owns every
 * contribution; this entry exists so the package appears as an ordinary Loader
 * row.
 * @module dsh-balance-strip
 */

/** Loader-visible no-op body; the browser half carries the feature. */
function apply() {}

export { apply };
