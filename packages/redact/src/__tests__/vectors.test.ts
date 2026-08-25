/**
 * Conformance runner for spec/vectors.json — the language-agnostic contract
 * every redaction engine implementation must pass. This TS engine is the
 * reference implementation; a Dart/Swift/Kotlin port runs the same file
 * through its own runner.
 */
import { describe, expect, test } from 'bun:test';

import {
  compileRules,
  redactBody,
  redactHeaders,
  redactUrl,
  sensitiveHeader,
  type RedactionPolicy,
} from '../index';

import vectors from '../../spec/vectors.json';

interface VectorCase {
  name: string;
  surface: 'headerName' | 'headers' | 'body' | 'url';
  policy?: RedactionPolicy;
  sensitive?: boolean;
  inputs?: string[];
  input?: string | Record<string, string>;
  contentType?: string;
  exact?: string;
  mustNotContain?: string[];
  mustContain?: string[];
  outputIsJson?: boolean;
  redactedKeys?: string[];
  keptEntries?: Record<string, string>;
  valueMustNotContain?: Record<string, string[]>;
}

describe('spec/vectors.json conformance', () => {
  for (const c of (vectors as { cases: VectorCase[] }).cases) {
    test(c.name, () => {
      const rules = compileRules(c.policy ?? null);
      switch (c.surface) {
        case 'headerName': {
          for (const name of c.inputs ?? []) {
            expect(sensitiveHeader(rules, name)).toBe(c.sensitive === true);
          }
          break;
        }
        case 'headers': {
          const out = redactHeaders(rules, c.input as Record<string, string>);
          expect(out).toBeDefined();
          for (const k of c.redactedKeys ?? []) {
            expect(out?.[k]).toBe('[redacted]');
          }
          for (const [k, v] of Object.entries(c.keptEntries ?? {})) {
            expect(out?.[k]).toBe(v);
          }
          for (const [k, subs] of Object.entries(c.valueMustNotContain ?? {})) {
            for (const s of subs) expect(out?.[k] ?? '').not.toContain(s);
          }
          break;
        }
        case 'body': {
          const out = redactBody(rules, c.input as string, c.contentType);
          if (c.exact !== undefined) expect(out).toBe(c.exact);
          for (const s of c.mustNotContain ?? []) expect(out).not.toContain(s);
          for (const s of c.mustContain ?? []) expect(out).toContain(s);
          if (c.outputIsJson) expect(() => JSON.parse(out)).not.toThrow();
          break;
        }
        case 'url': {
          const out = redactUrl(rules, c.input as string);
          if (c.exact !== undefined) expect(out).toBe(c.exact);
          for (const s of c.mustNotContain ?? []) expect(out).not.toContain(s);
          for (const s of c.mustContain ?? []) expect(out).toContain(s);
          break;
        }
      }
    });
  }
});
