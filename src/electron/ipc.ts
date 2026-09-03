import { BrowserWindow, ipcMain } from 'electron';
import { Channels } from '../shared/ipc.js';
import type { Backend } from './backend.js';

/**
 * The only place the main process becomes reachable.
 *
 * Every channel the renderer can call is registered here from the same list the
 * preload bridge exposes, so the two cannot drift apart and a channel that exists
 * on one side but not the other fails at the call rather than returning undefined.
 *
 * Push events are broadcast to every window. There is usually only one, and
 * deciding which window a progress event belongs to is not a problem worth having
 * in an application whose windows share all state.
 */
export function registerIpcHandlers(backend: Backend): void {
  const invokeChannels = Object.entries(Channels)
    .map(([method, channel]) => [method, channel] as const)
    .filter(([, channel]) => !channel.endsWith('.on'));

  for (const [, channel] of invokeChannels) {
    ipcMain.handle(channel, async (_event, args) => {
      try {
        return { ok: true, value: await backend.handle(channel, args) };
      } catch (error) {
        // The message is written for a person to read in the UI, so it is passed
        // through rather than collapsed into a code.
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    });
  }

  const broadcast = (channel: string, payload: unknown) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(channel, payload);
    }
  };

  backend.onModelEvent((event) => broadcast(Channels.modelEvent, event));
  backend.onRagProgress((event) => broadcast(Channels.ragProgress, event));
  backend.onChatChunk((event) => broadcast(Channels.chatChunk, event));
  backend.onSystemStats((stats) => broadcast(Channels.systemStats, stats));
}

export function removeIpcHandlers(): void {
  for (const [, channel] of Object.entries(Channels)) {
    if (!channel.endsWith('.on')) ipcMain.removeHandler(channel);
  }
}
