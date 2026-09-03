import type { IpcApi } from '../shared/ipc';

export interface ContextVaultBridge extends IpcApi {
  /**
   * Absolute path of a dropped `File`.
   *
   * Electron removed the `File.path` augmentation, so the preload exposes
   * `webUtils.getPathForFile` instead. It is synchronous and returns '' for a
   * File that is not backed by a real file (e.g. one built in JS).
   */
  getPathForFile(file: File): string;
}

declare global {
  interface Window {
    /** Absent when the UI runs in a plain browser tab. */
    cv?: ContextVaultBridge;
  }
}

export {};
