import { useCallback, useEffect, useState } from 'react';
import { api as defaultApi } from '../api';
import type { IpcApi } from '../../shared/ipc';
import type { ChunkingSettings, RetrievalSettings } from '../../shared/types';

export interface SettingsController {
  retrieval: RetrievalSettings;
  chunking: ChunkingSettings;
  setTopK(topK: number): Promise<void>;
  setFloor(floor: number): Promise<void>;
  setChunking(next: ChunkingSettings): Promise<void>;
  error: string | null;
}

const DEFAULT_RETRIEVAL: RetrievalSettings = { topK: 5, floor: 0.25 };
const DEFAULT_CHUNKING: ChunkingSettings = { chunkSize: 1000, chunkOverlap: 150 };

/**
 * Retrieval and chunking controls.
 *
 * Both are optimistic: the control moves immediately and rolls back if the
 * backend rejects, because a slider that snaps back to its old value after every
 * failed write is indistinguishable from a broken UI.
 */
export function useSettings(api: IpcApi = defaultApi): SettingsController {
  const [retrieval, setRetrieval] = useState<RetrievalSettings>(DEFAULT_RETRIEVAL);
  const [chunking, setChunking] = useState<ChunkingSettings>(DEFAULT_CHUNKING);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([api.getRetrievalSettings(), api.getChunkingSettings()]).then(([r, c]) => {
      if (cancelled) return;
      setRetrieval(r);
      setChunking(c);
    });
    return () => {
      cancelled = true;
    };
  }, [api]);

  const write = useCallback(
    async (
      optimistic: () => void,
      call: () => Promise<RetrievalSettings | ChunkingSettings>,
      adopt: (value: RetrievalSettings | ChunkingSettings) => void,
      rollback: () => void,
    ) => {
      optimistic();
      try {
        adopt(await call());
        setError(null);
      } catch (cause) {
        rollback();
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [],
  );

  const snapshotRetrieval = retrieval;
  const snapshotChunking = chunking;

  return {
    retrieval,
    chunking,
    error,
    setTopK: (topK) =>
      write(
        () => setRetrieval((s) => ({ ...s, topK })),
        () => api.setRetrievalSettings({ ...retrieval, topK }),
        (value) => setRetrieval(value as RetrievalSettings),
        () => setRetrieval(snapshotRetrieval),
      ),
    setFloor: (floor) =>
      write(
        () => setRetrieval((s) => ({ ...s, floor })),
        () => api.setRetrievalSettings({ ...retrieval, floor }),
        (value) => setRetrieval(value as RetrievalSettings),
        () => setRetrieval(snapshotRetrieval),
      ),
    setChunking: (next) =>
      write(
        () => setChunking(next),
        () => api.setChunkingSettings(next),
        (value) => setChunking(value as ChunkingSettings),
        () => setChunking(snapshotChunking),
      ),
  };
}
