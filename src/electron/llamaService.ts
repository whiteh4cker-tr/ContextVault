import fs from 'node:fs/promises';
import path from 'node:path';
import { getLlama, LlamaChatSession } from 'node-llama-cpp';
import type { Llama, LlamaContext, LlamaEmbeddingContext, LlamaModel, LlamaModelOptions } from 'node-llama-cpp';
import { needsQueryInstruction } from './catalog.js';
import { withQueryInstruction } from './rag/instruction.js';
import type { ModelManager } from './modelManager.js';

/** What the title bar shows, read from the engine rather than guessed. */
export interface EngineStats {
  modelBytes: number;
  residentBytes: number;
  gpuBackend: string;
  chat: { fileName: string; gpuLayers: number; layerCount: number; contextSize: number } | null;
  embedding: { fileName: string; gpuLayers: number; layerCount: number; dimensions: number } | null;
}

export interface LlamaServiceDeps {
  manager: ModelManager;
  /**
   * Where the llama.cpp binaries live. electron-builder unpacks them out of the
   * asar archive, and node-llama-cpp cannot look inside an asar to find them, so
   * the packaged build passes the unpacked directory explicitly.
   */
  llamaDirectory?: string;
  /**
   * GPU selection, passed straight to the engine: 'auto' tries CUDA / Metal /
   * Vulkan in turn, `false` keeps everything on the CPU.
   */
  gpu?: 'auto' | 'metal' | 'cuda' | 'vulkan' | false;
  modelsDir: string;
}

interface ChatHandle {
  fileName: string;
  contextSize: number;
  model: LlamaModel;
  context: LlamaContext;
  session: LlamaChatSession;
  /** Transformer layers actually placed in VRAM. */
  gpuLayers: number;
  layerCount: number;
}

interface EmbedHandle {
  fileName: string;
  model: LlamaModel;
  context: LlamaEmbeddingContext;
  dimensions: number;
  gpuLayers: number;
  layerCount: number;
  /** True when this embedder was trained with a task sentence in front of queries. */
  instructQueries: boolean;
}

/**
 * How much of a window the embedding model is given.
 *
 * Qwen3 Embedding advertises 40 960 tokens, and honouring that would reserve a
 * key-value cache gigabytes wide for text that never arrives: a chunk is a few
 * hundred tokens, and nothing is embedded longer than the chunk size. Anything
 * longer is split rather than truncated, so this ceiling costs nothing.
 */
const EMBEDDING_CONTEXT_TOKENS = 2_048;

/**
 * The architecture section of a loaded model's metadata.
 *
 * The section is keyed by architecture name — `qwen3`, `gemma4`, `bert` — which
 * is why this reads like a lookup rather than a property. It carries the two
 * facts worth showing a person: how the vectors are pooled, and how many layers
 * the file has, which is what `gpuLayers` is a fraction of.
 */
function architectureSection(model: LlamaModel): { pooling_type?: number; block_count?: number } {
  const metadata = model.fileInfo?.metadata as Record<string, { pooling_type?: number; block_count?: number }>;
  return metadata?.[model.architecture] ?? {};
}

export interface StreamResult {
  text: string;
  tokenCount: number;
  tokensPerSecond: number;
  /** True when the caller aborted rather than the model finishing. */
  aborted: boolean;
}

/**
 * Loads models into memory and runs them, once each.
 *
 * Two roles, two lifecycles. The chat model is expensive — gigabytes, seconds to
 * load — so it stays resident and is swapped only when the user selects a
 * different file or a different context size, both of which need a fresh
 * context. The embedding model loads lazily, on the first document, because a
 * reader who never adds a file should not pay 2.5 GB for an embedder.
 *
 * There is exactly one engine (`Llama`) and at most one loaded model per role,
 * which is what keeps nine gigabytes of weights from becoming eighteen. The load
 * options matter as much as the count:
 *
 * - `useMmap: true` maps the file instead of reading it into the heap, so the
 *   weights exist once — in the page cache — and cold pages can be dropped when
 *   something else needs the room.
 * - `gpuLayers: {fitContext}` places as many layers in VRAM as fit *after*
 *   reserving the key-value cache the model is about to be asked for. Asking for
 *   `"max"` instead is how a model ends up spread across VRAM and system RAM in
 *   the worst order: VRAM full, the overflow copied to RAM, and the context with
 *   nowhere to go but to page.
 *
 * Everything here reports through the model manager, so what the title bar shows
 * is the engine's own state rather than a guess made from the file listing.
 */
