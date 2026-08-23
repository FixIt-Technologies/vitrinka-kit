/**
 * Build-time gate for the recorder's env vars — the safety half of the
 * production-strip story (the bundling half is ./metro.js).
 *
 * Metro INLINES every EXPO_PUBLIC_* value into the JS bundle at build time, so
 * an ingest token present in the environment of a store build is a shipped
 * secret no runtime check can undo. This module is what stands between a stray
 * env var and a store bundle containing both the recorder and a live token.
 * It is pure (env in, throw or return) so consuming apps can unit-test their
 * exact configuration.
 *
 * ONLY the token is gated. `EXPO_PUBLIC_VITRINKA_URL` and `_APP_ID` are not
 * secrets — they are typically committed in eas.json profiles, and refusing a
 * build for carrying them is a false positive. The secret that must never
 * reach a store bundle is the token.
 *
 * THE eas-cli CONTRACT this module is written against (measured against a real
 * `eas build --local`): at the config-evaluation step eas-cli provides the
 * eas.json profile `env` and NOTHING else — no `EAS_BUILD_PROFILE`, no hosted
 * environment (so no token). Those only appear later, at the bundle step. A
 * guard keyed on `EAS_BUILD_PROFILE` alone therefore cannot distinguish
 * anything at config-eval time and must not refuse on that basis.
 */

/** @typedef {{
 *   allowedProfiles: string[],
 *   forbiddenChannels?: string[],
 *   devVariants?: string[],
 *   devModeVar?: string,
 *   updateLaneVar?: string,
 *   laneMarkerVar?: string,
 *   laneMarkerValues?: string[],
 * }} RecorderGuardOptions */

const TOKEN_VAR = 'EXPO_PUBLIC_VITRINKA_TOKEN';

/** The gated var name if it is set (and non-empty) in `env`, else null. */
function vitrinkaTokenIn(env) {
  const value = env[TOKEN_VAR];
  return value === undefined || value === '' ? null : TOKEN_VAR;
}

/**
 * Which store-facing OTA channel this process is publishing to, or null.
 *
 * TWO SIGNALS, deliberately:
 *  - `updateLaneVar` (an env var your update scripts set) is the RELIABLE one:
 *    env is inherited by child processes, so it survives eas-cli evaluating
 *    the config in a spawned `expo config --json`.
 *  - argv is BEST-EFFORT, covering a hand-typed `eas update --channel
 *    production`. When eas-cli spawns a child to evaluate config, the child's
 *    argv sees nothing — a bonus net, never the load-bearing one.
 *
 * OTA updates are the hole build-profile reasoning cannot see: `eas update`
 * re-bundles the same JS in an ordinary developer shell (leftover exports and
 * all) and ships it to already-installed store binaries. That is why the
 * channel check runs FIRST and unconditionally in assertRecorderBuildEnv.
 */
function storeChannelIn(forbiddenChannels, updateLaneVar, env, argv) {
  const lane = updateLaneVar ? env[updateLaneVar] : undefined;
  if (lane && forbiddenChannels.includes(lane)) return lane;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg !== '--channel' && arg !== '--branch') {
      const inline = /^--(?:channel|branch)=(.+)$/.exec(arg ?? '');
      if (inline && forbiddenChannels.includes(inline[1])) return inline[1];
      continue;
    }
    const value = argv[i + 1];
    if (value && forbiddenChannels.includes(value)) return value;
  }
  return null;
}

/**
 * Throw unless this build is allowed to carry the recorder ingest token.
 *
 * Allowed:
 *  - the token is not set (config-eval, and every store build whose EAS
 *    environment carries no token);
 *  - an allowlisted `EAS_BUILD_PROFILE` (the bundle step of an allowed build);
 *  - no profile, but an unambiguous non-store-lane marker: an allowed
 *    appVariant (local Metro), `devModeVar` === 'true', or a configured lane
 *    marker (for prod-backed test lanes whose token is injected per build).
 *
 * Refused: a token while publishing an OTA to a forbidden channel (checked
 * FIRST, with no escape hatch — "would this reach real users?" outranks every
 * "is this build allowed?" branch), on a non-allowlisted profile, or on an
 * ad-hoc local build carrying no dev-lane marker at all.
 *
 * @param {string} appVariant resolved app variant (default your config to 'production')
 * @param {RecorderGuardOptions} opts
 */
function assertRecorderBuildEnv(appVariant, opts, env = process.env, argv = process.argv) {
  if (!opts || !Array.isArray(opts.allowedProfiles) || opts.allowedProfiles.length === 0) {
    throw new Error(
      '[@vitrinka/expo] assertRecorderBuildEnv requires { allowedProfiles: [...] } — ' +
        'the explicit list of EAS build profiles allowed to carry the recorder.',
    );
  }
  const forbiddenChannels = opts.forbiddenChannels ?? ['production', 'preview'];
  const devVariants = opts.devVariants ?? ['development'];
  const devModeVar = opts.devModeVar ?? 'EXPO_PUBLIC_DEV_MODE';

  const present = vitrinkaTokenIn(env);
  if (!present) return;

  const storeChannel = storeChannelIn(forbiddenChannels, opts.updateLaneVar, env, argv);
  if (storeChannel) {
    throw new Error(
      `[@vitrinka/expo] Publish refused: ${present} is set while publishing an OTA update to the ` +
        `"${storeChannel}" channel. Metro would inline the recorder AND a live vitrinka ingest ` +
        'token into a bundle served to real users, and no runtime check can undo that.\n' +
        'This is almost certainly a leftover export in this shell or a value in a local env ' +
        'file. Publish from a clean shell (EXPO_NO_DOTENV=1 exists for exactly this reason).',
    );
  }

  const profile = env.EAS_BUILD_PROFILE;
  if (profile) {
    if (opts.allowedProfiles.includes(profile)) return;
    throw new Error(
      `[@vitrinka/expo] Build refused: ${present} is set on the "${profile}" EAS build ` +
        'profile. Metro would inline the vitrinka ingest token into this bundle, and no runtime ' +
        `check can undo that. Recorder env is only allowed on: ${opts.allowedProfiles.join(', ')}. ` +
        'Unset it, or move the value to a development EAS environment.',
    );
  }

  // No EAS profile: either local Metro, or the config-eval / bundle step of a
  // local EAS build. A non-store-lane marker separates those from an ad-hoc
  // production build.
  if (devVariants.includes(appVariant)) return;
  if (env[devModeVar] === 'true') return;
  if (
    opts.laneMarkerVar &&
    (opts.laneMarkerValues ?? []).includes(env[opts.laneMarkerVar])
  ) {
    return;
  }
  throw new Error(
    `[@vitrinka/expo] Build refused: ${present} is set while building the "${appVariant}" ` +
      'variant with no EAS build profile and no dev-lane marker (an ad-hoc local build). Metro ' +
      'would inline the vitrinka ingest token into this bundle. Unset it in this shell — it ' +
      'belongs in a development EAS environment or a gitignored local env overlay.',
  );
}

module.exports = { assertRecorderBuildEnv, storeChannelIn, vitrinkaTokenIn, TOKEN_VAR };
