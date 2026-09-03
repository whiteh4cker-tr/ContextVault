import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Channels } from '../shared/ipc.js';
import type {
  ChunkingSettings,
  DocumentRecord,
  ModelEvent,
  ModelRole,
  RagProgressEvent,
  RetrievalSettings,
  SystemStats,
} from '../shared/types.js';
import type { LlamaService } from './llamaService.js';
import type { ModelManager } from './modelManager.js';
import { indexFileName } from './paths.js';
import type { AppPaths } from './paths.js';
import { messageFromTurn, runTurn } from './rag/chatRunner.js';
import { IngestionPipeline } from './rag/pipeline.js';
import { DocumentRegistry, reconcileStale } from './rag/registry.js';
import { VectorStore } from './rag/store.js';
import type { IIndex, StoreRecord } from './rag/storeTypes.js';
import type { WorkerLauncher } from './rag/store.js';
import { TranscriptStore } from './rag/transcript.js';

/** Every event the renderer can subscribe to, in one place. */
export interface BackendEvents {
  onModelEvent(cb: (event: ModelEvent) => void): () => void;
  onRagProgress(cb: (event: RagProgressEvent) => void): () => void;
  onChatChunk(cb: (event: Record<string, unknown>) => void): () => void;
  onSystemStats(cb: (stats: SystemStats) => void): () => void;
}

export interface Backend extends BackendEvents {
  start(): Promise<void>;
  dispose(): Promise<void>;
  handle(channel: string, args: unknown): Promise<unknown>;
}

export interface BackendDeps {
  paths: AppPaths;
  manager: ModelManager;
  llama: LlamaService;
  /** Compiled `storeWorker.js`. Defaults to the sibling of this module. */
  workerPath?: string;
  launcher?: WorkerLauncher;
  /** How often memory is published to the title bar. */
  statsIntervalMs?: number;
}

interface AppSettings {
  retrieval: RetrievalSettings;
  chunking: ChunkingSettings;
}

const DEFAULT_SETTINGS: AppSettings = {
  retrieval: { topK: 5, floor: 0.25 },
  chunking: { chunkSize: 1000, chunkOverlap: 150 },
};

function subscribe<T>(set: Set<(value: T) => void>) {
  return (cb: (value: T) => void) => {
    set.add(cb);
    return () => set.delete(cb);
  };
}

/**
 * The main process behind the bridge.
 *
 * One object owns the services and answers every invoke channel. Nothing in the
 * renderer reaches a model, a file or the index directly — not as a security
 * performance, but because there is then exactly one place where a path is
 * resolved, a document is trusted, or a byte is counted, and one place to read
 * when deciding whether something is true.
 *
 * The chat model is asked one question at a time and only ever about passages the
 * registry says are live. Documents are never quoted to the model with page
 * numbers they did not come from: the citation is assembled from the index
 * metadata after the answer exists, from the markers the model actually wrote.
 */
export function createBackend(deps: BackendDeps): Backend {
  return new ApplicationBackend(deps);
}

class ApplicationBackend implements Backend {
  private readonly paths: AppPaths;
  private readonly manager: ModelManager;
  private readonly llama: LlamaService;
  private readonly registry: DocumentRegistry;
  private readonly transcript: TranscriptStore;
  private readonly pipeline: IngestionPipeline;
  private readonly workerPath: string;
  private readonly launcher: WorkerLauncher | undefined;

  private settings: AppSettings = DEFAULT_SETTINGS;
  private settingsFile: string;
  private indexFor: { key: string; store: VectorStore } | null = null;
  private embeddingFile = '';
  private contextSizeTokens = 16_384;
  private turns = new Map<string, AbortController>();
  private statsTimer: NodeJS.Timeout | null = null;
  private readonly statsIntervalMs: number;

  private readonly modelListeners = new Set<(event: ModelEvent) => void>();
  private readonly progressListeners = new Set<(event: RagProgressEvent) => void>();
  private readonly chunkListeners = new Set<(event: Record<string, unknown>) => void>();
  private readonly statsListeners = new Set<(stats: SystemStats) => void>();

  /** handed to the pipeline and the runner, which resolve it on demand */
  private readonly index: IIndex = {
    insert: async (records: StoreRecord[]) => (await this.ensureIndex()).insert(records),
    search: async (vector: number[], k: number) => (await this.ensureIndex()).search(vector, k),
    deleteIds: async (ids: string[]) => (await this.ensureIndex()).deleteIds(ids),
    count: async () => (await this.ensureIndex()).count(),
  };

