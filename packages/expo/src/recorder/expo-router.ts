/**
 * expo-router adapter — `@vitrinka/expo/recorder/expo-router`.
 *
 * Lives on its own subpath so the core recorder stays navigation-agnostic and
 * `expo-router` is only resolved by apps that import this file. Lane mapping:
 * tabId = the segment after '(tabs)' when inside a tab navigator
 * (home/orders/profile…), else the top-level route group ('(formSheet)' etc.).
 *
 *   const route = useExpoRouterRecorderRoute();
 *   return <VitrinkaRecorderRoot route={route}>{children}</VitrinkaRecorderRoot>;
 *
 * Safe to call on stripped builds: it reads two expo-router hooks and returns
 * an object — the recorder tree behind the gate stays unbundled either way.
 */
import { usePathname, useSegments } from 'expo-router';

import type { RecorderRoute } from './RecorderProvider';

function laneOf(segments: string[]): string {
  const tabsIdx = segments.indexOf('(tabs)');
  if (tabsIdx >= 0 && segments[tabsIdx + 1]) return segments[tabsIdx + 1];
  return segments[0] ?? 'root';
}

export function useExpoRouterRecorderRoute(): RecorderRoute {
  const pathname = usePathname();
  const segments = useSegments();
  return { pathname, lane: laneOf(segments as string[]) };
}
