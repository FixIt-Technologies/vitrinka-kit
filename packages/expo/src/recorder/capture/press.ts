/**
 * Press-target labeling — best-effort, dev-only. The capture responder only
 * sees native coordinates, so every recorded click digests as a bare "click"
 * and the session pipeline gets no selector hints. The label comes from
 * walking the React fiber above the touched node (responder events carry
 * `_targetInst` in both renderers) to the nearest testID / accessibilityLabel
 * / literal text child — the same preference order the e2e emitter uses
 * (testIDs > labels > text). Fully guarded: when the walk finds nothing, or
 * React's internals move, the click event simply stays coordinate-only —
 * exactly the previous behavior.
 */
import { redactText } from './redact';

const MAX_HOPS = 12;
const LABEL_CAP = 120;

interface Fiberish {
  memoizedProps?: Record<string, unknown> | null;
  return?: Fiberish | null;
}

/** Nearest literal text inside a children tree, without rendering anything. */
function literalText(children: unknown, depth = 0): string | null {
  if (depth > 2 || children == null) return null;
  if (typeof children === 'string') return children.trim() || null;
  if (typeof children === 'number') return String(children);
  if (Array.isArray(children)) {
    for (const c of children) {
      const t = literalText(c, depth + 1);
      if (t) return t;
    }
  }
  return null;
}

export function pressLabel(event: unknown): string | undefined {
  try {
    // One walk, three buckets: the preference order holds across the WHOLE
    // walk — a testID on the pressable ancestor must beat the literal text
    // of the touched <Text> child (the normal <Pressable testID> shape),
    // so nothing can return early on a weaker signal.
    let testID: string | undefined, label: string | undefined, text: string | undefined;
    let node = (event as { _targetInst?: Fiberish } | null)?._targetInst ?? null;
    for (let hops = 0; node && hops < MAX_HOPS; hops++, node = node.return ?? null) {
      const p = node.memoizedProps;
      if (!p) continue;
      if (!testID && typeof p.testID === 'string' && p.testID) {
        testID = p.testID;
        break; // strongest signal — nothing above can outrank it
      }
      const l = p.accessibilityLabel ?? p['aria-label'];
      if (!label && typeof l === 'string' && l) label = l;
      if (!text) text = literalText(p.children) ?? undefined;
    }
    const best = testID ?? label ?? text;
    return best ? redactText(best)?.slice(0, LABEL_CAP) : undefined;
  } catch {
    // labeling must never break touch handling
  }
  return undefined;
}
