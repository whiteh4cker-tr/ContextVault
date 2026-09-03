import type { Citation, DocumentRecord, Message, ModelStatusSnapshot } from '../../shared/types';

let counter = 0;

/** A document record with sensible defaults; override only what a test cares about. */
export function makeDocument(overrides: Partial<DocumentRecord> = {}): DocumentRecord {
  counter += 1;
  return {
    id: `doc-${counter}`,
    name: `document-${counter}.pdf`,
    path: `/fake/document-${counter}.pdf`,
    kind: 'application/pdf',
    sizeBytes: 512_000,
    sha256: 'a'.repeat(64),
    active: true,
    chunkCount: 128,
    pages: 12,
    embeddedWith: 'bge-m3-q8_0.gguf',
    status: { state: 'ready' },
    addedAt: 0,
    ...overrides,
  };
}

let messageCounter = 0;

/** A passage the model claims to have read. */
export function makeCitation(overrides: Partial<Citation> = {}): Citation {
  return {
    index: 1,
    documentId: 'doc-1',
    documentName: 'annual-report.pdf',
    page: 7,
    chunkIndex: 14,
    similarity: 0.82,
    snippet: 'Revenue rose 14% year over year, driven by the services division.',
    ...overrides,
  };
}

/** A transcript entry; assistant messages carry citations by default. */
export function makeMessage(overrides: Partial<Message> = {}): Message {
  messageCounter += 1;
  return {
    id: `msg-${messageCounter}`,
    conversationId: 'conv-1',
    role: 'assistant',
    content: 'Revenue rose 14% [1].',
    citations: [makeCitation()],
    provenance: 'cited',
    createdAt: 0,
    done: true,
    ...overrides,
  };
}

export function makeStatus(
  overrides: Partial<ModelStatusSnapshot> = {},
): ModelStatusSnapshot {
  return {
    contextSize: 16_384,
    chat: { role: 'chat', state: 'ready', fileName: 'gemma-4-12B-it-qat-UD-Q4_K_XL.gguf', sizeBytes: 6_719_400_000 },
    embedding: { role: 'embedding', state: 'ready', fileName: 'bge-m3-q8_0.gguf', sizeBytes: 609_700_000, dimensions: 1024 },
    ...overrides,
  };
}