  constructor(deps: BackendDeps) {
    this.paths = deps.paths;
    this.manager = deps.manager;
    this.llama = deps.llama;
    this.launcher = deps.launcher;
    this.statsIntervalMs = deps.statsIntervalMs ?? 2000;
    this.settingsFile = path.join(deps.paths.dataDir, 'app-settings.json');
    this.workerPath = deps.workerPath ?? path.join(import.meta.dirname, 'rag', 'storeWorker.js');

    this.registry = new DocumentRegistry(deps.paths.registryFile);
    this.transcript = new TranscriptStore(path.join(deps.paths.dataDir, 'conversations.json'));

    this.pipeline = new IngestionPipeline({
      registry: this.registry,
      store: this.index,
      embeddings: this.llama,
      chunking: () => this.settings.chunking,
      embeddingModel: () => this.embeddingFile,
      onProgress: (event) => this.emit(this.progressListeners, event),
    });

    // Whatever the manager decides, the rest of the application hears about it.
    this.manager.onChange((event) => {
      this.emit(this.modelListeners, event);
      if (event.kind === 'status') {
        const next = event.status.embedding.fileName ?? '';
        this.contextSizeTokens = event.status.contextSize;
        if (next !== this.embeddingFile) void this.onEmbeddingModelChanged(next);
      }
    });
  }

  onModelEvent = subscribe<ModelEvent>(this.modelListeners);
  onRagProgress = subscribe<RagProgressEvent>(this.progressListeners);
  onChatChunk = subscribe<Record<string, unknown>>(this.chunkListeners);
  onSystemStats = subscribe<SystemStats>(this.statsListeners);

  private emit<T>(set: Set<(value: T) => void>, value: T): void {
    for (const listener of [...set]) listener(value);
  }

  async start(): Promise<void> {
    await fs.mkdir(this.paths.dataDir, { recursive: true });
    await this.loadSettings();
    await this.registry.load();
    await this.transcript.load();

    const status = await this.manager.status();
    this.embeddingFile = status.embedding.fileName ?? '';
    this.contextSizeTokens = status.contextSize;
    await this.reconcileDocuments();

    // Load whatever is configured. A failure on one role is reported on that role
    // and does not stop the other.
    void this.llama.syncWithManager().then(() => this.publishStats());
    this.statsTimer = setInterval(() => this.publishStats(), this.statsIntervalMs);
    this.statsTimer.unref?.();
  }

  async dispose(): Promise<void> {
    if (this.statsTimer) clearInterval(this.statsTimer);
    this.statsTimer = null;
    for (const controller of this.turns.values()) controller.abort();
    this.turns.clear();
    await this.pipeline.idle();
    await this.indexFor?.store.stop();
    this.indexFor = null;
    await this.llama.releaseAll();
  }

  private async loadSettings(): Promise<void> {
    try {
      const raw = await fs.readFile(this.settingsFile, 'utf8');
      const parsed = JSON.parse(raw) as Partial<AppSettings>;
      this.settings = {
        retrieval: { ...DEFAULT_SETTINGS.retrieval, ...(parsed.retrieval ?? {}) },
        chunking: { ...DEFAULT_SETTINGS.chunking, ...(parsed.chunking ?? {}) },
      };
    } catch {
      this.settings = DEFAULT_SETTINGS;
    }
  }

  private async saveSettings(): Promise<void> {
    const temp = `${this.settingsFile}.tmp`;
    await fs.writeFile(temp, JSON.stringify(this.settings, null, 2), 'utf8');
    await fs.rename(temp, this.settingsFile);
  }

  private async publishStats(): Promise<void> {
    const total = os.totalmem();
    const free = os.freemem();
    const engine = await this.llama.stats();
    this.emit(this.statsListeners, {
      totalBytes: total,
      freeBytes: free,
      usedBytes: total - free,
      modelBytes: engine.modelBytes,
      residentBytes: engine.residentBytes,
      gpuBackend: engine.gpuBackend,
    });
  }

