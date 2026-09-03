import fs from 'node:fs/promises';
import path from 'node:path';
import { app, BrowserWindow, shell } from 'electron';
import { createBackend } from './backend.js';
import { registerIpcHandlers, removeIpcHandlers } from './ipc.js';
import { LlamaService } from './llamaService.js';
import { ModelManager } from './modelManager.js';
import type { DownloaderFactory } from './modelManager.js';
import { resolvePaths } from './paths.js';

/** Vite's dev server, when the UI is being served rather than loaded from disk. */
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL ?? '';

/**
 * Downloads via node-llama-cpp's own resolver, which understands Hugging Face
 * repository URIs and resumes partial files.
 *
 * The module is imported lazily because it locates native binaries the first time
 * it is touched, and the application must still start — listing documents,
 * showing settings, refusing politely — on a machine where that step fails.
 */
function createNodeLlamaDownloader(): DownloaderFactory {
  return {
    async create({ url, dir, fileName, onProgress }) {
      const { createModelDownloader } = await import('node-llama-cpp');
      const downloader = await createModelDownloader({
        modelUri: url,
        dirPath: dir,
        fileName,
        onProgress: (status) => onProgress(status.downloadedSize, status.totalSize),
      });
      return {
        download: () => downloader.download(),
        cancel: () => downloader.cancel(),
      };
    },
  };
}

const paths = resolvePaths({ app, portableDir: process.env.PORTABLE_EXECUTABLE_DIR });
const manager = new ModelManager({ paths, downloaderFactory: createNodeLlamaDownloader() });
const llama = new LlamaService({
  manager,
  modelsDir: paths.modelsDir,
  ...(process.env.CV_LLAMA_DIR ? { llamaDirectory: process.env.CV_LLAMA_DIR } : {}),
  ...(process.env.CV_GPU === 'false' ? { gpu: false } : {}),
});
const backend = createBackend({ paths, manager, llama });

let quitting = false;

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 620,
    show: false,
    title: 'ContextVault',
    backgroundColor: '#0F1418',
    webPreferences: {
      // The preload is CommonJS and sits beside the compiled main bundle.
      preload: path.join(import.meta.dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
      spellcheck: false,
    },
  });

  window.once('ready-to-show', () => window.show());

  // A link inside an answer is the one deliberate way out of this window. It goes
  // to the operating system's browser, in the user's own hands, and never to a
  // window inside the application.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  // Nothing navigates this window: the UI is one page, and a document that could
  // redirect it could replace the interface with something else.
  window.webContents.on('will-navigate', (event, targetUrl) => {
    const allowed = DEV_SERVER_URL.length > 0 && targetUrl.startsWith(DEV_SERVER_URL);
    if (!allowed) event.preventDefault();
  });

  return window;
}

async function main(): Promise<void> {
  await fs.mkdir(paths.modelsDir, { recursive: true });
  await fs.mkdir(paths.indexDir, { recursive: true });

  registerIpcHandlers(backend);
  await backend.start();

  const window = createWindow();
  if (DEV_SERVER_URL.length > 0) {
    await window.loadURL(DEV_SERVER_URL);
  } else {
    await window.loadFile(path.join(app.getAppPath(), 'dist-react', 'index.html'));
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}

// One window per machine. A second launch would open a second process holding a
// second copy of the same multi-gigabyte model.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [first] = BrowserWindow.getAllWindows();
    if (first) {
      if (first.isMinimized()) first.restore();
      first.focus();
    }
  });

  app.whenReady().then(main).catch((error: unknown) => {
    console.error('ContextVault failed to start:', error);
    app.quit();
  });
}

app.on('web-contents-created', (_event, contents) => {
  // A webview would be a second renderer with its own privileges; the UI has no
  // use for one, and the documentation viewer never did.
  contents.on('will-attach-webview', (event) => event.preventDefault());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

/**
 * Release the engine before the process goes.
 *
 * `dispose` is asynchronous and the operating system does not wait, so the first
 * quit request is held while the model, the index child and the queue are shut
 * down properly. Without this, a large model can keep memory mapped briefly after
 * the window is gone.
 */
app.on('before-quit', (event) => {
  if (quitting) return;
  quitting = true;
  event.preventDefault();
  removeIpcHandlers();
  backend
    .dispose()
    .catch((error: unknown) => console.error('Shutdown did not finish cleanly:', error))
    .finally(() => app.exit(0));
});
