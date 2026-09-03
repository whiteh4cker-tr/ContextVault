import path from 'node:path';

/**
 * Where the application keeps its files.
 *
 * Three layouts, chosen once at startup:
 *
 * - **Portable build** — everything sits next to the executable, so a user can
 *   carry the whole vault, models and index included, on a USB stick.
 * - **Installed** — under the OS per-user data directory.
 * - **Development** — inside the repository, gitignored, so a run leaves no
 *   traces in the user's profile and `rm -rf .contextvault` resets everything.
 *
 * The index lives next to the models deliberately: both are derived from the
 * same corpus and both are safe to delete, which is the property that makes
 * "wipe everything and start over" a single, explainable action.
 */
export interface AppPaths {
  dataDir: string;
  modelsDir: string;
  indexDir: string;
  settingsFile: string;
  registryFile: string;
}

export interface PathEnv {
  /** Electron's `app` object, narrowed to what path resolution needs. */
  app: {
    isPackaged: boolean;
    getAppPath(): string;
    getPath(name: 'userData'): string;
  };
  /** Set by electron-builder for a portable executable. */
  portableDir?: string;
  /** Override for tests. */
  devDirName?: string;
}

export function resolvePaths(env: PathEnv): AppPaths {
  const dataDir = env.app.isPackaged
    ? env.portableDir
      ? env.portableDir
      : env.app.getPath('userData')
    : path.join(env.app.getAppPath(), env.devDirName ?? '.contextvault');

  return {
    dataDir,
    modelsDir: path.join(dataDir, 'models'),
    indexDir: path.join(dataDir, 'index'),
    settingsFile: path.join(dataDir, 'settings.json'),
    registryFile: path.join(dataDir, 'registry.json'),
  };
}

/**
 * A filesystem-safe key for a model file name.
 *
 * The index filename carries the embedding model that built it, because an index
 * written by one embedder cannot be read by another; reading that name out of a
 * model file name needs a transformation that is stable in both directions.
 */
export function slugForIndex(name: string): string {
  return name
    .replace(/\.gguf$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Index file name for one embedding model, dimension and distance metric. */
export function indexFileName(modelFileName: string, dimensions: number, metric: string): string {
  return `${slugForIndex(modelFileName)}-${dimensions}-${metric}.rvf`;
}
