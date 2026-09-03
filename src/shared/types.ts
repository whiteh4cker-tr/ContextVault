/**
 * The contract between the Electron main process and the sandboxed renderer.
 *
 * This module is compiled twice — once under `tsconfig.app.json` (DOM lib) and
 * once under `src/electron/tsconfig.json` (node only) — so it must not import
 * Node, Electron or DOM globals. Everything crossing `contextBridge` is
 * structured-cloneable: plain objects, arrays, numbers, strings.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Models
// ─────────────────────────────────────────────────────────────────────────────

/** Two GGUF files, two jobs: one embeds text, the other writes answers. */
export type ModelRole = 'chat' | 'embedding';

export type ModelState = 'missing' | 'downloading' | 'loading' | 'ready' | 'error';

export interface ModelSlot {
  role: ModelRole;
  state: ModelState;
  /** Installed `.gguf` serving this role, when there is one. */
  fileName?: string;
  /** Bytes on disk. */
  sizeBytes?: number;
  /** Vector width — embedding role only; the index schema is derived from it. */
  dimensions?: number;
  /** Present when `state === 'error'`, written for the user rather than the log. */
  message?: string;
}

export interface ModelStatusSnapshot {
  chat: ModelSlot;
  embedding: ModelSlot;
  /** Active context window in tokens for the chat model. */
  contextSize: number;
}

export interface ModelFileInfo {
  fileName: string;
  role: ModelRole;
  sizeBytes: number;
}

/** A suggestion offered by the model manager's catalog. */
export interface ModelCatalogEntry {
  fileName: string;
  role: ModelRole;
  url: string;
  sizeBytes: number;
  label: string;
  recommended: boolean;
  /** Vector width this embedder produces (embedding role only). */
  dimensions?: number;
  /**
   * Context length the file declares, read from its own metadata when it is on
   * disk and stated here otherwise. It is the ceiling a size can be judged
   * against before the file is even downloaded.
   */
  trainedContext?: number;
}

/**
 * Limits for the context-size field, measured against the model file and the
 * memory available when the request was made.
 *
 * `maxSafe` is advisory and `maxModel` is not: the first is what fits right now,
 * the second is what the model can represent at all.
 */
export interface ContextBounds {
  fileName: string;
  /** Smallest context the engine will accept. */
  min: number;
  /** The model's trained context length — the hard upper limit. */
  maxModel: number;
  /** Largest size that fits the memory measured when this was computed. */
  maxSafe: number;
  default: number;
  weightsBytes: number;
  /** KV-cache + graph overhead estimate for one token of context. */
  bytesPerToken: number;
  freeBytes: number;
  /** Why a size above `maxSafe` may not load, phrased for a person. */
  reason?: string;
}

/** Renderer-side view of the engine, aggregated from status + in-flight work. */
export interface LLMState {
  activeGgufFile: string | null;
  contextSize: number;
  isModelLoaded: boolean;
  isStreaming: boolean;
  phase: AiPhase;
  /** Tokens of context currently occupied by the transcript, when known. */
  usedTokens?: number;
}

export type AiPhase = 'no-model' | 'idle' | 'loading-model' | 'retrieving' | 'streaming' | 'indexing' | 'error';

// ─────────────────────────────────────────────────────────────────────────────
// Documents and the ingestion pipeline
// ─────────────────────────────────────────────────────────────────────────────

export type DocumentKind = 'application/pdf' | 'text/plain';

/** Ordered lifecycle; `failed` carries the stage that broke in `status.stage`. */
export type IngestStage =
  | 'queued'
  | 'hashing'
  | 'parsing'
  | 'chunking'
  | 'embedding'
  | 'indexing'
  | 'ready'
  | 'failed';

export type DocumentHealth = 'queued' | 'indexing' | 'ready' | 'failed' | 'stale';

export interface DocumentStatus {
  state: DocumentHealth;
  /** Stage reached when `state` is `indexing` or `failed`. */
  stage?: IngestStage;
  /** User-facing explanation when `state` is `failed` or `stale`. */
  message?: string;
}

