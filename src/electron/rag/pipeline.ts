import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ChunkingSettings, DocumentRecord, IngestStage, RagProgressEvent } from '../../shared/types.js';
import { chunkText } from './chunker.js';
import { extractDocument, kindForFile } from './extract.js';
import type { DocumentRegistry } from './registry.js';
import type { IIndex, StoreRecord } from './storeTypes.js';

/** What the pipeline needs from the embedding engine, kept narrow for testing. */
export interface Embedder {
  embed(texts: string[], onEach?: (done: number) => void): Promise<number[][]>;
  /**
   * Embed a question. Separate from `embed` because some embedders expect a task
   * sentence on the query side only, and applying it to stored passages would
   * move the whole corpus.
   */
  embedQuery(question: string): Promise<number[]>;
  getEmbeddingDimensions(): Promise<number>;
}

export interface PipelineDeps {
  registry: DocumentRegistry;
  store: IIndex;
  embeddings: Embedder;
  chunking: () => ChunkingSettings;
  /** File name of the embedder in use, recorded on each document. */
  embeddingModel: () => string;
  onProgress(event: RagProgressEvent): void;
  newId?(): string;
  now?(): number;
}

/**
 * Getting a file from disk into the index, one stage at a time.
 *
 * Stages are reported as they happen rather than summarised at the end, because
 * the slow ones are minutes long and "it is thinking" is not an answer when
 * someone is deciding whether to wait. The percentages are real: parsing reports
 * pages completed, embedding reports passages completed.
 *
 * One document is processed at a time. Embedding a large PDF holds the whole
 * document's vectors in memory, and running two at once doubles a peak that is
 * already the largest thing on the machine.
 */
export class IngestionPipeline {
  private readonly deps: PipelineDeps;
  private queue: Promise<unknown> = Promise.resolve();
  /** Ids waiting their turn; the running document is not in here. */
  private waiting: string[] = [];

  constructor(deps: PipelineDeps) {
    this.deps = deps;
  }

  /** Add files, deduplicated by content hash. Returns one record per accepted file. */
  async addPaths(paths: string[]): Promise<DocumentRecord[]> {
    const records: DocumentRecord[] = [];
    for (const filePath of paths) {
      records.push(await this.addOne(path.resolve(filePath)));
    }
    return records;
  }

  private async addOne(filePath: string): Promise<DocumentRecord> {
    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat?.isFile()) throw new Error(`No such file: ${filePath}`);

    const kind = kindForFile(filePath);
    const bytes = await fs.readFile(filePath);
    const sha256 = createHash('sha256').update(bytes).digest('hex');

    await this.deps.registry.load();
    const existing = this.deps.registry.all().find((record) => record.sha256 === sha256);
    if (existing) {
      // Same bytes, same index entries. Re-indexing a file the corpus already
      // has would double every citation to it.
      this.report(existing.id, 'ready', 1, 'Already in the corpus — not added twice');
      return existing;
    }

