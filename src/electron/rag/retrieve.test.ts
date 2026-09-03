import { describe, expect, it } from 'vitest';
import { overFetchDepth, passagesFromHits, selectPassages } from './retrieve';
import type { StoreHit } from './storeTypes';

function hit(id: string, distance: number, over: Partial<StoreHit['metadata']> = {}): StoreHit {
  const [documentId, chunkIndex] = id.split(':');
  return {
    id,
    distance,
    metadata: {
      documentId,
      documentName: `${documentId}.pdf`,
      page: 4,
      chunkIndex: Number(chunkIndex ?? 0),
      text: `text of ${id}`,
      start: 0,
      end: 10,
      ...over,
    },
  };
}

describe('passagesFromHits', () => {
  it('converts distance into similarity', () => {
    const [passage] = passagesFromHits([hit('doc-1:0', 0.2)]);
    expect(passage?.similarity).toBeCloseTo(0.8);
  });

  it('carries page and offsets through for citation', () => {
    const [passage] = passagesFromHits([hit('doc-1:3', 0.1, { page: 17, start: 500, end: 900 })]);
    expect(passage).toMatchObject({ page: 17, chunkIndex: 3, start: 500, end: 900, documentName: 'doc-1.pdf' });
  });

  it('drops a hit it cannot read rather than inventing a reference', () => {
    const passages = passagesFromHits([
      hit('doc-1:0', 0.1),
      { id: 'broken:0', distance: 0.1, metadata: {} },
      { id: 'notext:0', distance: 0.1, metadata: { documentId: 'notext' } },
    ]);
    expect(passages.map((p) => p.documentId)).toEqual(['doc-1']);
  });
});

describe('selectPassages', () => {
  const hits = [
    hit('off:0', 0.05),
    hit('good:0', 0.1),
    hit('weak:0', 0.9),
    hit('good:1', 0.2),
    hit('gone:0', 0.08),
  ];
  const passages = passagesFromHits(hits);
  // `off` is switched off in the registry and `gone` was deleted; both still have
  // vectors sitting in the index, which is exactly why the filter has to exist.
  const active = new Set(['good', 'weak']);

  it('excludes documents that are not active, however close they are', () => {
    const selected = selectPassages(passages, { topK: 5, floor: 0, activeDocumentIds: active });
    expect(selected.map((p) => p.documentId)).not.toContain('gone');
    expect(selected.map((p) => p.documentId)).not.toContain('off');
  });

  it('excludes passages below the floor and keeps one exactly at it', () => {
    const selected = selectPassages(passages, { topK: 5, floor: 0.1, activeDocumentIds: active });
    // weak:0 sits exactly at the floor, so it is kept.
    expect(selected.map((p) => p.chunkId)).toEqual(['good:0', 'good:1', 'weak:0']);
  });

  it('ranks best-matching first', () => {
    const selected = selectPassages(passages, { topK: 5, floor: 0, activeDocumentIds: active });
    expect(selected.map((p) => p.similarity)).toEqual([...selected.map((p) => p.similarity)].sort((a, b) => b - a));
  });

  it('cuts to topK after filtering, so a filtered hit does not cost a slot', () => {
    const selected = selectPassages(passages, { topK: 1, floor: 0, activeDocumentIds: active });
    expect(selected.map((p) => p.chunkId)).toEqual(['good:0']);
  });

  it('returns nothing when no document is active', () => {
    expect(selectPassages(passages, { topK: 3, floor: 0, activeDocumentIds: new Set() })).toEqual([]);
  });
});

describe('overFetchDepth', () => {
  it('asks for enough neighbours to survive filtering', () => {
    expect(overFetchDepth(5)).toBe(15);
    expect(overFetchDepth(1)).toBeGreaterThanOrEqual(3);
  });
});
