import type { Citation, Message, Provenance, RetrievalSettings } from '../../shared/types.js';
import { buildPrompt, citedSubset, classifyProvenance } from './prompt.js';
import { overFetchDepth, passagesFromHits, selectPassages, type Passage } from './retrieve.js';
import type { IIndex } from './storeTypes.js';
import type { Embedder } from './pipeline.js';

/** A document registry, narrowed to what retrieval needs. */
export interface ActiveDocuments {
  /** Documents that are switched on, indexed, and embedded with `model`. */
  active(model: string): { id: string }[];
}

export interface RunnerDeps {
  embeddings: Embedder;
  store: IIndex;
  documents: ActiveDocuments;
  streamChat(
    prompt: string,
    options: { signal?: AbortSignal; onTextChunk?: (text: string) => void },
  ): Promise<{ text: string; tokenCount: number; tokensPerSecond: number; aborted: boolean }>;
  retrieval(): RetrievalSettings;
  contextSize(): number;
  embeddingModel(): string;
}

export interface TurnInput {
  conversationId: string;
  requestId: string;
  question: string;
  signal?: AbortSignal;
  /** Called with each arriving piece of text, exactly as the model produced it. */
  onText(chunk: string): void;
}

export interface TurnOutcome {
  text: string;
  citations: Citation[];
  provenance: Provenance;
  tokenCount: number;
  tokensPerSecond: number;
  /** Retrieved but left out of the prompt for lack of room. */
  dropped: Passage[];
  error?: string;
}

/**
 * One question, start to finish.
 *
 * The order is the interesting part: the question is embedded with the same model
 * that embedded the corpus, the index is asked for three times as many neighbours
 * as will be shown, the registry decides which of them count, only then is a
 * prompt built, and only after the answer exists are the citations decided — from
 * the markers the model actually wrote, not from what was offered to it.
 *
 * Every exit path returns an outcome with a provenance. A turn that produced
 * nothing still says which kind of nothing, because the user is about to decide
 * whether to trust the sentence on screen.
 */
export async function runTurn(deps: RunnerDeps, input: TurnInput): Promise<TurnOutcome> {
  const settings = deps.retrieval();
  const empty: TurnOutcome = {
    text: '',
    citations: [],
    provenance: 'no-context',
    tokenCount: 0,
    tokensPerSecond: 0,
    dropped: [],
  };

  const active = new Set(deps.documents.active(deps.embeddingModel()).map((document) => document.id));
  if (active.size === 0) return empty;

  let passages: Passage[] = [];
  try {
    const questionVector = await deps.embeddings.embedQuery(input.question);
    if (!questionVector) return empty;

    const hits = await deps.store.search(questionVector, overFetchDepth(settings.topK));
    passages = selectPassages(passagesFromHits(hits), {
      topK: settings.topK,
      floor: settings.floor,
      activeDocumentIds: active,
    });
  } catch (error) {
    return { ...empty, provenance: 'error', error: describe(error) };
  }

  if (passages.length === 0) return empty;

  const built = buildPrompt(input.question, passages, deps.contextSize());
  if (built.passages.length === 0) {
    // Nothing fitted at all. Better to say so than to answer from nothing while
    // the user believes there were five passages behind it.
    return { ...empty, dropped: built.dropped };
  }

  try {
    const response = await deps.streamChat(built.prompt, {
      signal: input.signal,
      onTextChunk: (chunk) => input.onText(chunk),
    });

    const text = response.text;
    const citations = citedSubset(built.citations, text);
    const provenance = classifyProvenance({
      passagesUsed: built.passages.length,
      answer: text,
      aborted: response.aborted,
    });

    return {
      text,
      citations,
      provenance,
      tokenCount: response.tokenCount,
      tokensPerSecond: response.tokensPerSecond,
      dropped: built.dropped,
    };
  } catch (error) {
    return {
      ...empty,
      provenance: 'error',
      citations: [],
      dropped: built.dropped,
      error: describe(error),
    };
  }
}

/** Assemble the assistant message from a turn's outcome. */
export function messageFromTurn(input: {
  conversationId: string;
  messageId: string;
  outcome: TurnOutcome;
  createdAt?: number;
}): Message {
  const { outcome } = input;
  return {
    id: input.messageId,
    conversationId: input.conversationId,
    role: 'assistant',
    content: outcome.text,
    citations: outcome.citations,
    provenance: outcome.provenance,
    createdAt: input.createdAt ?? Date.now(),
    done: true,
    tokenCount: outcome.tokenCount,
    tokensPerSecond: outcome.tokensPerSecond > 0 ? outcome.tokensPerSecond : undefined,
    ...(outcome.error ? { error: outcome.error } : {}),
  };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
