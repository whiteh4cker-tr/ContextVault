/** One passage's vector, plus what is needed to cite it without a second lookup. */
export interface StoreRecord {
  /** `${documentId}:${chunkIndex}` — deleting a document deletes its chunks. */
  id: string;
  vector: number[];
  metadata: {
    documentId: string;
    documentName: string;
    page: number;
    chunkIndex: number;
    /** The passage itself, stored here so a citation needs no file read. */
    text: string;
    /** Character offsets into the extracted text, for exact quotation. */
    start: number;
    end: number;
  };
}

/** A raw index hit. `distance` is a distance, not a similarity. */
export interface StoreHit {
  id: string;
  distance: number;
  metadata: Record<string, unknown>;
}

/**
 * What the rest of the application needs from an index.
 *
 * The client class has lifecycle members of its own; nothing else should see
 * them. Keeping the interface small is also what lets a lazily-created index be
 * handed to the ingestion pipeline before the embedding model has reported its
 * vector width.
 */
export interface IIndex {
  insert(records: StoreRecord[]): Promise<{ count: number }>;
  search(vector: number[], k: number): Promise<StoreHit[]>;
  deleteIds(ids: string[]): Promise<number>;
  count(): Promise<number>;
}
