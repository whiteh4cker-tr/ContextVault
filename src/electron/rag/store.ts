import { fork } from 'node:child_process';
import type { IIndex, StoreHit, StoreRecord } from './storeTypes.js';

/** The minimal child-process shape this client needs, so Electron and Node both fit. */
export interface SpawnedWorker {
  post(message: unknown): void;
  onMessage(cb: (data: unknown) => void): void;
  onExit(cb: (code: number | null) => void): void;
  kill(): void;
}

export type WorkerLauncher = (workerPath: string) => SpawnedWorker;

/** Plain Node child. Used by the tests, and by any non-Electron host. */
export const forkLauncher: WorkerLauncher = (workerPath) => {
  const child = fork(workerPath, [], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
  return {
    post: (message) => child.send?.(message as never),
    onMessage: (cb) => child.on('message', cb),
    onExit: (cb) => child.on('exit', (code) => cb(code)),
    kill: () => child.kill(),
  };
};

/**
 * Electron's `utilityProcess`, injected lazily so this module stays importable in
 * a plain Node test run where `electron` is not resolvable.
 */
export function utilityProcessLauncher(electron: {
  utilityProcess: { fork(path: string): SpawnedWorker };
}): WorkerLauncher {
  return (workerPath) => electron.utilityProcess.fork(workerPath);
}

export interface VectorStoreOptions {
  /** Compiled path of `storeWorker.js`. */
  workerPath: string;
  indexPath: string;
  dimensions: number;
  metric?: string;
  launcher?: WorkerLauncher;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

/**
 * Client for the index-holding child process.
 *
 * Three things are non-negotiable here, and each is a consequence of something
 * measured rather than assumed:
 *
 * - **One index per process.** A second live index in one process aborts it, so
 *   the child owns the only one and the parent never touches the native library.
 * - **Serialized requests.** Native writes are not safe to interleave; a queue
 *   costs nothing at this scale and removes a class of corruption.
 * - **Restart on death.** If the child goes down, the next call respawns it and
 *   reopens the same file. The index survives because it is on disk, so a crash
 *   costs one failed call rather than the corpus.
 */
export class VectorStore implements IIndex {
  private readonly options: VectorStoreOptions;
  private readonly launcher: WorkerLauncher;
  private child: SpawnedWorker | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private chain: Promise<unknown> = Promise.resolve();
  private opened = false;
  private stopping = false;

  constructor(options: VectorStoreOptions) {
    this.options = options;
    this.launcher = options.launcher ?? forkLauncher;
  }

  private async ensureChild(): Promise<SpawnedWorker> {
    if (this.child) return this.child;

    const child = this.launcher(this.options.workerPath);
    child.onMessage((data) => {
      const message = data as { id: number; ok: boolean; result?: unknown; error?: string };
      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      this.pending.delete(message.id);
      if (message.ok) waiter.resolve(message.result);
      else waiter.reject(new Error(message.error ?? 'Index process reported a failure'));
    });
    child.onExit(() => {
      // Everything in flight fails rather than hanging: the caller sees an error
      // it can show, and the next call starts a fresh child.
      this.child = null;
      this.opened = false;
      for (const waiter of this.pending.values()) waiter.reject(new Error('Index process stopped unexpectedly'));
      this.pending.clear();
    });

    this.child = child;
    await this.rawRequest<{ count: number }>('open', {
      indexPath: this.options.indexPath,
      dimensions: this.options.dimensions,
      metric: this.options.metric ?? 'cosine',
    });
    this.opened = true;
    return child;
  }

  private rawRequest<T>(type: string, payload: unknown): Promise<T> {
    const child = this.child;
    if (!child) return Promise.reject(new Error('Index process is not running'));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      child.post({ id, type, payload } as never);
    });
  }

  /** Run one operation, after every operation already queued. */
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.chain.then(operation, operation);
    // The chain must swallow failures or one rejected call would poison every
    // later operation.
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async insert(records: StoreRecord[]): Promise<{ count: number }> {
    if (records.length === 0) return { count: await this.count() };
    return this.enqueue(async () => {
      await this.ensureChild();
      return this.rawRequest<{ count: number }>('insert', { records });
    });
  }

  async search(vector: number[], k: number): Promise<StoreHit[]> {
    return this.enqueue(async () => {
      if (!(await this.hasIndex())) return [];
      await this.ensureChild();
      const { hits } = await this.rawRequest<{ hits: StoreHit[] }>('search', { vector, k });
      return hits;
    });
  }

  async deleteIds(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    return this.enqueue(async () => {
      if (!(await this.hasIndex())) return 0;
      await this.ensureChild();
      const { removed } = await this.rawRequest<{ removed: number }>('delete', { ids });
      return removed;
    });
  }

  async count(): Promise<number> {
    return this.enqueue(async () => {
      if (!this.child && !this.options.indexPath) return 0;
      await this.ensureChild();
      const { count } = await this.rawRequest<{ count: number }>('count', {});
      return count;
    });
  }

  async stop(): Promise<void> {
    this.stopping = true;
    const child = this.child;
    this.child = null;
    this.opened = false;
    if (!child) return;
    try {
      child.kill();
    } catch {
      /* already gone */
    }
  }

  private async hasIndex(): Promise<boolean> {
    if (this.opened) return true;
    try {
      await this.ensureChild();
      return true;
    } catch {
      return false;
    }
  }

  /** True when the child died and the next call will restart it. */
  get unhealthy(): boolean {
    return !this.stopping && this.child === null && this.opened === false;
  }
}
