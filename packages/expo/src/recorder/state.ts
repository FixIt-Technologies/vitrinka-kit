/**
 * Shared recorder state that carries NO native imports, so the capture layers
 * (net/console/shot) never drag `react-native` or `expo-constants` in through
 * `session.ts`. Keeping this split lets those layers be unit-tested directly —
 * and it is what `session.ts` re-exports, so callers keep one import site.
 */

/** Current route, maintained by the nav capture layer; used by every event. */
export const currentRoute = { tabId: 'root', tabHost: '/' };

/**
 * Update the current route (called by RecorderProvider when its `route` prop
 * changes). Notifies the HUD channel so route-dependent chrome (the idle-grip
 * opt-out) re-renders on navigation even while nothing is recording.
 * Returns true when the route actually changed.
 */
export function setCurrentRoute(pathname: string, lane: string): boolean {
  if (currentRoute.tabHost === pathname && currentRoute.tabId === lane) return false;
  currentRoute.tabId = lane;
  currentRoute.tabHost = pathname;
  notify();
  return true;
}

/**
 * Annotate mode (region marquee). Lives here so the chip (RecorderPill) and the
 * overlay (AnnotateOverlay) stay in sync through the same notify channel the
 * rest of the HUD re-renders off.
 */
export const annotateState = { active: false };

export function setAnnotating(active: boolean): void {
  if (annotateState.active === active) return;
  annotateState.active = active;
  notify();
}

// -- change subscription (the HUD re-renders off this) -----------------------

const listeners = new Set<() => void>();

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notify(): void {
  for (const fn of listeners) fn();
}