export class LlamaService {
  private readonly deps: LlamaServiceDeps;
  private llama: Llama | null = null;
  private chat: ChatHandle | null = null;
  private loadingChat: Promise<ChatHandle> | null = null;
  private embedding: EmbedHandle | null = null;
  private loadingEmbedding: Promise<EmbedHandle> | null = null;

  constructor(deps: LlamaServiceDeps) {
    this.deps = deps;
  }

  private async getLlamaInstance(): Promise<Llama> {
    if (this.llama) return this.llama;
    this.llama = await getLlama({
      gpu: this.deps.gpu ?? 'auto',
      ...(this.deps.llamaDirectory ? { llamaDirectory: this.deps.llamaDirectory } : {}),
    });
    return this.llama;
  }

  /**
   * Where the embedding model should run, given what else is installed.
   *
   * Measured on the reference machine, one passage of ~70 tokens:
   *
   *   embedder in VRAM  → 70 ms, and the chat model can no longer fit the window
   *   embedder on CPU   → 170 ms, all 49 chat layers stay in VRAM
   *
   * That is the whole argument. A token of the answer is generated thousands of
   * times per question and costs the difference between a responsive application
   * and a sluggish one; a passage is embedded once, in the background, with a
   * progress bar in front of it. So when a chat model is installed the embedder
   * keeps the CPU and leaves the graphics memory to the model that needs it, and
   * two resident models never bid for the same VRAM at the same time.
   *
   * An indexing-only machine — an embedder with no chat model — gets the GPU, which
   * is the right trade when embedding is the only job there is.
   */
  private async embeddingOffload(): Promise<LlamaModelOptions['gpuLayers']> {
    const status = await this.deps.manager.status();
    if (status.chat.fileName) return 0;
    return { fitContext: { contextSize: EMBEDDING_CONTEXT_TOKENS, embeddingContext: true } };
  }

  /** The GPU backend actually chosen, for the memory gauge's tooltip. */
  get gpuBackend(): string {
    const gpu = this.llama?.gpu;
    if (typeof gpu === 'string' && gpu.length > 0) return gpu;
    // `false` means the engine ran the CPU build; before load there is nothing
    // to report, and "unknown" is truer than a confident "cpu".
    if (gpu === false) return 'cpu';
    return 'unknown';
  }

  /**
   * llama.cpp's own startup summary — devices it found, VRAM it sees, the
   * backends it loaded, and whether flash attention is in use.
   *
   * Kept as a string because it is a diagnostic dump for a person to read, not a
   * structure to compute on; the fields worth metering are already exposed
   * individually above. Empty until the engine exists.
   */
  get systemReport(): string {
    try {
      return this.llama?.systemInfo ?? '';
    } catch {
      return '';
    }
  }

  // ── Chat model ────────────────────────────────────────────────────────────

