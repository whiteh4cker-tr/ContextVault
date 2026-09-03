import { passesFloor, selectTopK, similarityFromDistance } from '../../shared/budget';
import type { StoreHit } from './storeTypes';

/**
 * Reading the index: turning raw neighbours into passages that may be cited.
 *
 * The index is asked for more passages than are shown, then filtered against the
 * registry. That order is not a performance trick — the registry is the authority
 * on which documents exist and which are switched on, and a search that trusted
 * the index would happily cite a document the user deleted or switched off this
 * morning because its vectors are still in the file.
 */

/** Over-fetch depth. Filters remove switched-off, stale and deleted documents. */
export const OVERFETCH_FACTOR = 3;

export interface Passage {
  /** `${documentId}:${chunkIndex}` */
  chunkId: string;
  documentId: string;
  documentName: string;
  page: number;
  chunkIndex: number;
  text: string;
  /** 0..1, converted once from the index's distance. */
  similarity: number;
  start: number;
  end: number;
}

function readNumber(metadata: Record<string, unknown>, key: string): number {
  const value = metadata[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function readString(metadata: Record<string, unknown>, key: string): string {
  const value = metadata[key];
  return typeof value === 'string' ? value : '';
}

/**
 * Convert index hits into passages, discarding malformed ones.
 *
 * A hit whose metadata cannot be read is dropped rather than guessed at: a
 * citation with a page number invented by a default value would be a fabricated
 * reference, and fabricated references are the one thing this feature must never
 * produce.
 */
export function passagesFromHits(hits: readonly StoreHit[]): Passage[] {
  const passages: Passage[] = [];

  for (const hit of hits) {
    const metadata = hit.metadata ?? {};
    const text = readString(metadata, 'text');
    const documentId = readString(metadata, 'documentId');
    if (text.length === 0 || documentId.length === 0) continue;

    passages.push({
      chunkId: hit.id,
      documentId,
      documentName: readString(metadata, 'documentName') || documentId,
      page: readNumber(metadata, 'page'),
      chunkIndex: readNumber(metadata, 'chunkIndex'),
      text,
      // ruvector reports distance; identical is 0. The conversion lives in
      // `shared/budget` so the whole application agrees on what a similarity is.
      similarity: similarityFromDistance(hit.distance),
      start: readNumber(metadata, 'start'),
      end: readNumber(metadata, 'end'),
    });
  }

  return passages;
}

export interface SelectOptions {
  topK: number;
  /** 0..1 similarity floor. */
  floor: number;
  /** Documents that are switched on, indexed and embedded with the live model. */
  activeDocumentIds: ReadonlySet<string>;
}

/**
 * Narrow retrieved passages to the ones a question may be answered from.
 *
 * Filter by activity first, then by the similarity floor, then rank and cut. The
 * order matters: if ranking came first, a passage from a switched-off document
 * could occupy one of the slots that a qualifying passage would otherwise have
 * taken, and the answer would silently get worse.
 */
export function selectPassages(passages: readonly Passage[], options: SelectOptions): Passage[] {
  // `selectTopK` is the single implementation of filter-then-rank-then-cut; it
  // speaks in `docId`, which is what the index calls a document.
  const rows = passages.map((passage) => ({ ...passage, docId: passage.documentId }));
  const selected = selectTopK(rows, {
    topK: options.topK,
    floor: options.floor,
    activeDocIds: options.activeDocumentIds,
  });
  return selected.slice(0, options.topK);
}

/** How many neighbours to ask the index for, given what will be filtered out. */
export function overFetchDepth(topK: number): number {
  return Math.max(topK, topK * OVERFETCH_FACTOR);
}

export { passesFloor };
