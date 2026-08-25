/**
 * IIFE entry for build-free consumers (the browser extension's service worker
 * loads the built file via importScripts). Attaches the whole engine as
 * `globalThis.VitrinkaRedact`. Built with `bun run build:iife`; the extension
 * checks the artifact in and CI diffs it against a fresh build.
 */
import * as engine from './index';

declare global {
  // eslint-disable-next-line no-var
  var VitrinkaRedact: typeof engine;
}

globalThis.VitrinkaRedact = engine;