  /**
   * The index for the embedder that is currently loaded.
   *
   * Created on first use because its file name contains the vector width, and the
   * width is only known once the model has produced an embedding. Switching
   * embedders means a different file: two models' vectors in one index would be
   * compared as though they were the same coordinate system, which produces scores
   * that look meaningful and are not.
   */
  private async ensureIndex(): Promise<VectorStore> {
    const status = await this.manager.status();
    const fileName = status.embedding.fileName;
    if (!fileName) throw new Error('No embedding model is installed');

    const dimensions = await this.llama.getEmbeddingDimensions();
    const key = `${fileName}-${dimensions}`;

    if (this.indexFor?.key !== key) {
      await this.indexFor?.store.stop();
      await fs.mkdir(this.paths.indexDir, { recursive: true });
      this.indexFor = {
        key,
        store: new VectorStore({
          workerPath: this.workerPath,
          indexPath: path.join(this.paths.indexDir, indexFileName(fileName, dimensions, 'cosine')),
          dimensions,
          metric: 'cosine',
          ...(this.launcher ? { launcher: this.launcher } : {}),
        }),
      };
    }
    return this.indexFor.store;
  }

  private async onEmbeddingModelChanged(next: string): Promise<void> {
    this.embeddingFile = next;
    // The current index belongs to the previous embedder. It stays on disk — the
    // user may switch back, and then the vectors are still valid — but this
    // process stops serving from it.
    await this.indexFor?.store.stop();
    this.indexFor = null;
    await this.reconcileDocuments();
  }

  /** Mark documents whose vectors came from a different embedder. */
  private async reconcileDocuments(): Promise<void> {
    const records = this.registry.all();
    const updated = reconcileStale(records, this.embeddingFile || null);
    for (let index = 0; index < records.length; index += 1) {
      if (records[index]!.status.state !== updated[index]!.status.state) {
        await this.registry.update(records[index]!.id, { status: updated[index]!.status });
      }
    }
  }

  // ── Channel handling ──────────────────────────────────────────────────────

  /**
   * One switch, every channel.
   *
   * Arguments arrive from a renderer and are checked here rather than trusted:
   * a path must be a string before it reaches `fs`, and a context size must be a
   * whole number before it reaches a memory allocation. Anything unrecognised is
   * an error, never a silent no-op, so a channel renamed on one side of the bridge
   * fails loudly.
   */
  async handle(channel: string, args: unknown): Promise<unknown> {
    const a = (args ?? {}) as Record<string, unknown>;

    switch (channel) {
      case Channels.modelStatus:
        return this.manager.status();
      case Channels.listModels:
        return this.manager.listInstalled();
      case Channels.modelCatalog:
        return this.manager.catalog();
      case Channels.selectModel:
        return this.manager.select(role(a), required(a, 'fileName'));
      case Channels.deleteModel:
        return this.manager.remove(role(a), required(a, 'fileName'));
      case Channels.downloadModel:
        await this.manager.download(role(a), required(a, 'url'), required(a, 'fileName'));
        return undefined;
      case Channels.importModel:
        return this.manager.importFile(role(a), required(a, 'path'));
      case Channels.cancelDownload:
        await this.manager.cancel(role(a));
        return undefined;
      case Channels.contextBounds:
        return this.manager.contextBounds({ fileName: optionalString(a.fileName) });
      case Channels.setContextSize: {
        const snapshot = await this.manager.setContextSize(requiredNumber(a.contextSize));
        // The loaded context is wrong for the new budget, so the next turn
        // rebuilds it rather than answering inside the old window.
        this.contextSizeTokens = snapshot.contextSize;
        await this.llama.releaseChat();
        return snapshot;
      }

      case Channels.listDocuments:
        await this.reconcileDocuments();
        return this.registry.all();
      case Channels.addDocuments:
        return this.addDocuments(a.paths);
      case Channels.setDocumentActive:
        await this.registry.update(required(a, 'id'), { active: Boolean(a.active) });
        return this.registry.all();
      case Channels.removeDocument:
        await this.pipeline.remove(required(a, 'id'));
        return this.registry.all();
      case Channels.reindexDocument:
        return this.pipeline.reindex(required(a, 'id'));
      case Channels.getChunkingSettings:
        return this.settings.chunking;
      case Channels.setChunkingSettings:
        return this.setChunking(a as unknown as ChunkingSettings);

      case Channels.getRetrievalSettings:
        return this.settings.retrieval;
      case Channels.setRetrievalSettings:
        return this.setRetrieval(a as unknown as RetrievalSettings);

      case Channels.listConversations:
        return this.transcript.listConversations();
      case Channels.createConversation:
        await this.llama.resetChatHistory();
        return this.transcript.create();
      case Channels.deleteConversation:
        return this.transcript.remove(required(a, 'id'));
      case Channels.renameConversation:
        return this.transcript.rename(required(a, 'id'), required(a, 'title'));
      case Channels.loadMessages:
        return this.transcript.messagesFor(required(a, 'conversationId'));
      case Channels.send:
        await this.send(required(a, 'conversationId'), required(a, 'text'), required(a, 'requestId'));
        return undefined;
      case Channels.stop: {
        this.turns.get(required(a, 'requestId'))?.abort();
        return undefined;
      }

      default:
        throw new Error(`No handler for channel "${channel}"`);
    }
  }

