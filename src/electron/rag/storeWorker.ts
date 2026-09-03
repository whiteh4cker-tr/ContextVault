/**
 * The only process that is allowed to hold a vector index open.
 *
 * ruvector's native backend reserves a large arena per index, and a second live
 * index in the same process does not fail cleanly — it aborts the process. One
 * index per process, therefore, and the process exists only to serve index
 * requests. If it dies, the parent restarts it and reopens the file; nothing
 * except the transient state of one call is lost.
 *
 * Runs under Electron's `utilityProcess` in the application and under a plain
 * Node `fork` in tests, which is what lets the whole store be exercised without a
 * window.
 */
import { VectorDb } from 'ruvector';

export interface Request {
  id: number;
  type: 'open' | 'insert' | 'search' | 'delete' | 'count' | 'close';
  payload?: Record<string, unknown>;
}

let db: InstanceType<typeof VectorDb> | null = null;

/**
 * Graph parameters for the index, including the declared capacity.
 *
 * `maxElements` is not cosmetic, and its default is a trap. When a caller omits
 * `hnswConfig`, ruvector's JavaScript wrapper supplies `maxElements: 10_000_000`
 * and the native side reserves against that number during construction: opening an
 * index for a 100-chunk invoice aborted this process while asking the allocator for
 * 3.6 GB, twice the size of the embedding model.
 *
 * Declaring a capacity costs nothing measurable — 100 vectors of 2560 dimensions
 * with a capacity of 1 000 000 use 15 MB resident and a 2.6 MB file, the same as a
 * capacity of 1 000 — and writing past the declared figure is accepted rather than
 * refused. So it is a planning number, chosen to hold a large contract corpus
 * without a resize, not a wall.
 */
const INDEX_GRAPH = { m: 32, efConstruction: 200, efSearch: 100, maxElements: 1_000_000 };

function post(message: unknown): void {
  const parentPort = (process as unknown as { parentPort?: { postMessage(message: unknown): void } }).parentPort;
  if (parentPort) parentPort.postMessage(message);
  else process.send?.(message);
}

function receive(handler: (data: unknown) => void): void {
  const parentPort = (
    process as unknown as { parentPort?: { on(event: 'message', cb: (event: unknown) => void): void } }
  ).parentPort;
  if (parentPort) parentPort.on('message', (event) => handler((event as { data?: unknown }).data ?? event));
  else process.on('message', (data) => handler(data));
}

/** Exported so the request handler can be tested without a child process. */
export async function serve(request: Request): Promise<unknown> {
  const payload = (request.payload ?? {}) as Record<string, never>;

  switch (request.type) {
    case 'open': {
      const { indexPath, dimensions, metric, hnswConfig } = payload as unknown as {
        indexPath: string;
        dimensions: number;
        metric: string;
        hnswConfig?: Record<string, unknown>;
      };
      // Reopening the same schema is a no-op: a restart will almost always ask
      // for the index that was already open a moment ago.
      if (db) return { count: await db.len() };
      db = new VectorDb({
        storagePath: indexPath,
        dimensions,
        distanceMetric: metric,
        // Spread rather than substituted: a caller-supplied configuration that
        // forgets `maxElements` must not fall back into the 10 000 000 default.
        hnswConfig: { ...INDEX_GRAPH, ...(hnswConfig ?? {}) },
      });
      return { count: await db.len() };
    }

    case 'insert': {
      const { records } = payload as unknown as {
        records: { id: string; vector: number[]; metadata: Record<string, unknown> }[];
      };
      if (!db) throw new Error('Index is not open');
      await db.insertBatch(records.map((record) => ({ id: record.id, vector: record.vector, metadata: record.metadata })));
      return { count: await db.len() };
    }

    case 'search': {
      const { vector, k } = payload as unknown as { vector: number[]; k: number };
      if (!db) throw new Error('Index is not open');
      const hits = await db.search({ vector, k });
      // `score` from ruvector is a distance: identical vectors score 0.0. The
      // conversion to a similarity happens once, in the parent, so the meaning of
      // the number is not spread across the codebase.
      return { hits: hits.map((hit) => ({ id: hit.id, distance: hit.score, metadata: hit.metadata ?? {} })) };
    }

    case 'delete': {
      const { ids } = payload as unknown as { ids: string[] };
      if (!db) throw new Error('Index is not open');
      let removed = 0;
      for (const id of ids) if (await db.delete(id)) removed += 1;
      return { removed, count: await db.len() };
    }

    case 'count': {
      if (!db) return { count: 0 };
      return { count: await db.len() };
    }

    case 'close': {
      // There is no explicit flush in the wrapper: the native backend writes as
      // it goes, which is why an interrupted session still finds its index on
      // restart.
      db = null;
      return { ok: true };
    }

    default:
      throw new Error(`Unknown request type: ${(request as Request).type}`);
  }
}

receive((data) => {
  const request = data as Request;
  if (typeof request?.id !== 'number') return;
  void serve(request)
    .then((result) => post({ id: request.id, ok: true, result }))
    .catch((error: unknown) =>
      post({ id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) }),
    );
});
