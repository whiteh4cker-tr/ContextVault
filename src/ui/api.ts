import { createFakeBackend } from './mock/fakeBackend';
import type { IpcApi } from '../shared/ipc';

/**
 * The one place the UI decides where its data comes from.
 *
 * Inside Electron the preload has installed `window.cv`. In a browser tab
 * (`npm run dev:react`) there is no bridge, so the deterministic fake answers
 * instead — the entire interface is buildable and demoable with no model, no
 * PDF parser and no vector index present.
 */
export const api: IpcApi = window.cv ?? createFakeBackend();

/** Whether the app is talking to the real engine or to the mock. */
export const isLive: boolean = window.cv !== undefined;

/**
 * Absolute path for a dropped file, or its name when there is no bridge.
 *
 * The name is enough for the mock; the real backend needs the path and rejects
 * anything outside the roots it is willing to read.
 */
export function pathOf(file: File): string {
  return window.cv?.getPathForFile(file) || file.name;
}
