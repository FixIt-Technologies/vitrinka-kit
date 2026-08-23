/**
 * Build-time stub swapped in for the recorder's entry modules
 * (`./RecorderProvider`, `./hud/RecorderPill`, `./hud/AnnotateOverlay`) on any
 * build that does not set recorder env — see ./metro.js.
 *
 * Why a stub rather than trusting dead-code elimination: Metro collects
 * `require()` dependencies while TRANSFORMING a module, before any minifier
 * can prove the surrounding branch dead. So even though the gate returns early
 * on such builds, the requires would still be followed and the entire recorder
 * subtree bundled. Redirecting the specifiers is what actually keeps it out.
 *
 * Plain CJS, shipped unbuilt in plugin/ so the redirect works identically for
 * the installed package and a workspace/source checkout. These exports are
 * never called — the gate returns before reaching them — but they stay
 * faithful to the real shapes so a mis-wired build degrades to a no-op
 * instead of a crash.
 */

const RecorderProvider = ({ children }) => children ?? null;
const RecorderPill = () => null;
const AnnotateOverlay = () => null;

module.exports = { RecorderProvider, RecorderPill, AnnotateOverlay };
