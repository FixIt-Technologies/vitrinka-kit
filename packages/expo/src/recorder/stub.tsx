/**
 * Build-time stub swapped in for the recorder's entry modules
 * (`./RecorderProvider`, `./hud/RecorderPill`, `./hud/AnnotateOverlay`) on any
 * build that does not set recorder env — see `withRecorderStrip` in the
 * package's metro helper.
 *
 * Why a stub rather than trusting dead-code elimination: Metro collects
 * `require()` dependencies while TRANSFORMING a module, before any minifier can
 * prove the surrounding branch dead. So even though the gate returns early on
 * such builds, the requires would still be followed and the entire recorder
 * subtree (provider, HUD, queue, api, capture layers) bundled. Redirecting the
 * specifiers is what actually keeps it out.
 *
 * These exports are never called — the gate returns before reaching them — but
 * they stay faithful to the real shapes so a mis-wired build degrades to a
 * no-op instead of a crash.
 */
import type { ReactNode } from 'react';

export const RecorderProvider = ({ children }: { children?: ReactNode }) => children ?? null;
export const RecorderPill = () => null;
export const AnnotateOverlay = () => null;