  /**
   * Make sure the selected chat model is loaded at the selected context size.
   *
   * Concurrent callers share one load: two windows asking a question at once must
   * not each map six gigabytes of weights.
   */
  async ensureChat(): Promise<ChatHandle> {
    const status = await this.deps.manager.status();
    const fileName = status.chat.fileName;
    if (!fileName) throw new Error('No chat model is installed');
    const contextSize = status.contextSize;

    if (this.chat && this.chat.fileName === fileName && this.chat.contextSize === contextSize) return this.chat;
    if (this.loadingChat) return this.loadingChat;

    this.loadingChat = (async () => {
      // A different file or a different budget means the resident one is wrong,
      // and both are too big to keep side by side.
      await this.releaseChat();
      this.deps.manager.setLoadState('chat', 'loading');

      const modelPath = path.join(this.deps.modelsDir, fileName);
      try {
        const llama = await this.getLlamaInstance();
        const model = await llama.loadModel({
          modelPath,
          useMmap: true,
          gpuLayers: { fitContext: { contextSize } },
        });
        // The requested window is a wish; the memory free at this moment is the
        // fact. Asking for it anyway and stepping down is what keeps the first
        // question of a session from failing on a machine that had 12 GB free at
        // startup and 9 now.
        const { context, contextSize: granted, reducedFrom } = await createChatContext(model, contextSize);
        if (reducedFrom !== undefined) {
          this.deps.manager.setLoadState(
            'chat',
            'loaded',
            `Context reduced from ${reducedFrom} to ${granted} tokens to fit the memory available now.`,
          );
        }
        const handle: ChatHandle = {
          fileName,
          contextSize: granted,
          model,
          context,
          session: new LlamaChatSession({ contextSequence: context.getSequence() }),
          gpuLayers: model.gpuLayers,
          layerCount: architectureSection(model).block_count ?? 0,
        };
        this.chat = handle;
        this.deps.manager.setLoadState('chat', 'loaded');
        return handle;
      } catch (error) {
        this.deps.manager.setLoadState('chat', 'failed', describeLoadFailure(error));
        throw error;
      } finally {
        this.loadingChat = null;
      }
    })();

    return this.loadingChat;
  }

  /**
   * Generate an answer, forwarding text as it is produced.
   *
   * The whole turn is bounded by the caller's abort signal; a stopped answer
   * returns what was produced up to that point instead of throwing, because the
   * transcript keeps a partial answer and the user should see it.
   */
  async streamChat(
    prompt: string,
    options: { signal?: AbortSignal; onTextChunk?: (text: string) => void } = {},
  ): Promise<StreamResult> {
    const handle = await this.ensureChat();
    const startedAt = Date.now();
    let text = '';
    let tokenCount = 0;

    try {
      const response = await handle.session.prompt(prompt, {
        signal: options.signal,
        onTextChunk: (chunk) => {
          text += chunk;
          options.onTextChunk?.(chunk);
        },
        // Tokens are counted as they stream: the returned string is the answer,
        // but tokens per second is a property of the generation, not of the text.
        onResponseChunk: (chunk) => {
          if (chunk.type === undefined) tokenCount += chunk.tokens.length;
        },
      });

      const elapsedSeconds = Math.max(0.001, (Date.now() - startedAt) / 1000);
      return {
        // The returned text is authoritative; accumulated chunks can differ when
        // the wrapper strips or re-spacing something.
        text: response || text,
        tokenCount,
        tokensPerSecond: tokenCount / elapsedSeconds,
        aborted: false,
      };
    } catch (error) {
      if (isAbort(error, options.signal)) {
        const elapsedSeconds = Math.max(0.001, (Date.now() - startedAt) / 1000);
        return { text, tokenCount: 0, tokensPerSecond: text.length / 4 / elapsedSeconds, aborted: true };
      }
      throw error;
    }
  }

  /** Start a new conversation: the model keeps no memory of the last one. */
  async resetChatHistory(): Promise<void> {
    if (!this.chat) return;
    this.chat.session.resetChatHistory();
  }

  async releaseChat(): Promise<void> {
    const handle = this.chat;
    this.chat = null;
    if (!handle) return;
    try {
      handle.session.dispose({ disposeSequence: true });
    } catch {
      /* already gone */
    }
    try {
      handle.context.dispose();
    } catch {
      /* already gone */
    }
    try {
      handle.model.dispose();
    } catch {
      /* already gone */
    }
  }

  // ── Embedding model ───────────────────────────────────────────────────────

