import { fork } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { VectorStore, type SpawnedWorker, type WorkerLauncher } from './store';
import type { StoreRecord } from './storeTypes';

/**
 * The client's job is protocol work across a process boundary: match replies to
 * requests, keep operations ordered, survive a dead child. That is only worth
 * testing against a real boundary, so these tests fork a real Node process
 * running a scripted stand-in for the index.
 *
 * The stand-ins are chosen so that nothing test-only is added to production code:
 * a worker that always fails exercises the rejection path, and a launcher that
 * hands back the child process exercises the crash-and-restart path.
 */
const WORKER_SOURCE = `
const store = new Map();

process.on('message', (request) => {
  const { id, type, payload } = request;
  const send = (message) => process.send(message);

  if (process.env.FAKE_INDEX_MODE === 'always-fail') {
    return send({ id, ok: false, error: 'simulated index failure' });
  }
  if (type === 'open' || type === 'count') return send({ id, ok: true, result: { count: store.size } });
  if (type === 'insert') {
    for (const record of payload.records) store.set(record.id, record);
    return send({ id, ok: true, result: { count: store.size } });
  }
  if (type === 'delete') {
    let removed = 0;
    for (const key of payload.ids) if (store.delete(key)) removed += 1;
    return send({ id, ok: true, result: { removed, count: store.size } });
  }
  if (type === 'search') {
    const hits = [...store.values()]
      .map((record) => ({ id: record.id, distance: Math.abs(1 - record.vector[0]), metadata: record.metadata }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, payload.k);
    return send({ id, ok: true, result: { hits } });
  }
  send({ id, ok: false, error: 'unknown request ' + type });
});
`;

let tempDir = '';
let workerPath = '';

function record(id: string, first: number): StoreRecord {
  const documentId = id.split(':')[0]!;
  return {
    id,
    vector: [first, 0, 0],
    metadata: {
      documentId,
      documentName: `${documentId}.txt`,
      page: 1,
      chunkIndex: 0,
      text: id,
      start: 0,
      end: id.length,
    },
  };
}

function createStore(launcher?: WorkerLauncher): VectorStore {
  return new VectorStore({
    workerPath,
    indexPath: path.join(tempDir, 'corpus-3-cosine.rvf'),
    dimensions: 3,
    ...(launcher ? { launcher } : {}),
  });
}

/** A launcher that keeps the last child handle so a test can kill it. */
function watchfulLauncher(seen: { child?: ReturnType<typeof fork> }): WorkerLauncher {
  return (path: string) => {
    const child = fork(path, [], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    seen.child = child;
    const wrapper: SpawnedWorker = {
      post: (message) => child.send?.(message),
      onMessage: (cb) => child.on('message', cb),
      onExit: (cb) => child.on('exit', (code) => cb(code)),
      kill: () => child.kill(),
    };
    return wrapper;
  };
}

beforeAll(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'contextvault-store-'));
  workerPath = path.join(tempDir, 'fakeWorker.cjs');
  await writeFile(workerPath, WORKER_SOURCE, 'utf8');
});

afterAll(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe('VectorStore client', () => {
  it('round-trips passages through the child process', async () => {
    const store = createStore();
    try {
      const inserted = await store.insert([record('alpha:0', 1), record('beta:0', 0.2)]);
      expect(inserted.count).toBe(2);

      const hits = await store.search([1, 0, 0], 2);
      expect(hits.map((hit) => hit.id)).toEqual(['alpha:0', 'beta:0']);
      expect(hits[0]!.metadata).toMatchObject({ documentName: 'alpha.txt' });
    } finally {
      await store.stop();
    }
  });

  it('deletes one document without touching the others', async () => {
    const store = createStore();
    try {
      await store.insert([record('doomed:0', 1), record('doomed:1', 0.9), record('kept:0', 0.1)]);
      expect(await store.deleteIds(['doomed:0', 'doomed:1'])).toBe(2);
      const hits = await store.search([1, 0, 0], 5);
      expect(hits.map((hit) => hit.id)).toEqual(['kept:0']);
    } finally {
      await store.stop();
    }
  });

  it('does not start an operation while an earlier one is still running', async () => {
    const store = createStore();
    try {
      await store.insert([record('a:0', 1)]);
      const order: string[] = [];
      const first = store.count().then(() => order.push('first'));
      const second = store.count().then(() => order.push('second'));
      await Promise.all([first, second]);
      expect(order).toEqual(['first', 'second']);
    } finally {
      await store.stop();
    }
  });

  it('turns a failure in the index process into a rejected call', async () => {
    const failing = path.join(tempDir, 'failingWorker.cjs');
    await writeFile(failing, WORKER_SOURCE, 'utf8');
    const store = new VectorStore({
      workerPath: failing,
      indexPath: path.join(tempDir, 'corpus-3-cosine.rvf'),
      dimensions: 3,
      launcher: (workerPathArg: string) => {
        const child = fork(workerPathArg, [], {
          stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
          env: { ...process.env, FAKE_INDEX_MODE: 'always-fail' },
        });
        return {
          post: (message) => child.send?.(message),
          onMessage: (cb) => child.on('message', cb),
          onExit: (cb) => child.on('exit', (code) => cb(code)),
          kill: () => child.kill(),
        };
      },
    });

    try {
      await expect(store.insert([record('a:0', 1)])).rejects.toThrow(/simulated index failure/);
    } finally {
      await store.stop();
    }
  });

  it('restarts the index process when it dies, and keeps working', async () => {
    const seen: { child?: ReturnType<typeof fork> } = {};
    const store = createStore(watchfulLauncher(seen));

    try {
      await store.insert([record('before:0', 1)]);
      expect(await store.count()).toBe(1);

      const exited = new Promise<void>((resolve) => seen.child!.once('exit', () => resolve()));
      seen.child!.kill();
      await exited;

      // The next call must transparently bring up a fresh process. Its memory
      // store starts empty, which is exactly the point: the client recovered
      // rather than replayed.
      const count = await store.count();
      expect(count).toBe(0);
      const inserted = await store.insert([record('after:0', 1)]);
      expect(inserted.count).toBe(1);
    } finally {
      await store.stop();
    }
  });
});
