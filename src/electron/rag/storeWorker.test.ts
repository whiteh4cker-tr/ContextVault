import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serve } from './storeWorker';

/**
 * These run against a single index, in declaration order.
 *
 * ruvector's native backend keeps an arena per open index and aborts the process
 * when a second one is opened in the same process — and the wrapper exposes no
 * close that reliably releases the first. So one file, one index, sequential
 * assertions: the shape of this file is a direct consequence of how the library
 * behaves, not a preference.
 */
let tempDir = '';
let opened = 0;

function metadata(documentId: string, text: string, page = 1, chunkIndex = 0) {
  return { documentId, documentName: `${documentId}.pdf`, page, chunkIndex, text, start: 0, end: text.length };
}

beforeAll(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'contextvault-index-'));
  const result = (await serve({
    id: ++opened,
    type: 'open',
    payload: { indexPath: path.join(tempDir, 'corpus-4-cosine.rvf'), dimensions: 4, metric: 'cosine' },
  })) as { count: number };
  expect(result.count).toBe(0);
});

afterAll(async () => {
  await serve({ id: ++opened, type: 'close' });
  await rm(tempDir, { recursive: true, force: true });
});

describe('index worker', () => {
  it('stores passages and returns them closest first', async () => {
    const inserted = (await serve({
      id: ++opened,
      type: 'insert',
      payload: {
        records: [
          { id: 'far:0', vector: [0, 1, 0, 0], metadata: metadata('far', 'unrelated topic', 3) },
          { id: 'near:0', vector: [1, 0, 0, 0], metadata: metadata('near', 'exact match', 7, 4) },
          { id: 'close:0', vector: [0.9, 0.1, 0, 0], metadata: metadata('close', 'nearly identical', 9) },
        ],
      },
    })) as { count: number };
    expect(inserted.count).toBe(3);

    const { hits } = (await serve({ id: ++opened, type: 'search', payload: { vector: [1, 0, 0, 0], k: 3 } })) as {
      hits: { id: string; distance: number; metadata: { text: string } }[];
    };

    expect(hits.map((hit) => hit.id)).toEqual(['near:0', 'close:0', 'far:0']);
    // Distances, not similarities: an identical vector is zero apart, and the
    // conversion to similarity happens once, in the parent.
    expect(hits[0]!.distance).toBeLessThan(hits[1]!.distance);
    expect(hits[1]!.distance).toBeLessThan(hits[2]!.distance);
  });

  it('carries the citation metadata through so a hit needs no second lookup', async () => {
    const { hits } = (await serve({ id: ++opened, type: 'search', payload: { vector: [1, 0, 0, 0], k: 1 } })) as {
      hits: { id: string; metadata: Record<string, unknown> }[];
    };

    expect(hits[0]!.id).toBe('near:0');
    expect(hits[0]!.metadata).toMatchObject({
      documentId: 'near',
      documentName: 'near.pdf',
      page: 7,
      chunkIndex: 4,
      text: 'exact match',
    });
  });

  it('deletes the vectors of one document and leaves the rest searchable', async () => {
    const removed = (await serve({
      id: ++opened,
      type: 'delete',
      payload: { ids: ['near:0', 'close:0'] },
    })) as { removed: number; count: number };

    expect(removed.removed).toBe(2);
    expect(removed.count).toBe(1);

    const { hits } = (await serve({ id: ++opened, type: 'search', payload: { vector: [1, 0, 0, 0], k: 5 } })) as {
      hits: { id: string }[];
    };
    expect(hits.map((hit) => hit.id)).toEqual(['far:0']);
  });

  it('refuses a query whose width does not match the index', async () => {
    await expect(serve({ id: ++opened, type: 'search', payload: { vector: [1, 0], k: 1 } })).rejects.toThrow(
      /dimension/i,
    );
  });

  it('reports a closed index instead of crashing the caller', async () => {
    await serve({ id: ++opened, type: 'close' });
    await expect(serve({ id: ++opened, type: 'search', payload: { vector: [1, 0, 0, 0], k: 1 } })).rejects.toThrow(
      /not open/i,
    );
  });
});