  async ensureEmbeddings(): Promise<EmbedHandle> {
    const status = await this.deps.manager.status();
    const fileName = status.embedding.fileName;
    if (!fileName) throw new Error('No embedding model is installed');
    if (this.embedding && this.embedding.fileName === fileName) return this.embedding;
    if (this.loadingEmbedding) return this.loadingEmbedding;

    this.loadingEmbedding = (async () => {
      if (this.embedding && this.embedding.fileName !== fileName) await this.releaseEmbeddings();
      this.deps.manager.setLoadState('embedding', 'loading');
      try {
        const llama = await this.getLlamaInstance();
        const model = await llama.loadModel({
          modelPath: path.join(this.deps.modelsDir, fileName),
          useMmap: true,
          gpuLayers: await this.embeddingOffload(),
        });
        const context = await model.createEmbeddingContext({
          contextSize: { min: 256, max: EMBEDDING_CONTEXT_TOKENS },
        });
        // The vector width is read from the model rather than from the
        // catalogue: the index schema has to match reality exactly, or every
        // search fails with a dimension mismatch.
        const probe = await context.getEmbeddingFor('contextvault dimension probe');
        const section = architectureSection(model);
        const handle: EmbedHandle = {
          fileName,
          model,
          context,
          dimensions: probe.vector.length,
          gpuLayers: model.gpuLayers,
          layerCount: section.block_count ?? 0,
          instructQueries: needsQueryInstruction(model.architecture, section.pooling_type),
        };
        this.embedding = handle;
        this.deps.manager.setLoadState('embedding', 'loaded');
        return handle;
      } catch (error) {
        this.deps.manager.setLoadState('embedding', 'failed', describeLoadFailure(error));
        throw error;
      } finally {
        this.loadingEmbedding = null;
      }
    })();

    return this.loadingEmbedding;
  }

  /** Embed a batch of passages, in order, exactly as written. */
  async embed(texts: string[], onEach?: (done: number) => void): Promise<number[][]> {
    const handle = await this.ensureEmbeddings();
    const vectors: number[][] = [];
    for (const [index, text] of texts.entries()) {
      const embedding = await handle.context.getEmbeddingFor(text);
      vectors.push([...embedding.vector]);
      onEach?.(index + 1);
    }
    return vectors;
  }

  /**
   * Embed a search question.
   *
   * Separate from `embed` because the two sides of a retrieval pair are not
   * symmetric: a stored passage is embedded as it stands, while a question may
   * need the task sentence this embedder was trained to expect. Both go through
   * the same model, so the vectors stay comparable.
   */
  async embedQuery(question: string): Promise<number[]> {
    const handle = await this.ensureEmbeddings();
    const input = handle.instructQueries ? withQueryInstruction(question) : question;
    const embedding = await handle.context.getEmbeddingFor(input);
    return [...embedding.vector];
  }

  async getEmbeddingDimensions(): Promise<number> {
    const handle = await this.ensureEmbeddings();
    return handle.dimensions;
  }

  async releaseEmbeddings(): Promise<void> {
    const handle = this.embedding;
    this.embedding = null;
    if (!handle) return;
    try {
      handle.context.dispose();
    } catch {
      /* already gone */
    }
    try {
      handle.model.dispose();
    } catch {
      /* already gone */
    }
  }

  async releaseAll(): Promise<void> {
    await this.releaseChat();
    await this.releaseEmbeddings();
    const llama = this.llama;
    this.llama = null;
    try {
      await llama?.dispose();
    } catch {
      /* already gone */
    }
  }

  /** Numbers for the title bar: what the weights cost and what the process holds. */
  async stats(): Promise<EngineStats> {
    const status = await this.deps.manager.status();
    let modelBytes = status.chat.sizeBytes ?? 0;
    if (!modelBytes && this.chat) modelBytes = this.chat.model.size;
    if (!modelBytes && status.chat.fileName) {
      modelBytes = await fs
        .stat(path.join(this.deps.modelsDir, status.chat.fileName))
        .then((stat) => stat.size)
        .catch(() => 0);
    }
    return {
      modelBytes,
      residentBytes: process.memoryUsage().rss,
      gpuBackend: this.gpuBackend,
      chat: this.chat
        ? {
            fileName: this.chat.fileName,
            gpuLayers: this.chat.gpuLayers,
            layerCount: this.chat.layerCount,
            contextSize: this.chat.contextSize,
          }
        : null,
      embedding: this.embedding
        ? {
            fileName: this.embedding.fileName,
            gpuLayers: this.embedding.gpuLayers,
            layerCount: this.embedding.layerCount,
            dimensions: this.embedding.dimensions,
          }
        : null,
    };
  }