    const record: DocumentRecord = {
      id: (this.deps.newId ?? (() => globalThis.crypto.randomUUID()))(),
      name: path.basename(filePath),
      path: filePath,
      kind,
      sizeBytes: stat.size,
      sha256,
      active: true,
      chunkCount: 0,
      pages: 0,
      embeddedWith: '',
      status: { state: 'queued', stage: 'queued' },
      addedAt: (this.deps.now ?? (() => Date.now()))(),
    };
    await this.deps.registry.upsert(record);
    this.waiting.push(record.id);
    this.report(record.id, 'queued', 0, 'Waiting for its turn');
    this.enqueue(record);
    return record;
  }

  /** Re-run chunking and embedding for a document, keeping its extraction. */
  async reindex(id: string): Promise<DocumentRecord> {
    const record = this.deps.registry.get(id);
    if (!record) throw new Error(`No such document: ${id}`);
    // Its old vectors go first, or the corpus would hold two copies of it under
    // different chunk offsets.
    await this.deps.store.deleteIds(chunkIdsFor(id, Math.max(record.chunkCount, 0)));
    this.enqueue({ ...record, status: { state: 'queued', stage: 'queued' }, chunkCount: 0 });
    return { ...record, status: { state: 'queued', stage: 'queued' } };
  }

  /** Remove a document from the registry and its vectors from the index. */
  async remove(id: string): Promise<void> {
    const record = this.deps.registry.get(id);
    await this.deps.registry.remove(id);
    if (record) await this.deps.store.deleteIds(chunkIdsFor(id, Math.max(record.chunkCount, 0)));
  }

  private enqueue(record: DocumentRecord): void {
    this.queue = this.queue.then(() => {
      const position = this.waiting.indexOf(record.id);
      if (position !== -1) this.waiting.splice(position, 1);
      return undefined;
    }).then(
      () => this.run(record).catch(() => undefined),
      () => this.run(record).catch(() => undefined),
    );
  }

  /** Wait for the queue to drain. Used at shutdown and by tests. */
  async idle(): Promise<void> {
    await this.queue;
  }

  private report(docId: string, stage: IngestStage, ratio: number, detail: string, error?: string): void {
    const position = this.waiting.indexOf(docId);
    this.deps.onProgress({
      docId,
      stage,
      ratio,
      detail,
      // Zero means "this one is running"; one-based means "there are N ahead of it".
      queuePosition: position === -1 ? 0 : position + 1,
      ...(error ? { error } : {}),
    });
  }

  private async run(record: DocumentRecord): Promise<void> {
    const id = record.id;
    try {
      await this.deps.registry.update(id, { status: { state: 'indexing', stage: 'parsing' } });
      this.report(id, 'parsing', 0, 'Reading the file');

      const extraction = await extractDocument(record.path);
      const pages = extraction.pages.length;
      await this.deps.registry.update(id, {
        pages,
        kind: extraction.kind,
        status: { state: 'indexing', stage: 'chunking' },
      });
      this.report(id, 'parsing', 1, `${pages} ${pages === 1 ? 'page' : 'pages'}`);

      if (extraction.text.trim().length === 0) {
        // A PDF with no text layer is a real object people have: a scan. It needs
        // OCR, which this application does not do, and saying so is better than
        // indexing a document that can never match anything.
        throw new Error('This file contains no extractable text. A scanned PDF needs OCR first.');
      }

      const settings = this.deps.chunking();
      const chunks = chunkText(extraction.text, { chunkSize: settings.chunkSize, chunkOverlap: settings.chunkOverlap });
      const pageByOffset = buildPageLookup(extraction.pages);
      await this.deps.registry.update(id, { status: { state: 'indexing', stage: 'embedding' } });
      this.report(id, 'chunking', 1, `${chunks.length} ${chunks.length === 1 ? 'passage' : 'passages'}`);

      const dimensions = await this.deps.embeddings.getEmbeddingDimensions();
      const vectors = await this.deps.embeddings.embed(chunks.map((chunk) => chunk.text), (done) =>
        this.report(id, 'embedding', chunks.length === 0 ? 1 : done / chunks.length, `${done} / ${chunks.length} passages`),
      );

      const records: StoreRecord[] = chunks.map((chunk, index) => ({
        id: `${id}:${chunk.index}`,
        vector: vectors[index] ?? [],
        metadata: {
          documentId: id,
          documentName: record.name,
          page: pageByOffset(chunk.start),
          chunkIndex: chunk.index,
          text: chunk.text,
          start: chunk.start,
          end: chunk.end,
        },
      }));

      await this.deps.registry.update(id, { status: { state: 'indexing', stage: 'indexing' } });
      this.report(id, 'indexing', 0, `Writing ${records.length} vectors (${dimensions}-dimensional)`);
      await this.deps.store.insert(records);

      await this.deps.registry.update(id, {
        chunkCount: records.length,
        // Which embedder produced these vectors. A different model's vectors are a
        // different coordinate system, so this is what marks a document stale when
        // the user switches.
        embeddedWith: this.deps.embeddingModel(),
        status: { state: 'ready' },
      });
      this.report(id, 'ready', 1, `${records.length} passages indexed from ${pages} pages`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.deps.registry
        .update(id, { status: { state: 'failed', stage: 'failed', message } })
        .catch(() => undefined);
      this.report(id, 'failed', 0, message, message);
    }
  }

}

/** Chunk ids are derivable, so deleting a document needs no extra lookup table. */
export function chunkIdsFor(documentId: string, chunkCount: number): string[] {
  return Array.from({ length: chunkCount }, (_, index) => `${documentId}:${index}`);
}

/**
 * Which printed page a character offset falls on.
 *
 * Offsets come from the concatenated extraction, so the page is found by walking
 * the accumulated lengths — which is exact, given the extraction is the same one
 * the chunks were cut from.
 */
export function buildPageLookup(pages: { page: number; text: string }[]): (offset: number) => number {
  const boundaries: { page: number; from: number; to: number }[] = [];
  let cursor = 0;
  for (const page of pages) {
    // Pages are joined with a blank line, and the separator belongs to no page.
    const from = cursor;
    const to = from + page.text.length;
    boundaries.push({ page: page.page, from, to });
    cursor = to + 2;
  }

  return (offset: number) => {
    for (const boundary of boundaries) {
      if (offset >= boundary.from && offset <= boundary.to) return boundary.page;
    }
    return boundaries[0]?.page ?? 1;
  };
}