  private async addDocuments(rawPaths: unknown): Promise<DocumentRecord[]> {
    if (!Array.isArray(rawPaths) || rawPaths.some((entry) => typeof entry !== 'string')) {
      throw new Error('Expected a list of file paths');
    }
    const accepted = rawPaths as string[];
    const added = await this.pipeline.addPaths(accepted);
    return added;
  }

  private async setChunking(next: ChunkingSettings): Promise<ChunkingSettings> {
    const chunkSize = Math.max(200, Math.floor(Number(next.chunkSize) || DEFAULT_SETTINGS.chunking.chunkSize));
    const requestedOverlap = Math.floor(Number(next.chunkOverlap) || 0);
    // Half the chunk: past that, consecutive passages are mostly duplicates and
    // the corpus grows for no gain in recall.
    const chunkOverlap = Math.max(0, Math.min(requestedOverlap, Math.floor(chunkSize / 2)));
    this.settings.chunking = { chunkSize, chunkOverlap };
    await this.saveSettings();
    return this.settings.chunking;
  }

  private async setRetrieval(next: RetrievalSettings): Promise<RetrievalSettings> {
    const topK = Math.min(50, Math.max(1, Math.floor(Number(next.topK) || DEFAULT_SETTINGS.retrieval.topK)));
    const floor = Math.min(0.99, Math.max(0, Number(next.floor ?? DEFAULT_SETTINGS.retrieval.floor)));
    this.settings.retrieval = { topK, floor };
    await this.saveSettings();
    return this.settings.retrieval;
  }

  /**
   * One question, streamed back chunk by chunk.
   *
   * The bubble appears before the first token — the retrieve-then-generate
   * sequence takes seconds on a laptop — and the closing event carries the
   * citations and the provenance, which is what makes the transcript re-readable
   * later without the model.
   */
  private async send(conversationId: string, text: string, requestId: string): Promise<void> {
    const question = text.trim();
    if (question.length === 0) throw new Error('The question is empty');

    const now = Date.now();
    await this.transcript.append({
      id: requestId,
      conversationId,
      role: 'user',
      content: question,
      citations: [],
      provenance: 'cited',
      createdAt: now,
      done: true,
    });

    const messageId = `${requestId}-answer`;
    const controller = new AbortController();
    this.turns.set(requestId, controller);

    this.emit(this.chunkListeners, { requestId, conversationId, messageId, text: '', done: false });

    const outcome = await runTurn(
      {
        embeddings: this.llama,
        store: this.index,
        documents: { active: (model) => this.registry.active(model) },
        streamChat: (prompt, options) => this.llama.streamChat(prompt, options),
        retrieval: () => this.settings.retrieval,
        contextSize: () => this.contextSizeTokens,
        embeddingModel: () => this.embeddingFile,
      },
      {
        conversationId,
        requestId,
        question,
        signal: controller.signal,
        onText: (chunk) => this.emit(this.chunkListeners, { requestId, conversationId, messageId, text: chunk, done: false }),
      },
    );

    const message = messageFromTurn({ conversationId, messageId, outcome });
    await this.transcript.append(message);

    this.emit(this.chunkListeners, {
      requestId,
      conversationId,
      messageId,
      text: outcome.text,
      done: true,
      provenance: outcome.provenance,
      citations: outcome.citations,
      tokenCount: outcome.tokenCount,
      tokensPerSecond: outcome.tokensPerSecond,
      ...(outcome.error ? { error: outcome.error } : {}),
    });

    this.turns.delete(requestId);
  }
}

function role(args: Record<string, unknown>): ModelRole {
  const value = args.role;
  if (value !== 'chat' && value !== 'embedding') throw new Error('A model role is required');
  return value;
}

function required(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.length === 0) throw new Error(`"${key}" is required`);
  return value;
}

function requiredNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new Error('A whole number is required');
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
