/**
 * bun test preload — mocks for native-only modules in the recorder's module
 * graph (react-native ships Flow-typed sources bun cannot parse). Only the
 * primitives the recorder touches at module-eval time are stubbed; no test
 * renders, so components are inert null stubs.
 *
 * NB: bun links `import { X } from 'react-native'` statically against the
 * factory's returned object keys, so every named import used anywhere in the
 * suite's module graph must be an explicit own-property here (a Proxy
 * fallback does NOT satisfy static named-import linking).
 */
import { mock } from 'bun:test';

mock.module('react-native', () => {
  const Stub = () => null;
  return {
    StyleSheet: {
      create: (styles: unknown) => styles,
      flatten: (styles: unknown) => styles,
      hairlineWidth: 1,
    },
    Platform: { OS: 'ios', select: (o: Record<string, unknown>) => o.ios ?? o.default },
    PixelRatio: { get: () => 2, getFontScale: () => 1, roundToNearestPixel: (n: number) => n },
    Dimensions: {
      get: () => ({ width: 390, height: 844, scale: 2, fontScale: 1 }),
      addEventListener: () => ({ remove: () => undefined }),
    },
    AppState: {
      currentState: 'active',
      addEventListener: () => ({ remove: () => undefined }),
    },
    Alert: { alert: () => undefined },
    LayoutAnimation: {
      configureNext: () => undefined,
      create: () => ({}),
    },
    Keyboard: { dismiss: () => undefined, addListener: () => ({ remove: () => undefined }) },
    View: Stub,
    Text: Stub,
    TextInput: Stub,
    Pressable: Stub,
    ActivityIndicator: Stub,
    findNodeHandle: () => null,
  };
});

mock.module('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: { children?: unknown }) => children ?? null,
}));

mock.module('react-native-keyboard-controller', () => ({
  KeyboardStickyView: ({ children }: { children?: unknown }) => children ?? null,
}));
