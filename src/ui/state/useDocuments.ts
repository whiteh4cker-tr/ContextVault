import { useCallback, useEffect, useMemo, useState } from 'react';
import { api as defaultApi } from '../api';
import type { IpcApi } from '../../shared/ipc';
import type { DocumentRecord, RagProgressEvent } from '../../shared/types';

export interface DocumentsController {
  documents: DocumentRecord[];
  /** Latest progress event per document id. */
  progress: Record<string, RagProgressEvent>;
  /** Ids the retrieval step is allowed to consider. */
  activeIds: ReadonlySet<string>;
  /** True while any document is queued or indexing. */
  isIndexing: boolean;
  error: string | null;
  addPaths(paths: string[]): Promise<void>;
  remove(id: string): Promise<void>;
  setActive(id: string, active: boolean): Promise<void>;
  reindex(id: string): Promise<void>;
  progressFor(id: string): RagProgressEvent | undefined;
}

/** The document registry plus its live ingestion progress. */
export function useDocuments(api: IpcApi = defaultApi): DocumentsController {
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [progress, setProgress] = useState<Record<string, RagProgressEvent>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.listDocuments().then(setDocuments).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : String(cause));
    });
  }, [api]);

  // Progress events carry only what changed; the record itself is re-read when a
  // document reaches a terminal state, so the two views stay consistent without
  // every event having to ship the whole record.
  useEffect(() => {
    const off = api.onRagProgress((event) => {
      setProgress((prev) => ({ ...prev, [event.docId]: event }));
      if (event.stage === 'ready' || event.stage === 'failed') {
        void api.listDocuments().then(setDocuments);
      }
    });
    return off;
  }, [api]);

  const adopt = useCallback(async (call: () => Promise<DocumentRecord[]>) => {
    try {
      setDocuments(await call());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  const activeIds = useMemo(
    () => new Set(documents.filter((d) => d.active && d.status.state === 'ready').map((d) => d.id)),
    [documents],
  );

  const isIndexing = useMemo(
    () => documents.some((d) => d.status.state === 'queued' || d.status.state === 'indexing'),
    [documents],
  );

  return {
    documents,
    progress,
    activeIds,
    isIndexing,
    error,
    addPaths: (paths) => adopt(() => api.addDocuments({ paths })),
    remove: (id) => {
      setProgress(({ [id]: _dropped, ...rest }) => rest);
      return adopt(() => api.removeDocument({ id }));
    },
    setActive: (id, active) => adopt(() => api.setDocumentActive({ id, active })),
    reindex: (id) => {
      setProgress(({ [id]: _dropped, ...rest }) => rest);
      return adopt(async () => {
        await api.reindexDocument({ id });
        return api.listDocuments();
      });
    },
    progressFor: (id) => progress[id],
  };
}
