import { CONTEXT_STEPS, formatGrouped, largestSafeContext } from '../../shared/budget';
import type { IpcApi, Unsubscribe } from '../../shared/ipc';
import type {
  ChatChunkEvent,
  ChunkingSettings,
  ContextBounds,
  Conversation,
  DocumentRecord,
  Message,
  ModelCatalogEntry,
  ModelEvent,
  ModelFileInfo,
  ModelRole,
  ModelStatusSnapshot,
  RagProgressEvent,
  RetrievalSettings,
  SystemStats,
  Citation,
} from '../../shared/types';

/** The two files ContextVault ships as defaults, with their real sources. */
export const CATALOG: readonly ModelCatalogEntry[] = [
  {
    fileName: 'gemma-4-12B-it-qat-UD-Q4_K_XL.gguf',
    role: 'chat',
    url: 'https://huggingface.co/unsloth/gemma-4-12B-it-qat-GGUF/resolve/main/gemma-4-12B-it-qat-UD-Q4_K_XL.gguf',
    sizeBytes: 6_719_400_000,
    label: 'Gemma 4 12B Instruct — QAT Q4_K_XL',
    recommended: true,
  },
  {
    fileName: 'bge-m3-q8_0.gguf',
    role: 'embedding',
    url: 'https://huggingface.co/cstr/bge-m3-GGUF/resolve/main/bge-m3-q8_0.gguf',
    sizeBytes: 609_700_000,
    label: 'BGE-M3 embeddings — q8_0, 1024-d',
    recommended: true,
  },
];

/** Default context window, as specified for the chat model. */
export const DEFAULT_CONTEXT_SIZE = 16_384;

/** Stand-in text the fake "extracts" from a dropped file, so citations look real. */
const SNIPPETS = [
  'The term of this agreement is twenty-four (24) months from the Effective Date, renewing for successive twelve (12) month periods unless either party gives ninety (90) days written notice.',
  'Either party may terminate for material breach if the breach remains uncured thirty (30) days after written notice describing it in reasonable detail.',
  'Licensee shall not use the Services to store personal data outside the jurisdiction named in Schedule 2 without Licensor’s prior written consent.',
  'Fees are payable within thirty (30) days of invoice and are subject to change on sixty (60) days notice given before the start of the renewal term.',
];

export interface FakeBackendOptions {
  /** Delay between ingestion stages. */
  stageDelayMs?: number;
  /**
   * Delay between streamed tokens. Defaults to `stageDelayMs`.
   *
   * Kept separate because a test that wants to observe the streaming state needs
   * a turn long enough to look at, without waiting through a slow ingestion.
   */
  tokenDelayMs?: number;
  /** Start with the default models present, so `npm run dev` shows a working app. */
  modelsInstalled?: boolean;
  /** Simulated machine: 32 GB total, 22 GB free. */
  totalBytes?: number;
  freeBytes?: number;
}

interface Emitter<T> {
  on(cb: (value: T) => void): Unsubscribe;
  emit(value: T): void;
  listenerCount(): number;
}

function createEmitter<T>(): Emitter<T> {
  const listeners = new Set<(value: T) => void>();
  return {
    on: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    emit: (value) => {
      for (const cb of [...listeners]) cb(value);
    },
    listenerCount: () => listeners.size,
  };
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Deterministic non-cryptographic hash — the fake's stand-in for SHA-256. */
function fakeHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0').repeat(8).slice(0, 64);
}

const uid = (): string => globalThis.crypto.randomUUID();

const STAGE_SEQUENCE = ['hashing', 'parsing', 'chunking', 'embedding', 'indexing', 'ready'] as const;

/**
 * A deterministic implementation of `IpcApi` that behaves like the main process
 * without a model, a PDF parser or a vector index.
 *
 * It exists so the whole interface can be built, demoed and tested before the
 * engine lands, and so the component tests exercise real state transitions —
 * staged ingestion, streaming with cancellation, provenance — rather than
 * mocked-up snapshots. Timing is configurable so tests run in milliseconds.
 */
