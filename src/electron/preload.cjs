// The bridge between the renderer and the main process.
//
// CommonJS because a sandboxed preload runs in its own tiny world with only
// `electron` available; it cannot import the TypeScript contract it implements.
// The channel names below are copied from `src/electron/../shared/ipc.ts` and
// `src/shared/ipc.ts`, and `preloadChannels.test.ts` fails if the two ever
// disagree — that test is what makes the duplication safe.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const INVOKE_CHANNELS = {
  modelStatus: 'model:status',
  listModels: 'model:list',
  modelCatalog: 'model:catalog',
  selectModel: 'model:select',
  deleteModel: 'model:delete',
  downloadModel: 'model:download',
  importModel: 'model:import',
  cancelDownload: 'model:cancel-download',
  contextBounds: 'model:context-bounds',
  setContextSize: 'model:set-context-size',

  listDocuments: 'doc:list',
  addDocuments: 'doc:add',
  setDocumentActive: 'doc:set-active',
  removeDocument: 'doc:remove',
  reindexDocument: 'doc:reindex',
  getChunkingSettings: 'doc:get-chunking',
  setChunkingSettings: 'doc:set-chunking',

  getRetrievalSettings: 'rag:get-retrieval',
  setRetrievalSettings: 'rag:set-retrieval',

  listConversations: 'chat:list-conversations',
  createConversation: 'chat:create-conversation',
  deleteConversation: 'chat:delete-conversation',
  renameConversation: 'chat:rename-conversation',
  loadMessages: 'chat:load-messages',
  send: 'chat:send',
  stop: 'chat:stop',
};

const PUSH_CHANNELS = {
  onModelEvent: 'model:event.on',
  onRagProgress: 'rag:progress.on',
  onChatChunk: 'chat:chunk.on',
  onSystemStats: 'system:stats.on',
};

/**
 * Unwrap the main process's reply envelope.
 *
 * Failures cross the bridge as values, so this turns them back into rejections —
 * which is what the hooks above expect, and what keeps an error from being
 * mistaken for a successful empty result.
 */
async function invoke(channel, args) {
  const reply = await ipcRenderer.invoke(channel, args === undefined ? {} : args);
  if (!reply || reply.ok !== true) {
    throw new Error((reply && reply.error) || 'The application could not handle that request');
  }
  return reply.value;
}

const api = {
  /**
   * Absolute path of a dropped file.
   *
   * Electron removed `File.path`, so the path has to be resolved here, in the
   * preload, at the moment of the drop — the only place both the DOM file and the
   * real filesystem are visible. The renderer never learns the path of anything it
   * did not just receive from the user.
   */
  getPathForFile(file) {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return '';
    }
  },
};

for (const [method, channel] of Object.entries(INVOKE_CHANNELS)) {
  api[method] = (args) => invoke(channel, args);
}

for (const [method, channel] of Object.entries(PUSH_CHANNELS)) {
  api[method] = (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on(channel, listener);
    // The unsubscribe the renderer's hooks hold on to, so leaving a view stops the
    // flood rather than adding a second listener to the same channel.
    return () => ipcRenderer.removeListener(channel, listener);
  };
}

contextBridge.exposeInMainWorld('cv', api);
