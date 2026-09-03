import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CONTEXT_MIN, formatGrouped, largestSafeContext } from '../shared/budget.js';
import type {
  ContextBounds,
  ModelCatalogEntry,
  ModelEvent,
  ModelFileInfo,
  ModelRole,
  ModelState,
  ModelStatusSnapshot,
} from '../shared/types.js';
import { CATALOG, UNKNOWN_TRAINED_CONTEXT, entryForFile, recommendedFor } from './catalog.js';
import type { AppPaths } from './paths.js';

/** Progress callback shape used by the download adapter. */
export interface DownloaderHandle {
  download(): Promise<unknown>;
  cancel(): Promise<void>;
}

export interface DownloaderFactory {
  create(args: {
    url: string;
    dir: string;
    fileName: string;
    onProgress: (transferred: number, total: number) => void;
  }): Promise<DownloaderHandle>;
}

/** The GGUF facts the manager needs, read without loading the model. */
export interface GgufFacts {
  architecture?: string;
  trainedContext?: number;
  /** Estimated bytes the engine will hold per token of context. */
  bytesPerToken?: number;
}

export interface ModelManagerDeps {
  paths: AppPaths;
  downloaderFactory?: DownloaderFactory;
  readGgufFacts?: (filePath: string) => Promise<GgufFacts>;
  /** Injectable for tests; the default is the real machine's free memory. */
  freeBytes?: () => number;
}

interface PersistedSettings {
  chat?: string | null;
  embedding?: string | null;
  contextSize?: number;
}

interface SlotRuntime {
  loadState: 'unattempted' | 'loading' | 'loaded' | 'failed';
  message?: string;
}

const DEFAULT_CONTEXT_SIZE = 16_384;

/**
 * Which `.gguf` files are on disk, which one serves each role, and what the
 * context window may be.
 *
 * The manager owns facts about files; it does not load models. Loading belongs to
 * `LlamaService`, which reports back through `setLoadState` so that "ready" means
 * the engine actually has weights in memory rather than that a file happens to
 * exist somewhere.
 *
 * Two roles are tracked separately on purpose. Switching the embedding model
 * invalidates every vector in the index — that is why the corpus records which
 * model produced it, and why the UI asks before doing it.
 */
export class ModelManager {
  private readonly paths: AppPaths;
  private readonly downloaderFactory: DownloaderFactory | null;
  private readonly readGgufFacts: (filePath: string) => Promise<GgufFacts>;
  private readonly freeBytes: () => number;

  private settings: PersistedSettings = {};
  private settingsLoaded = false;
  private runtime: Record<ModelRole, SlotRuntime> = {
    chat: { loadState: 'unattempted' },
    embedding: { loadState: 'unattempted' },
  };
  private downloads = new Map<ModelRole, DownloaderHandle>();
  private listeners = new Set<(event: ModelEvent) => void>();
  private factsCache = new Map<string, GgufFacts>();

  constructor(deps: ModelManagerDeps) {
    this.paths = deps.paths;
    this.downloaderFactory = deps.downloaderFactory ?? null;
    this.readGgufFacts = deps.readGgufFacts ?? readGgufFactsFromDisk;
    this.freeBytes = deps.freeBytes ?? (() => os.freemem());
  }

