import fs from 'node:fs/promises';
import path from 'node:path';
import { getLlama, LlamaChatSession } from 'node-llama-cpp';
import type { Llama, LlamaContext, LlamaEmbeddingContext, LlamaModel } from 'node-llama-cpp';
import type { ModelManager } from './modelManager.js';

export interface LlamaServiceDeps {
  manager: ModelManager;
  /**
   * Where the llama.cpp binaries live. electron-builder unpacks them out of the
   * asar archive, and node-llama-cpp cannot look inside an asar to find them, so
   * the packaged build passes the unpacked directory explicitly.
   */
  llamaDirectory?: string;
  /** Offload to GPU; 'auto' picks CUDA / Metal / Vulkan, 'false' forces CPU. */
  gpu?: 'auto' | 'force' | false;
  modelsDir: string;
}

interface ChatHandle {
  fileName: string;
  contextSize: number;
  model: LlamaModel;
  context: LlamaContext;
  session: LlamaChatSession;
}

interface EmbedHandle {
  fileName: string;
  model: LlamaModel;
  context: LlamaEmbeddingContext;
  dimensions: number;
}

export interface StreamResult {
  text: string;
  tokenCount: number;
  tokensPerSecond: number;
  /** True when the caller aborted rather than the model finishing. */
  aborted: boolean;
}

/**
 * Loads models into memory and runs them.
 *
 * Two roles, two lifecycles. The chat model is expensive — gigabytes, seconds to
 * load — so it stays resident and is swapped only when the user selects a
 * different file or a different context size, both of which need a fresh
 * context. The embedding model is comparatively small and stays resident for the
 * whole session because indexing can start again at any moment.
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

  /** The GPU backend actually chosen, for the memory gauge's tooltip. */
  get gpuBackend(): string {
    return this.llama?.gpu ?? 'cpu';
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
        const model = await llama.loadModel({ modelPath });
        const context = await model.createContext({ contextSize });
        const handle: ChatHandle = {
          fileName,
          contextSize,
          model,
          context,
          session: new LlamaChatSession({ contextSequence: context.getSequence() }),
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

    try {
      const response = await handle.session.prompt(prompt, {
        signal: options.signal,
        onTextChunk: (chunk) => {
          text += chunk;
          options.onTextChunk?.(chunk);
        },
      });

      const elapsedSeconds = Math.max(0.001, (Date.now() - startedAt) / 1000);
      const tokenCount = response.responseTokens.length;
      return {
        // The response text is authoritative; the accumulated chunks can differ
        // when the model emits a segment the wrapper strips.
        text: response.text || text,
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

  /** Tokens currently occupied in the context, when the engine reports it. */
  get usedContextTokens(): number | undefined {
    if (!this.chat) return undefined;
    try {
      return this.chat.context.tokensUsed;
    } catch {
      return undefined;
    }
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
        const model = await llama.loadModel({ modelPath: path.join(this.deps.modelsDir, fileName) });
        const context = await model.createEmbeddingContext();
        // The vector width is read from the model rather than from the
        // catalogue: the index schema has to match reality exactly, or every
        // search fails with a dimension mismatch.
        const probe = await context.getEmbeddingFor('contextvault dimension probe');
        const handle: EmbedHandle = { fileName, model, context, dimensions: probe.vector.length };
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

  /** Embed a batch of passages, in order. */
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
  async stats(): Promise<{ modelBytes: number; residentBytes: number; gpuBackend: string }> {
    const status = await this.deps.manager.status();
    let modelBytes = status.chat.sizeBytes ?? 0;
    if (!modelBytes && this.chat) modelBytes = this.chat.model.size;
    if (!modelBytes && status.chat.fileName) {
      modelBytes = await fs
        .stat(path.join(this.deps.modelsDir, status.chat.fileName))
        .then((stat) => stat.size)
        .catch(() => 0);
    }
    return { modelBytes, residentBytes: process.memoryUsage().rss, gpuBackend: this.gpuBackend };
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
    if (status.embedding.fileName) {
      await this.ensureEmbeddings().catch(() => undefined);
    }
  }
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
  return message;
}
