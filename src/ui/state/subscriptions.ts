import type { IpcApi } from '../../shared/ipc';
import type { ChatChunkEvent, ModelEvent, RagProgressEvent, SystemStats } from '../../shared/types';

/**
 * Subscribe to every backend event channel at once.
 *
 * Keeping the wiring in one place means a new channel cannot be forgotten in one
 * of the hooks, and every subscription leaves through the same cleanup path.
 */
export interface Subscriptions {
  onModelEvent?: (event: ModelEvent) => void;
  onRagProgress?: (event: RagProgressEvent) => void;
  onChatChunk?: (event: ChatChunkEvent) => void;
  onSystemStats?: (stats: SystemStats) => void;
}

/** Returns one function that unsubscribes from everything it registered. */
export function subscribe(api: IpcApi, handlers: Subscriptions): () => void {
  const offs: Array<() => void> = [];
  if (handlers.onModelEvent) offs.push(api.onModelEvent(handlers.onModelEvent));
  if (handlers.onRagProgress) offs.push(api.onRagProgress(handlers.onRagProgress));
  if (handlers.onChatChunk) offs.push(api.onChatChunk(handlers.onChatChunk));
  if (handlers.onSystemStats) offs.push(api.onSystemStats(handlers.onSystemStats));
  return () => {
    for (const off of offs) off();
  };
}
