import fs from 'node:fs/promises';
import path from 'node:path';
import type { DocumentRecord } from '../../shared/types.js';

/**
 * The list of documents the user has added, and what happened to each one.
 *
 * This file, not the vector index, is the authority on what is in the corpus. The
 * index is a derived structure that can be rebuilt; the registry holds the things
 * that cannot be recomputed — which files were chosen, which are switched off,
 * which embedding model produced their vectors.
 *
 * Writes go through a temporary file and a rename. An application that indexes
 * multi-gigabyte PDFs will eventually be closed mid-write, and a half-written
 * registry that parses as empty would silently delete someone's corpus list.
 */
export class DocumentRegistry {
  private records: DocumentRecord[] = [];
  private loaded = false;

  private readonly file: string;

  constructor(file: string) {
    this.file = file;
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = await fs.readFile(this.file, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      this.records = parseRegistry(parsed);
    } catch (error) {
      // A registry that cannot be read is not the same as an empty one: keeping
      // the file makes recovery possible, so it is set aside rather than
      // overwritten by the next flush.
      if (error instanceof SyntaxError) await this.quarantine();
      this.records = [];
    }
  }

  private async quarantine(): Promise<void> {
    try {
      await fs.rename(this.file, `${this.file}.corrupt-${Date.now()}`);
    } catch {
      /* nothing else to do */
    }
  }

  all(): DocumentRecord[] {
    return this.records.map((record) => ({ ...record }));
  }

  get(id: string): DocumentRecord | undefined {
    const found = this.records.find((record) => record.id === id);
    return found ? { ...found } : undefined;
  }

  /** Insert or replace by id, keeping the list in the order it was added. */
  async upsert(record: DocumentRecord): Promise<DocumentRecord> {
    await this.load();
    const index = this.records.findIndex((existing) => existing.id === record.id);
    if (index === -1) this.records.push({ ...record });
    else this.records[index] = { ...record };
    await this.flush();
    return { ...record };
  }

  async update(id: string, patch: Partial<DocumentRecord>): Promise<DocumentRecord | undefined> {
    await this.load();
    const index = this.records.findIndex((record) => record.id === id);
    if (index === -1) return undefined;
    this.records[index] = { ...this.records[index]!, ...patch, id };
    await this.flush();
    return { ...this.records[index]! };
  }

  async remove(id: string): Promise<DocumentRecord | undefined> {
    await this.load();
    const index = this.records.findIndex((record) => record.id === id);
    if (index === -1) return undefined;
    const [removed] = this.records.splice(index, 1);
    await this.flush();
    return removed;
  }

  /** Every document retrieval is allowed to consider. */
  active(embeddingModel?: string): DocumentRecord[] {
    return this.records.filter(
      (record) =>
        record.active &&
        record.status.state === 'ready' &&
        (embeddingModel === undefined || record.embeddedWith === embeddingModel),
    );
  }

  private async flush(): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.tmp`;
    await fs.writeFile(temp, JSON.stringify({ version: 1, documents: this.records }, null, 2), 'utf8');
    await fs.rename(temp, this.file);
  }
}

/**
 * Accept a registry file only if it has the shape we write.
 *
 * Records that are missing fields are dropped rather than defaulted: an unknown
 * document with a guessed path would be presented to the user as theirs, and a
 * wrong path is worse than a missing one.
 */
export function parseRegistry(parsed: unknown): DocumentRecord[] {
  const documents = (parsed as { documents?: unknown })?.documents;
  if (!Array.isArray(documents)) return [];

  return documents.filter((entry): entry is DocumentRecord => {
    if (typeof entry !== 'object' || entry === null) return false;
    const record = entry as Partial<DocumentRecord>;
    return (
      typeof record.id === 'string' &&
      typeof record.name === 'string' &&
      typeof record.path === 'string' &&
      typeof record.sha256 === 'string' &&
      typeof record.active === 'boolean' &&
      typeof record.status?.state === 'string'
    );
  });
}

/**
 * Mark documents whose vectors were produced by a different embedding model.
 *
 * Vectors from two embedders are not comparable — they are different coordinate
 * systems that happen to have the same length. Comparing them produces scores
 * that look plausible and mean nothing, which is the worst possible failure:
 * confident nonsense. So such documents are held out of retrieval until they are
 * re-embedded, rather than silently mixed in.
 */
export function reconcileStale(records: DocumentRecord[], embeddingModel: string | null): DocumentRecord[] {
  return records.map((record) => {
    const readyWithOtherModel =
      record.status.state === 'ready' && embeddingModel !== null && record.embeddedWith !== embeddingModel;

    if (readyWithOtherModel) {
      return {
        ...record,
        status: {
          state: 'stale' as const,
          message: `Indexed with ${record.embeddedWith}; re-embed for the current model.`,
        },
      };
    }

    // A document that was stale becomes live again the moment its model matches —
    // switching back to the embedder it was built with should not require a
    // re-embed, since the vectors are still valid.
    const staleForMatchedModel = record.status.state === 'stale' && record.embeddedWith === embeddingModel;
    if (staleForMatchedModel) return { ...record, status: { state: 'ready' as const } };

    return record;
  });
}