export interface DocumentRecord {
  id: string;
  name: string;
  /** Absolute path on the user's machine; never leaves the main process. */
  path: string;
  kind: DocumentKind;
  sizeBytes: number;
  sha256: string;
  /** Toggling off is a registry change only — the vectors stay put. */
  active: boolean;
  chunkCount: number;
  pages: number;
  /** Embedding model that produced this document's vectors. */
  embeddedWith: string;
  status: DocumentStatus;
  addedAt: number;
}

/** Emitted for every stage transition and every measurable slice within one. */
export interface RagProgressEvent {
  docId: string;
  stage: IngestStage;
  /** 0..1 within `stage`; -1 when the total is genuinely unknown. */
  ratio: number;
  /** "412 / 1 845 chunks" — shown verbatim beside the bar. */
  detail: string;
  /** 1-based position in the ingestion queue; 0 when this document is running. */
  queuePosition: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Retrieval, citations, chat
// ─────────────────────────────────────────────────────────────────────────────

export interface RetrievalSettings {
  topK: number;
  /** Similarity floor in 0..1 (already converted from ruvector distance). */
  floor: number;
}

export interface ChunkingSettings {
  chunkSize: number;
  chunkOverlap: number;
}

export interface Citation {
  /** The `[n]` marker in the answer that points here. 1-based. */
  index: number;
  documentId: string;
  documentName: string;
  page: number;
  chunkIndex: number;
  /** 0..1; `1 - distance`. */
  similarity: number;
  snippet: string;
}

export type MessageRole = 'user' | 'assistant' | 'system';

/**
 * Why an answer looks the way it does. `unsourced` and `no-context` are visible
 * states in the UI, never silent ones — provenance is the product.
 */
export type Provenance = 'cited' | 'unsourced' | 'no-context' | 'aborted' | 'error';

export interface Message {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  citations: Citation[];
  provenance: Provenance;
  createdAt: number;
  /** False while chunks are still arriving. */
  done: boolean;
  tokenCount?: number;
  tokensPerSecond?: number;
  /** Present when `provenance === 'error'`. */
  error?: string;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

/** Pushed per streamed token group; exactly one `done: true` closes a turn. */
export interface ChatChunkEvent {
  requestId: string;
  conversationId: string;
  messageId: string;
  text: string;
  done: boolean;
  provenance?: Provenance;
  citations?: Citation[];
  tokenCount?: number;
  tokensPerSecond?: number;
  error?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// System
// ─────────────────────────────────────────────────────────────────────────────

export interface SystemStats {
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
  /** Weights of the loaded chat model, so the gauge can explain itself. */
  modelBytes: number;
  /** Process-resident bytes of ContextVault itself. */
  residentBytes: number;
  /** GPU backend chosen by node-llama-cpp: 'cuda' | 'metal' | 'vulkan' | 'cpu'. */
  gpuBackend?: string;
}

export type ModelEvent =
  | { kind: 'download'; role: ModelRole; fileName: string; percent: number; transferred: number; total: number }
  | { kind: 'status'; status: ModelStatusSnapshot };

// ─────────────────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────────────────

export type IpcErrorCode =
  | 'MODEL_MISSING'
  | 'MODEL_LOAD_FAILED'
  | 'INSUFFICIENT_MEMORY'
  | 'DOCUMENT_UNREADABLE'
  | 'NO_TEXT_LAYER'
  | 'DUPLICATE_DOCUMENT'
  | 'INDEX_UNAVAILABLE'
  | 'SCHEMA_MISMATCH'
  | 'PATH_NOT_ALLOWED'
  | 'INVALID_INPUT'
  | 'CANCELLED'
  | 'INTERNAL';

/** Never a stack trace: `hint` says what the user can do next. */
export interface IpcError {
  code: IpcErrorCode;
  message: string;
  hint?: string;
}
