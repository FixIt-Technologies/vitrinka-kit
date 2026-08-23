/**
 * Press-target labeling: the fiber walk that names recorded clicks
 * (testID > accessibilityLabel > literal text), and its guarantee that a
 * missing/foreign fiber shape degrades to undefined, never a throw.
 */
import { describe, expect, it } from 'bun:test';

const { pressLabel } = (await import(
  '../capture/press'
)) as typeof import('../capture/press');

type Node = { memoizedProps?: Record<string, unknown> | null; return?: Node | null };

const event = (target: Node | null) => ({ _targetInst: target });

describe('pressLabel', () => {
  it('prefers testID over accessibilityLabel over text — across the whole walk', () => {
    // The canonical <Pressable testID><Text>label</Text></Pressable> shape:
    // the touched node has literal text, the pressable ANCESTOR has the
    // testID — the testID must win (stable Appium selector > display text).
    const target: Node = {
      memoizedProps: { children: 'Uložit' },
      return: {
        memoizedProps: { accessibilityLabel: 'Uložit adresu', testID: 'address-save' },
        return: null,
      },
    };
    expect(pressLabel(event(target))).toBe('address-save');

    const labelBeatsText: Node = {
      memoizedProps: { children: 'Uložit' },
      return: { memoizedProps: { accessibilityLabel: 'Uložit adresu' }, return: null },
    };
    expect(pressLabel(event(labelBeatsText))).toBe('Uložit adresu');

    const textOnly: Node = { memoizedProps: { children: 'Uložit' } };
    expect(pressLabel(event(textOnly))).toBe('Uložit');
  });

  it('walks up to an ancestor when the touched node is unnamed', () => {
    const target: Node = {
      memoizedProps: {},
      return: { memoizedProps: {}, return: { memoizedProps: { testID: 'submit-row' } } },
    };
    expect(pressLabel(event(target))).toBe('submit-row');
  });

  it('finds literal text nested in children arrays', () => {
    const target: Node = {
      memoizedProps: { children: [null, [{ notText: true }, 'Přidat fotku']] },
    };
    expect(pressLabel(event(target))).toBe('Přidat fotku');
  });

  it('caps runaway walks and degrades to undefined on foreign shapes', () => {
    // A cycle must terminate via the hop cap, not hang.
    const a: Node = { memoizedProps: {} };
    a.return = a;
    expect(pressLabel(event(a))).toBeUndefined();

    expect(pressLabel(event(null))).toBeUndefined();
    expect(pressLabel({})).toBeUndefined();
    expect(pressLabel(null)).toBeUndefined();
    expect(pressLabel({ _targetInst: { memoizedProps: null } })).toBeUndefined();
  });

  it('never leaks credential-shaped label content', () => {
    const target: Node = {
      memoizedProps: { accessibilityLabel: 'token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.x' },
    };
    const out = pressLabel(event(target));
    expect(out).toBeDefined();
    expect(out).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
  });
});