export function createFakeBackend(options: FakeBackendOptions = {}): IpcApi {
  const stageDelayMs = options.stageDelayMs ?? 40;
  const tokenDelayMs = options.tokenDelayMs ?? stageDelayMs;
  const totalBytes = options.totalBytes ?? 34_359_738_368;
  const startFree = options.freeBytes ?? 23_622_320_128;
  const installed = new Map<ModelRole, string>();
  if (options.modelsInstalled !== false) {
    installed.set('chat', CATALOG[0].fileName);
    installed.set('embedding', CATALOG[1].fileName);
  }

  const documents = new Map<string, DocumentRecord>();
  const queue: string[] = [];
  const conversations = new Map<string, Conversation>();
  const messages = new Map<string, Message[]>();
  const cancelled = new Set<string>();
  const downloadState = new Map<ModelRole, { percent: number; transferred: number; total: number }>();

  let retrieval: RetrievalSettings = { topK: 5, floor: 0.25 };
  let chunking: ChunkingSettings = { chunkSize: 1000, chunkOverlap: 150 };
  let contextSize = DEFAULT_CONTEXT_SIZE;
  let modelState: Record<ModelRole, ModelStatusSnapshot['chat']['state']> = {
    chat: installed.has('chat') ? 'ready' : 'missing',
    embedding: installed.has('embedding') ? 'ready' : 'missing',
  };

  const modelEvents = createEmitter<ModelEvent>();
  const ragEvents = createEmitter<RagProgressEvent>();
  const chatEvents = createEmitter<ChatChunkEvent>();
  const statsEvents = createEmitter<SystemStats>();

  let statsTimer: ReturnType<typeof setInterval> | null = null;
  function ensureStatsTimer(): void {
    if (statsTimer || statsEvents.listenerCount() === 0) return;
    statsTimer = setInterval(() => statsEvents.emit(readStats()), 1000);
  }

  /**
   * Memory figures for the AppBar gauge and the context ceiling.
   *
   * `freeBytes` is reported as configured rather than net of the loaded models:
   * the real main process reads `os.freemem()`, which already accounts for
   * whatever the engine has resident, and `largestSafeContext` subtracts the
   * weights again on purpose — they are loaded into that same free space.
   */
  function readStats(): SystemStats {
    const chatEntry = CATALOG.find((c) => c.fileName === installed.get('chat'));
    const embedEntry = CATALOG.find((c) => c.fileName === installed.get('embedding'));
    const modelBytes =
      (modelState.chat === 'ready' ? (chatEntry?.sizeBytes ?? 0) : 0) +
      (modelState.embedding === 'ready' ? (embedEntry?.sizeBytes ?? 0) : 0);
    const freeBytes = Math.max(0, Math.min(totalBytes, startFree));
    return {
      totalBytes,
      freeBytes,
      usedBytes: totalBytes - freeBytes,
      modelBytes,
      residentBytes: 420_000_000,
      gpuBackend: 'cuda',
    };
  }

  function status(): ModelStatusSnapshot {
    const sizeFor = (role: ModelRole) => CATALOG.find((c) => c.fileName === installed.get(role))?.sizeBytes;
    return {
      contextSize,
      chat: {
        role: 'chat',
        state: modelState.chat,
        fileName: installed.get('chat'),
        sizeBytes: sizeFor('chat'),
      },
      embedding: {
        role: 'embedding',
        state: modelState.embedding,
        fileName: installed.get('embedding'),
        sizeBytes: sizeFor('embedding'),
        dimensions: installed.get('embedding') ? 1024 : undefined,
      },
    };
  }

  function pushMessage(conversationId: string, message: Message): Message {
    const list = messages.get(conversationId) ?? [];
    list.push(message);
    messages.set(conversationId, list);
    const conversation = conversations.get(conversationId);
    if (conversation) {
      conversation.updatedAt = Date.now();
      conversation.messageCount = list.length;
    }
    return message;
  }

  /** Active, indexed documents — the same rule retrieval applies for real. */
  function citable(): DocumentRecord[] {
    return [...documents.values()].filter((d) => d.active && d.status.state === 'ready');
  }

  function buildCitations(question: string): Citation[] {
    const ready = citable();
    return ready.slice(0, retrieval.topK).map((doc, i) => ({
      index: i + 1,
      documentId: doc.id,
      documentName: doc.name,
      page: Math.min(doc.pages, i + 1),
      chunkIndex: i,
      similarity: Math.max(0.35, 0.93 - i * 0.11),
      snippet: `${SNIPPETS[i % SNIPPETS.length]} (matched "${question.slice(0, 24)}")`,
    }));
  }

  function composeAnswer(citations: Citation[]): string {
    const names = [...new Set(citations.map((c) => c.documentName))].join(', ');
    const body = citations
      .map((c) => `[${c.index}] ${c.documentName} p.${c.page}: ${c.snippet}`)
      .join('\n\n');
    return `Here is what the indexed documents say.\n\n${body}\n\nTaken together, the ${citations.length} passage${
      citations.length === 1 ? '' : 's'
    } above from ${names} answer the question. Anything not covered by a bracketed source is not asserted.`;
  }

  async function runPipeline(docId: string): Promise<void> {
    const doc = documents.get(docId);
    if (!doc) return;
    doc.status = { state: 'indexing', stage: 'hashing' };
    const queuePosition = (): number => Math.max(0, queue.indexOf(docId));

    for (const stage of STAGE_SEQUENCE) {
      if (!documents.has(docId)) return; // removed mid-flight
      doc.status = { state: stage === 'ready' ? 'ready' : 'indexing', stage };
      const slices = stage === 'embedding' ? 5 : 1;
      for (let slice = 1; slice <= slices; slice += 1) {
        if (!documents.has(docId)) return;
        await wait(stageDelayMs);
        ragEvents.emit({
          docId,
          stage,
          ratio: slice / slices,
          detail:
            stage === 'embedding'
              ? `${Math.round((slice / slices) * doc.chunkCount)} / ${formatGrouped(doc.chunkCount)} chunks`
              : stage === 'ready'
                ? `${formatGrouped(doc.chunkCount)} chunks indexed`
                : stage,
          queuePosition: queuePosition(),
        });
      }
    }
    const index = queue.indexOf(docId);
    if (index >= 0) queue.splice(index, 1);
    modelEvents.emit({ kind: 'status', status: status() });
  }

  let running = false;
  async function drainQueue(): Promise<void> {
    if (running) return;
    running = true;
    while (queue.length > 0) {
      const next = queue.shift();
      if (next) await runPipeline(next);
    }
    running = false;
  }

  function makeDocument(path: string): DocumentRecord {
    const name = path.split(/[\\/]/).pop() ?? path;
    const sizeBytes = 148_000 + (fakeHash(path).charCodeAt(0) % 900) * 1024;
    const pages = Math.max(1, Math.round(sizeBytes / 42_000));
    const chars = sizeBytes * 2;
    return {
      id: uid(),
      name,
      path,
      kind: /\.txt$/i.test(name) ? 'text/plain' : 'application/pdf',
      sizeBytes,
      sha256: fakeHash(path),
      active: true,
      pages,
      chunkCount: Math.max(1, Math.ceil(chars / chunking.chunkSize)),
      embeddedWith: CATALOG[1].fileName,
      status: { state: 'queued', stage: 'queued' },
      addedAt: Date.now(),
    };
  }

  const api: IpcApi = {
    async modelStatus() {
      return status();
    },

    async listModels(): Promise<ModelFileInfo[]> {
      return [...installed.entries()].map(([role, fileName]) => ({
        role,
        fileName,
        sizeBytes: CATALOG.find((c) => c.fileName === fileName)?.sizeBytes ?? 0,
      }));
    },

    async modelCatalog() {
      return CATALOG.map((entry) => ({ ...entry }));
    },

    async selectModel({ role, fileName }) {
      installed.set(role, fileName);
      modelState = { ...modelState, [role]: 'ready' };
      const snapshot = status();
      modelEvents.emit({ kind: 'status', status: snapshot });
      return snapshot;
    },

    async deleteModel({ role, fileName }) {
      if (installed.get(role) === fileName) {
        installed.delete(role);
        modelState = { ...modelState, [role]: 'missing' };
      }
      const snapshot = status();
      modelEvents.emit({ kind: 'status', status: snapshot });
      return snapshot;
    },

    async downloadModel({ role, url, fileName }) {
      const total = CATALOG.find((c) => c.url === url)?.sizeBytes ?? 1_000_000_000;
      modelState = { ...modelState, [role]: 'downloading' };
      downloadState.set(role, { percent: 0, transferred: 0, total });
      for (let percent = 10; percent <= 100; percent += 10) {
        await wait(stageDelayMs);
        const transferred = Math.round((percent / 100) * total);
        downloadState.set(role, { percent, transferred, total });
        modelEvents.emit({ kind: 'download', role, fileName, percent, transferred, total });
      }
      installed.set(role, fileName);
      modelState = { ...modelState, [role]: 'ready' };
      const snapshot = status();
      modelEvents.emit({ kind: 'status', status: snapshot });
    },

    async importModel({ role, path }) {
      const fileName = path.split(/[\\/]/).pop() ?? 'imported.gguf';
      installed.set(role, fileName);
      modelState = { ...modelState, [role]: 'ready' };
      const snapshot = status();
      modelEvents.emit({ kind: 'status', status: snapshot });
      return { fileName };
    },

    async cancelDownload({ role }) {
      downloadState.delete(role);
      modelState = { ...modelState, [role]: installed.has(role) ? 'ready' : 'missing' };
      modelEvents.emit({ kind: 'status', status: status() });
    },

    async contextBounds({ fileName }): Promise<ContextBounds> {
      const active = fileName ?? installed.get('chat') ?? CATALOG[0].fileName;
      const weightsBytes = CATALOG.find((c) => c.fileName === active)?.sizeBytes ?? 6_719_400_000;
      const bytesPerToken = 196_608;
      const freeBytes = readStats().freeBytes;
      const maxSafe = largestSafeContext({ freeBytes, weightsBytes, bytesPerToken });
      const estimate = Object.fromEntries(
        CONTEXT_STEPS.map((size) => [String(size), weightsBytes + size * bytesPerToken]),
      );
      return {
        fileName: active,
        steps: [...CONTEXT_STEPS],
        min: CONTEXT_STEPS[0],
        maxSafe,
        default: DEFAULT_CONTEXT_SIZE,
        weightsBytes,
        bytesPerToken,
        freeBytes,
        estimate,
        reason:
          maxSafe < CONTEXT_STEPS[CONTEXT_STEPS.length - 1]
            ? `Above ${formatGrouped(maxSafe)} tokens the KV cache no longer fits in the ${formatGrouped(Math.round(freeBytes / 1e9))} GB free right now.`
            : undefined,
      };
    },

    async setContextSize({ contextSize: size }) {
      contextSize = size;
      const snapshot = status();
      modelEvents.emit({ kind: 'status', status: snapshot });
      return snapshot;
    },

    async listDocuments() {
      return [...documents.values()].map((d) => ({ ...d }));
    },

    async addDocuments({ paths }) {
      const known = new Set([...documents.values()].map((d) => d.sha256));
      for (const path of paths) {
        const doc = makeDocument(path);
        if (known.has(doc.sha256)) continue;
        known.add(doc.sha256);
        documents.set(doc.id, doc);
        queue.push(doc.id);
      }
      void drainQueue();
      return [...documents.values()].map((d) => ({ ...d }));
    },

    async setDocumentActive({ id, active }) {
      const doc = documents.get(id);
      if (doc) doc.active = active;
      return [...documents.values()].map((d) => ({ ...d }));
    },

    async removeDocument({ id }) {
      documents.delete(id);
      const at = queue.indexOf(id);
      if (at >= 0) queue.splice(at, 1);
      return [...documents.values()].map((d) => ({ ...d }));
    },

    async reindexDocument({ id }) {
      const doc = documents.get(id);
      if (!doc) throw new Error('unknown document');
      doc.chunkCount = Math.max(1, Math.ceil((doc.sizeBytes * 2) / chunking.chunkSize));
      doc.status = { state: 'queued', stage: 'queued' };
      queue.push(id);
      void drainQueue();
      return { ...doc };
    },

    async getChunkingSettings() {
      return { ...chunking };
    },

    async setChunkingSettings(next) {
      chunking = { chunkSize: next.chunkSize, chunkOverlap: next.chunkOverlap };
      return { ...chunking };
    },

    async getRetrievalSettings() {
      return { ...retrieval };
    },

    async setRetrievalSettings(next) {
      retrieval = { topK: next.topK, floor: next.floor };
      return { ...retrieval };
    },

    async listConversations() {
      return [...conversations.values()].map((c) => ({ ...c }));
    },

    async createConversation() {
      const conversation: Conversation = {
        id: uid(),
        title: 'New chat',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messageCount: 0,
      };
      conversations.set(conversation.id, conversation);
      messages.set(conversation.id, []);
      return { ...conversation };
    },

    async deleteConversation({ id }) {
      conversations.delete(id);
      messages.delete(id);
      if ([...conversations.keys()].length === 0) await api.createConversation();
      return [...conversations.values()].map((c) => ({ ...c }));
    },

    async renameConversation({ id, title }) {
      const conversation = conversations.get(id);
      if (conversation) conversation.title = title;
      return [...conversations.values()].map((c) => ({ ...c }));
    },

    async loadMessages({ conversationId }) {
      return [...(messages.get(conversationId) ?? [])].map((m) => ({ ...m }));
    },

    async send({ conversationId, text, requestId }) {
      cancelled.delete(requestId);
      const first = (messages.get(conversationId) ?? []).length === 0;
      pushMessage(conversationId, {
        id: uid(),
        conversationId,
        role: 'user',
        content: text,
        citations: [],
        provenance: 'cited',
        createdAt: Date.now(),
        done: true,
      });
      const conversation = conversations.get(conversationId);
      if (conversation && (first || conversation.title === 'New chat')) {
        conversation.title = text.slice(0, 48) || 'New chat';
      }

      const messageId = uid();
      const citations = buildCitations(text);
      const answer = composeAnswer(citations);
      const assistant: Message = {
        id: messageId,
        conversationId,
        role: 'assistant',
        content: '',
        citations,
        provenance: citations.length > 0 ? 'cited' : 'no-context',
        createdAt: Date.now(),
        done: false,
      };
      pushMessage(conversationId, assistant);

      const startedAt = Date.now();
      // With nothing indexed there is nothing to retrieve: the turn ends with an
      // explicit no-context answer rather than an invented one.
      const stream = citations.length > 0 ? answer : 'No documents are indexed and switched on, so there is nothing for me to answer from.';
      for (let taken = 0; taken < stream.length; taken += 14) {
        if (cancelled.has(requestId)) break;
        assistant.content = stream.slice(0, taken + 14);
        chatEvents.emit({ requestId, conversationId, messageId, text: stream.slice(taken, taken + 14), done: false });
        await wait(tokenDelayMs);
      }

      const elapsedSeconds = Math.max(0.001, (Date.now() - startedAt) / 1000);
      const tokenCount = Math.round(assistant.content.length / 4);
      assistant.done = true;
      assistant.tokenCount = tokenCount;
      assistant.tokensPerSecond = Math.round(tokenCount / elapsedSeconds);
      if (cancelled.has(requestId)) {
        assistant.provenance = 'aborted';
        assistant.citations = [];
      }
      cancelled.delete(requestId);
      chatEvents.emit({
        requestId,
        conversationId,
        messageId,
        text: '',
        done: true,
        provenance: assistant.provenance,
        citations: assistant.citations,
        tokenCount: assistant.tokenCount,
        tokensPerSecond: assistant.tokensPerSecond,
      });
    },

    async stop({ requestId }) {
      cancelled.add(requestId);
    },

    onModelEvent(cb) {
      return modelEvents.on(cb);
    },

    onRagProgress(cb) {
      return ragEvents.on(cb);
    },

    onChatChunk(cb) {
      return chatEvents.on(cb);
    },

    onSystemStats(cb) {
      const off = statsEvents.on(cb);
      ensureStatsTimer();
      cb(readStats());
      return () => {
        off();
        if (statsEvents.listenerCount() === 0 && statsTimer) {
          clearInterval(statsTimer);
          statsTimer = null;
        }
      };
    },
  };

  void api.createConversation();
  return api;
}
