import { useCallback, useEffect, useState } from 'react';
import { api as defaultApi } from '../api';
import type { IpcApi } from '../../shared/ipc';
import type {
  ContextBounds,
  ModelCatalogEntry,
  ModelFileInfo,
  ModelRole,
  ModelStatusSnapshot,
} from '../../shared/types';

export interface DownloadState {
  role: ModelRole;
  fileName: string;
  percent: number;
  transferred: number;
  total: number;
}

export interface ModelsController {
  status: ModelStatusSnapshot | null;
  catalog: ModelCatalogEntry[];
  installed: ModelFileInfo[];
  /** Measured limits for the context slider; null until the first measurement. */
  bounds: ContextBounds | null;
  download: DownloadState | null;
  error: string | null;
  refresh(): Promise<void>;
  select(role: ModelRole, fileName: string): Promise<void>;
  remove(role: ModelRole, fileName: string): Promise<void>;
  downloadEntry(role: ModelRole, entry: ModelCatalogEntry): Promise<void>;
  cancel(role: ModelRole): Promise<void>;
  importFile(role: ModelRole, path: string): Promise<void>;
  applyContextSize(contextSize: number): Promise<void>;
}

/**
 * Model catalog, installed files, download progress and the measured context
 * bounds. Everything the LLM panel needs, and nothing the chat needs.
 */
export function useModels(api: IpcApi = defaultApi): ModelsController {
  const [status, setStatus] = useState<ModelStatusSnapshot | null>(null);
  const [catalog, setCatalog] = useState<ModelCatalogEntry[]>([]);
  const [installed, setInstalled] = useState<ModelFileInfo[]>([]);
  const [bounds, setBounds] = useState<ContextBounds | null>(null);
  const [download, setDownload] = useState<DownloadState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [nextStatus, nextCatalog, nextInstalled, nextBounds] = await Promise.all([
        api.modelStatus(),
        api.modelCatalog(),
        api.listModels(),
        api.contextBounds({}),
      ]);
      setStatus(nextStatus);
      setCatalog(nextCatalog);
      setInstalled(nextInstalled);
      setBounds(nextBounds);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const off = api.onModelEvent((event) => {
      if (event.kind === 'status') {
        setStatus(event.status);
        if (event.status.chat.state !== 'downloading') setDownload(null);
        void api.listModels().then(setInstalled);
        void api.contextBounds({}).then(setBounds);
      } else {
        setDownload({
          role: event.role,
          fileName: event.fileName,
          percent: event.percent,
          transferred: event.transferred,
          total: event.total,
        });
      }
    });
    return off;
  }, [api]);

  /** Runs an action and adopts the status snapshot it returns. */
  const run = useCallback(async (action: () => Promise<ModelStatusSnapshot>) => {
    try {
      setStatus(await action());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  return {
    status,
    catalog,
    installed,
    bounds,
    download,
    error,
    refresh,
    select: (role, fileName) => run(() => api.selectModel({ role, fileName })),
    remove: (role, fileName) => run(() => api.deleteModel({ role, fileName })),
    downloadEntry: async (role, entry) => {
      setDownload({ role, fileName: entry.fileName, percent: 0, transferred: 0, total: entry.sizeBytes });
      try {
        await api.downloadModel({ role, url: entry.url, fileName: entry.fileName });
        await refresh();
      } catch (cause) {
        setDownload(null);
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    },
    cancel: async (role) => {
      setDownload(null);
      await api.cancelDownload({ role });
    },
    importFile: async (role, path) => {
      try {
        await api.importModel({ role, path });
        await refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    },
    applyContextSize: (contextSize) => run(() => api.setContextSize({ contextSize })),
  };
}