  onChange(cb: (event: ModelEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(event: ModelEvent): void {
    for (const listener of [...this.listeners]) listener(event);
  }

  private async ensureSettings(): Promise<void> {
    if (this.settingsLoaded) return;
    this.settingsLoaded = true;
    try {
      const raw = await fs.readFile(this.paths.settingsFile, 'utf8');
      const parsed = JSON.parse(raw) as PersistedSettings;
      this.settings = {
        chat: parsed.chat ?? null,
        embedding: parsed.embedding ?? null,
        contextSize:
          typeof parsed.contextSize === 'number' && Number.isInteger(parsed.contextSize)
            ? parsed.contextSize
            : undefined,
      };
    } catch {
      this.settings = {};
    }
  }

  private async persist(): Promise<void> {
    try {
      await fs.mkdir(this.paths.dataDir, { recursive: true });
      // Written through a temporary file so a crash mid-write cannot leave a
      // half-written settings file that would read as "no models configured".
      const temp = `${this.paths.settingsFile}.tmp`;
      await fs.writeFile(temp, JSON.stringify(this.settings, null, 2), 'utf8');
      await fs.rename(temp, this.paths.settingsFile);
    } catch (error) {
      console.error('Could not write settings:', error);
    }
  }

  async status(): Promise<ModelStatusSnapshot> {
    await this.ensureSettings();
    const files = await this.listInstalled();
    const sizeOf = (fileName?: string | null) => files.find((f) => f.fileName === fileName)?.sizeBytes;

    const slot = (role: ModelRole): ModelStatusSnapshot['chat'] => {
      const fileName = this.selectedFor(role, files) ?? undefined;
      const state = this.slotState(role, fileName);
      const dimensions = role === 'embedding' ? entryForFile(fileName ?? '')?.dimensions : undefined;
      return {
        role,
        state,
        ...(fileName ? { fileName, sizeBytes: sizeOf(fileName) } : {}),
        ...(dimensions ? { dimensions } : {}),
        ...(state === 'error' ? { message: this.runtime[role].message } : {}),
      };
    };

    return {
      chat: slot('chat'),
      embedding: slot('embedding'),
      contextSize: this.settings.contextSize ?? DEFAULT_CONTEXT_SIZE,
    };
  }

  private selectedFor(role: ModelRole, files: ModelFileInfo[]): string | null {
    const chosen = role === 'chat' ? this.settings.chat : this.settings.embedding;
    if (chosen && files.some((f) => f.fileName === chosen)) return chosen;
    // Nothing recorded: prefer the catalogue's recommendation, then the first
    // installed file that can serve the role.
    const recommendation = recommendedFor(role);
    if (recommendation && files.some((f) => f.fileName === recommendation.fileName)) {
      return recommendation.fileName;
    }
    return files.find((f) => f.role === role)?.fileName ?? null;
  }

  private slotState(role: ModelRole, fileName: string | null | undefined): ModelState {
    if (this.downloads.has(role)) return 'downloading';
    if (!fileName) return 'missing';
    switch (this.runtime[role].loadState) {
      case 'loaded':
        return 'ready';
      case 'failed':
        return 'error';
      default:
        // A file on disk that has not been read into memory yet. Startup loads
        // every configured model immediately, so this is a transient state and
        // the UI shows it as work in progress rather than as a failure.
        return 'loading';
    }
  }

  /** Called by the engine when a model finishes or fails to load. */
  setLoadState(role: ModelRole, state: 'loading' | 'loaded' | 'failed', message?: string): void {
    this.runtime[role] = { loadState: state, ...(message ? { message } : {}) };
    void this.status().then((snapshot) => this.emit({ kind: 'status', status: snapshot }));
  }

  async listInstalled(): Promise<ModelFileInfo[]> {
    await this.ensureSettings();
    let names: string[] = [];
    try {
      names = (await fs.readdir(this.paths.modelsDir)).filter((name) => name.toLowerCase().endsWith('.gguf'));
    } catch {
      return [];
    }

    const listed = await Promise.all(
      names.map(async (fileName): Promise<ModelFileInfo> => {
        const known = entryForFile(fileName);
        const size = await fs
          .stat(path.join(this.paths.modelsDir, fileName))
          .then((stat) => stat.size)
          .catch(() => 0);
        // Role comes from the catalogue when recognised; an unfamiliar file is
        // classified from its own metadata, and a file whose metadata cannot be
        // read is offered for both roles rather than silently hidden.
        const role: ModelRole = known?.role ?? 'chat';
        return { fileName, role, sizeBytes: size };
      }),
    );
    return listed;
  }

  async catalog(): Promise<ModelCatalogEntry[]> {
    return CATALOG;
  }

  async select(role: ModelRole, fileName: string): Promise<ModelStatusSnapshot> {
    await this.ensureSettings();
    const files = await this.listInstalled();
    if (!files.some((f) => f.fileName === fileName)) throw new Error(`No such model file: ${fileName}`);
    if (role === 'chat') this.settings.chat = fileName;
    else this.settings.embedding = fileName;
    // Selecting a different file means the engine's copy is stale.
    this.runtime[role] = { loadState: 'unattempted' };
    await this.persist();
    const snapshot = await this.status();
    this.emit({ kind: 'status', status: snapshot });
    return snapshot;
  }

  async remove(role: ModelRole, fileName: string): Promise<ModelStatusSnapshot> {
    await this.ensureSettings();
    const target = path.join(this.paths.modelsDir, fileName);
    await fs.rm(target, { force: true });
    if ((role === 'chat' ? this.settings.chat : this.settings.embedding) === fileName) {
      if (role === 'chat') this.settings.chat = null;
      else this.settings.embedding = null;
      this.runtime[role] = { loadState: 'unattempted' };
    }
    this.factsCache.delete(target);
    await this.persist();
    const snapshot = await this.status();
    this.emit({ kind: 'status', status: snapshot });
    return snapshot;
  }

  async download(role: ModelRole, url: string, fileName: string): Promise<void> {
    await this.ensureSettings();
    if (!this.downloaderFactory) throw new Error('Downloads are not available in this build');
    if (!fileName.toLowerCase().endsWith('.gguf')) throw new Error('Model files must end in .gguf');
    if (this.downloads.has(role)) throw new Error(`A download is already running for the ${role} model`);

    await fs.mkdir(this.paths.modelsDir, { recursive: true });
    const handle = await this.downloaderFactory.create({
      url,
      dir: this.paths.modelsDir,
      fileName,
      onProgress: (transferred, total) =>
        this.emit({
          kind: 'download',
          role,
          fileName,
          percent: total > 0 ? Math.min(100, Math.round((transferred / total) * 100)) : 0,
          transferred,
          total,
        }),
    });

    this.downloads.set(role, handle);
    try {
      await handle.download();
      this.downloads.delete(role);
      if (role === 'chat') this.settings.chat = fileName;
      else this.settings.embedding = fileName;
      this.runtime[role] = { loadState: 'unattempted' };
      await this.persist();
      this.emit({ kind: 'status', status: await this.status() });
    } catch (error) {
      this.downloads.delete(role);
      // A cancelled download is a finished interaction, not a fault: leave the
      // slot empty rather than flagging the role as broken.
      const aborted = error instanceof Error && /cancel/i.test(error.message);
      if (!aborted) this.runtime[role] = { loadState: 'failed', message: describeError(error) };
      this.emit({ kind: 'status', status: await this.status() });
      throw error;
    }
  }

  async cancel(role: ModelRole): Promise<void> {
    const handle = this.downloads.get(role);
    if (!handle) return;
    await handle.cancel();
    this.downloads.delete(role);
    this.emit({ kind: 'status', status: await this.status() });
  }

  /**
   * Register a `.gguf` the user already downloaded.
   *
   * It is copied into the managed directory rather than referenced in place: a
   * vault that depends on a file in the Downloads folder breaks the first time
   * someone cleans up, and the copy is a one-time cost against a multi-year
   * configuration.
   */
  async importFile(role: ModelRole, sourcePath: string): Promise<{ fileName: string }> {
    await this.ensureSettings();
    const normalized = path.resolve(sourcePath);
    if (!normalized.toLowerCase().endsWith('.gguf')) throw new Error('Only .gguf files can be registered');

    const stat = await fs.stat(normalized).catch(() => null);
    if (!stat?.isFile()) throw new Error(`No such file: ${normalized}`);

    const fileName = path.basename(normalized);
    const target = path.join(this.paths.modelsDir, fileName);
    await fs.mkdir(this.paths.modelsDir, { recursive: true });
    if (normalized !== target) await fs.copyFile(normalized, target);

    if (role === 'chat') this.settings.chat = fileName;
    else this.settings.embedding = fileName;
    this.runtime[role] = { loadState: 'unattempted' };
    await this.persist();
    this.emit({ kind: 'status', status: await this.status() });
    return { fileName };
  }

  /** Set the context window, rejecting only sizes the file cannot represent. */
  async setContextSize(contextSize: number): Promise<ModelStatusSnapshot> {
    const bounds = await this.contextBounds({});
    if (!Number.isInteger(contextSize) || contextSize < bounds.min || contextSize > bounds.maxModel) {
      throw new Error(
        `Context size must be a whole number between ${formatGrouped(bounds.min)} and ${formatGrouped(bounds.maxModel)} tokens`,
      );
    }
    await this.ensureSettings();
    this.settings.contextSize = contextSize;
    await this.persist();
    const snapshot = await this.status();
    this.emit({ kind: 'status', status: snapshot });
    return snapshot;
  }

  /**
   * Measured limits for the context field.
   *
   * The per-token cost is derived from the engine's own resource model by asking
   * it what two context sizes would cost and dividing the difference — better
   * than a constant, because it accounts for this file's layer count, attention
   * layout and quantisation. Memory is read at request time, so the ceiling
   * reflects what is actually free rather than what was free at startup.
   */
  async contextBounds(args: { fileName?: string }): Promise<ContextBounds> {
    await this.ensureSettings();
    const files = await this.listInstalled();
    const fileName = args.fileName ?? this.selectedFor('chat', files) ?? recommendedFor('chat')?.fileName ?? '';
    const installed = files.find((f) => f.fileName === fileName);
    const catalogEntry = entryForFile(fileName);
    const weightsBytes = installed?.sizeBytes ?? catalogEntry?.sizeBytes ?? 0;

    const filePath = installed ? path.join(this.paths.modelsDir, fileName) : '';
    const facts = filePath ? await this.factsFor(filePath) : {};
    const maxModel = facts.trainedContext ?? catalogEntry?.trainedContext ?? UNKNOWN_TRAINED_CONTEXT;
    const bytesPerToken = facts.bytesPerToken ?? 0;
    const freeBytes = this.freeBytes();
    const maxSafe = largestSafeContext({ freeBytes, weightsBytes, bytesPerToken, maxContext: maxModel });

    return {
      fileName,
      min: CONTEXT_MIN,
      maxModel,
      maxSafe,
      default: Math.min(DEFAULT_CONTEXT_SIZE, maxSafe),
      weightsBytes,
      bytesPerToken,
      freeBytes,
      reason:
        maxSafe < maxModel
          ? `Above ${formatGrouped(maxSafe)} tokens the KV cache no longer fits in the ${formatGrouped(
              Math.round(freeBytes / 1e9),
            )} GB free right now.`
          : undefined,
    };
  }

  private async factsFor(filePath: string): Promise<GgufFacts> {
    const cached = this.factsCache.get(filePath);
    if (cached) return cached;
    const facts = await this.readGgufFacts(filePath).catch(() => ({} as GgufFacts));
    this.factsCache.set(filePath, facts);
    return facts;
  }

  /** Roles a given installed file can serve, from its own metadata. */
  async rolesFor(fileName: string): Promise<ModelRole[]> {
    const known = entryForFile(fileName);
    if (known) return [known.role];
    const facts = await this.factsFor(path.join(this.paths.modelsDir, fileName));
    const { rolesForArchitecture } = await import('./catalog.js');
    return rolesForArchitecture(facts.architecture);
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Read architecture, trained context and per-token cost from a GGUF file
 * without loading it.
 *
 * `node-llama-cpp` is imported lazily: the module performs native-binary
 * discovery when it is first touched, and settings, catalogue and list views must
 * keep working on a machine where that discovery fails.
 */
async function readGgufFactsFromDisk(filePath: string): Promise<GgufFacts> {
  const { GgufInsights, readGgufFileInfo } = await import('node-llama-cpp');
  // Tensor info is skipped: it is the slow part of reading a header and none of
  // these facts need it.
  const info = await readGgufFileInfo(filePath, { readTensorInfo: false, logWarnings: false });
  const architecture = (info.metadata.general as { architecture?: string } | undefined)?.architecture;
  const insights = await GgufInsights.from(info);

  // Two CPU-inference context sizes, divided by their token difference, gives the
  // marginal cost of a token for this particular file.
  const small = await insights.estimateContextResourceRequirementsV2({
    contextSize: 1024,
    modelGpuLayers: 0,
    useMmap: true,
  });
  const large = await insights.estimateContextResourceRequirementsV2({
    contextSize: 8192,
    modelGpuLayers: 0,
    useMmap: true,
  });
  const delta = large.cpuRam - small.cpuRam;
  const trained = insights.trainContextSize;

  return {
    ...(architecture ? { architecture } : {}),
    ...(typeof trained === 'number' && trained > 0 ? { trainedContext: trained } : {}),
    bytesPerToken: delta > 0 ? Math.round(delta / (8192 - 1024)) : 0,
  };
}
