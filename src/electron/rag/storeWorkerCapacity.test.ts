import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { serve } from './storeWorker';

/**
 * Opening an index at a realistic embedding width.
 *
 * This is the shape that killed the index process in a live run: a hundred passages
 * of 2560 dimensions, which the library's default `maxElements` of ten million
 * turned into a 3.6 GB reservation at construction. Every other test in this suite
 * opens a four-dimensional index, where the same default costs 160 MB and goes
 * unnoticed — which is exactly why the bug reached a window.
 *
 * It is a separate file because a second live index in one process aborts it; the
 * abort is what a regression here looks like, and it should fail this file rather
 * than the suite that follows it.
 */
describe('index worker at production width', () => {
  it('opens a 2560-dimensional index and stores passages without reserving gigabytes', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'contextvault-wide-'));
    try {
      const dimensions = 2560;
      const opened = (await serve({
        id: 1,
        type: 'open',
        payload: { indexPath: path.join(tempDir, 'corpus-2560-cosine.rvf'), dimensions, metric: 'cosine' },
      })) as { count: number };
      expect(opened.count).toBe(0);

      const vector = (seed: number): number[] =>
        Array.from({ length: dimensions }, (_, d) => Math.sin((seed + 1) * (d + 1) * 0.001));

      const inserted = (await serve({
        id: 2,
        type: 'insert',
        payload: {
          records: [0, 1, 2].map((index) => ({
            id: 'doc-a:' + index,
            vector: vector(index),
            metadata: { documentId: 'doc-a', documentName: 'invoice.pdf', page: 1, chunkIndex: index, text: 'clause ' + index },
          })),
        },
      })) as { count: number };
      expect(inserted.count).toBe(3);

      const found = (await serve({ id: 3, type: 'search', payload: { vector: vector(1), k: 3 } })) as {
        hits: { id: string; distance: number }[];
      };
      expect(found.hits.map((hit) => hit.id)).toEqual(['doc-a:1', 'doc-a:2', 'doc-a:0']);
      // A process that had reserved 3.6 GB would not have survived to this line;
      // this assertion only says the work was done, which is the observable part.
      expect(found.hits[0]?.distance).toBeCloseTo(0, 5);

      await serve({ id: 4, type: 'close' });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
