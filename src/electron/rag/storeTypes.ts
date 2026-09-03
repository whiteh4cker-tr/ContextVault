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