  /**
   * Load whatever the manager has configured, reporting each failure separately.
   *
   * Called at startup. A missing embedding model must not stop the chat model
   * from loading — one means "no answers yet", the other means "no new
   * documents"; conflating them would hide which one the user can fix.
   */
  async syncWithManager(): Promise<void> {
    const status = await this.deps.manager.status();
    if (status.chat.fileName) {
      await this.ensureChat().catch(() => undefined);
    }
    // The embedder is deliberately not warmed here. It costs gigabytes and is
    // needed only when a document is being indexed or a question asked; loading
    // it at startup would hold both models resident while the reader does nothing.
    void status.embedding;
  }
}

/**
 * Create the chat context, stepping down until the memory agrees.
 *
 * `createContext` refuses a window it cannot hold rather than quietly giving a
 * smaller one, which is right for a library and wrong for an application: the
 * person chose 16 384 because the estimate fitted, and the honest answer is to
 * grant the largest window that fits *now* and say so, not to show an error.
 *
 * Halving is coarse on purpose. It converges in two or three attempts, and each
 * attempt is a reservation the driver has to take back.
 */
async function createChatContext(
  model: LlamaModel,
  requested: number,
): Promise<{ context: LlamaContext; contextSize: number; reducedFrom?: number }> {
  let contextSize = requested;
  // `ChatContextFloor` is the point below which an answer with citations stops
  // being meaningful — the prompt carries the passages, so a window smaller than
  // the retrieval budget leaves nothing to answer from.
  while (true) {
    try {
      const context = await model.createContext({ contextSize });
      return { context, contextSize, ...(contextSize < requested ? { reducedFrom: requested } : {}) };
    } catch (error) {
      if (!isMemoryError(error) || contextSize <= CONTEXT_FLOOR) throw error;
      contextSize = Math.max(CONTEXT_FLOOR, Math.floor(contextSize / 2));
    }
  }
}

/** Smallest window worth creating: one round of retrieved passages and their citations. */
const CONTEXT_FLOOR = 2_048;

function isMemoryError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /insufficient|too large|not enough|memory/i.test(message);
}

function isAbort(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  return error instanceof Error && (error.name === 'AbortError' || /abort/i.test(error.message));
}

/**
 * Turn a load failure into a sentence that says what to do.
 *
 * The engine's message is usually about memory. Left untranslated it reads as a
 * crash; with the context size beside it, it reads as a setting to change.
 */
function describeLoadFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/insufficient|memory|alloc/i.test(message)) {
    return `The model did not fit in memory (${message}). Lower the context size or close other applications.`;
  }
  if (/binary|dll|dylib|addon|node-llama-cpp/i.test(message)) {
    return `The inference engine could not start (${message}). Reinstall to restore its native components.`;
  }
  // The engine's own words for "this file is not a format I have code for" — most
  // often an embedding model converted by a tool that leaves it in an architecture
  // the bundled llama.cpp cannot read ("xlmr" is the usual one).
  if (/unknown model architecture/i.test(message)) {
    const architecture = /'([^']+)'/.exec(message)?.[1] ?? 'unknown';
    return `This file's "${architecture}" architecture is not supported by the bundled engine, so it can never load. Choose a model from the catalogue instead.`;
  }
  if (/pooling/i.test(message)) {
    return `This model cannot serve the role it was given (${message}). A chat model cannot embed, and an embedding model cannot answer questions.`;
  }
  return message;
}
