import { describe, expect, it } from 'vitest';
import {
  confidenceLabel,
  estimateContextBytes,
  formatBytes,
  formatGrouped,
  formatTokens,
  largestSafeContext,
  passesFloor,
  selectTopK,
  similarityFromDistance,
} from './budget';

/** Build a row the way retrieval does: distance in, similarity derived. */
const row = (docId: string, distance: number) => ({
  docId,
  distance,
  similarity: similarityFromDistance(distance),
});

describe('similarityFromDistance', () => {
  it('treats a zero distance as an identical vector', () => {
    expect(similarityFromDistance(0)).toBe(1);
  });

  it('inverts the remaining range monotonically', () => {
    expect(similarityFromDistance(0.25)).toBeCloseTo(0.75);
    expect(similarityFromDistance(1)).toBe(0);
  });
});

describe('passesFloor', () => {
  it('is inclusive at the boundary', () => {
    expect(passesFloor(0.25, 0.25)).toBe(true);
    expect(passesFloor(0.249, 0.25)).toBe(false);
  });
});

describe('selectTopK', () => {
  it('drops documents the registry says are inactive', () => {
    const rows = [row('a', 0.1), row('b', 0.2), row('c', 0.05)];
    const out = selectTopK(rows, { topK: 3, floor: 0, activeDocIds: new Set(['a', 'c']) });
    expect(out.map((r) => r.docId)).toEqual(['c', 'a']);
  });

  it('orders by similarity rather than by arrival', () => {
    const rows = [row('a', 0.4), row('b', 0.05), row('c', 0.2)];
    const out = selectTopK(rows, { topK: 3, floor: 0, activeDocIds: new Set(['a', 'b', 'c']) });
    expect(out.map((r) => r.docId)).toEqual(['b', 'c', 'a']);
  });

  it('applies the floor after activity filtering, so filtering cannot starve results', () => {
    const rows = [row('a', 0.1), row('b', 0.2)];
    const out = selectTopK(rows, { topK: 5, floor: 0.8, activeDocIds: new Set(['a']) });
    expect(out.map((r) => r.docId)).toEqual(['a']);
  });

  it('never returns more than topK', () => {
    const rows = [row('a', 0.1), row('b', 0.2), row('c', 0.3)];
    expect(selectTopK(rows, { topK: 2, floor: 0, activeDocIds: new Set(['a', 'b', 'c']) })).toHaveLength(2);
  });

  it('does not mutate the caller’s array', () => {
    const rows = [row('b', 0.2), row('a', 0.1)];
    const snapshot = rows.map((r) => r.docId);
    selectTopK(rows, { topK: 2, floor: 0, activeDocIds: new Set(['a', 'b']) });
    expect(rows.map((r) => r.docId)).toEqual(snapshot);
  });

  it('returns nothing when every hit belongs to an inactive document', () => {
    const rows = [row('a', 0.0), row('b', 0.1)];
    expect(selectTopK(rows, { topK: 5, floor: 0, activeDocIds: new Set() })).toEqual([]);
  });
});

describe('largestSafeContext', () => {
  it('picks the largest step that fits the headroom after weights', () => {
    expect(
      largestSafeContext({ freeBytes: 8_000_000_000, weightsBytes: 6_700_000_000, bytesPerToken: 200_000 }),
    ).toBe(4096);
  });

  it('falls back to the minimum instead of reporting an impossible zero', () => {
    expect(
      largestSafeContext({ freeBytes: 0, weightsBytes: 6_700_000_000, bytesPerToken: 200_000 }),
    ).toBe(256);
  });

  it('never exceeds the model’s trained context', () => {
    expect(
      largestSafeContext({ freeBytes: 1e12, weightsBytes: 0, bytesPerToken: 1, maxContext: 16384 }),
    ).toBe(16384);
  });

  it('lands exactly on a step rather than on the arithmetic ceiling', () => {
    // 20 000 tokens would fit, but 16 384 is the largest offered size.
    expect(
      largestSafeContext({ freeBytes: 20_000 * 1000 + 500, weightsBytes: 500, bytesPerToken: 1000, maxContext: 20000 }),
    ).toBe(16384);
  });
});

describe('estimateContextBytes', () => {
  it('adds weights and KV cache', () => {
    expect(estimateContextBytes(1000, 10, 256)).toBe(3560);
  });
});

describe('confidenceLabel', () => {
  it('names the bands the citation chips render', () => {
    expect(confidenceLabel(0.9)).toBe('strong');
    expect(confidenceLabel(0.75)).toBe('strong');
    expect(confidenceLabel(0.6)).toBe('moderate');
    expect(confidenceLabel(0.45)).toBe('moderate');
    expect(confidenceLabel(0.3)).toBe('weak');
  });
});

describe('formatting', () => {
  it('abbreviates token counts without losing an order of magnitude', () => {
    expect(formatTokens(512)).toBe('512');
    expect(formatTokens(1500)).toBe('1.5k');
    expect(formatTokens(16384)).toBe('16k');
  });

  it('formats bytes in the unit a person would use', () => {
    expect(formatBytes(999)).toBe('999 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(6_720_000_000)).toBe('6.3 GB');
  });

  it('never formats a negative size as a real quantity', () => {
    expect(formatBytes(-5)).toBe('0 B');
  });

  it('groups token counts for the slider label', () => {
    expect(formatGrouped(16384)).toBe('16 384');
  });
});
