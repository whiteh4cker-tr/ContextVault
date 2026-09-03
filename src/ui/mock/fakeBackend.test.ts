import { describe, expect, it, vi } from 'vitest';
import { CATALOG as REAL_CATALOG } from '../../electron/catalog';
import { CATALOG, DEFAULT_CONTEXT_SIZE, createFakeBackend } from './fakeBackend';

/** Stage names in the order they first appear, ignoring progress repeats. */
function stageWalk(seen: string[]): string[] {
  return seen.filter((stage, i) => stage !== seen[i - 1]);
}

async function withIndexedDocument(stageDelayMs = 1) {
  const backend = createFakeBackend({ stageDelayMs });
  await backend.addDocuments({ paths: ['C:/fake/contract.pdf'] });
  await vi.waitFor(async () => {
    expect((await backend.listDocuments())[0].status.state).toBe('ready');
  });
  return backend;
}

describe('fakeBackend models', () => {
  it('offers the two default GGUF files, one per role', async () => {
    const catalog = await createFakeBackend().modelCatalog();
    const roles = catalog.filter((entry) => entry.recommended).map((entry) => entry.role).sort();
    expect(roles).toEqual(['chat', 'embedding']);
  });

  it('shows exactly the catalogue the main process would download', async () => {
    // The fake exists so the interface can be developed and demonstrated without
    // gigabytes of weights. That only helps while it says the same thing the real
    // engine does — same files, same addresses, same sizes, same vector width.
    for (const entry of CATALOG) {
      const real = REAL_CATALOG.find((candidate) => candidate.fileName === entry.fileName);
      expect(real, `${entry.fileName} is not in the real catalogue`).toBeTruthy();
      expect({ ...entry }).toEqual(real);
    }
  });

  it('starts ready when the defaults are installed', async () => {
    const status = await createFakeBackend().modelStatus();
    expect(status.chat.state).toBe('ready');
    expect(status.embedding.state).toBe('ready');
    expect(status.contextSize).toBe(DEFAULT_CONTEXT_SIZE);
  });

  it('reports missing when it is not', async () => {
    const status = await createFakeBackend({ modelsInstalled: false }).modelStatus();
    expect(status.chat.state).toBe('missing');
    expect(status.embedding.state).toBe('missing');
  });

  it('counts a download all the way to ready', async () => {
    const backend = createFakeBackend({ stageDelayMs: 1, modelsInstalled: false });
    const percents: number[] = [];
    backend.onModelEvent((event) => {
      if (event.kind === 'download') percents.push(event.percent);
    });
    await backend.downloadModel({ role: 'embedding', url: CATALOG[1].url, fileName: CATALOG[1].fileName });
    expect(percents).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    expect((await backend.modelStatus()).embedding.state).toBe('ready');
  });

  it('bounds the context field by measured memory rather than by the model’s trained length', async () => {
    const bounds = await createFakeBackend({ freeBytes: 8_000_000_000 }).contextBounds({});
    expect(bounds.maxModel).toBe(262_144);
    // 8 GB free minus 6.72 GB of weights leaves room for ~6 500 tokens at
    // 196 608 B/token, so the largest size that fits is 4096.
    expect(bounds.maxSafe).toBe(4096);
    expect(bounds.min).toBe(256);
    expect(bounds.reason).toContain('4 096');
  });

  it('applies a context size and reports it back', async () => {
    const backend = createFakeBackend({ stageDelayMs: 1 });
    expect((await backend.modelStatus()).contextSize).toBe(DEFAULT_CONTEXT_SIZE);
    const updated = await backend.setContextSize({ contextSize: 8192 });
    expect(updated.contextSize).toBe(8192);
    expect((await backend.modelStatus()).contextSize).toBe(8192);
  });
});

describe('fakeBackend ingestion', () => {
  it('walks a dropped document through every stage to ready', async () => {
    const backend = createFakeBackend({ stageDelayMs: 1 });
    const seen: string[] = [];
    backend.onRagProgress((event) => seen.push(event.stage));
    await backend.addDocuments({ paths: ['C:/fake/contract.pdf'] });
    // Wait on the event stream rather than on the record: the record flips to
    // ready just before the last progress event is delivered.
    await vi.waitFor(() => expect(seen).toContain('ready'));
    expect(stageWalk(seen)).toEqual(['hashing', 'parsing', 'chunking', 'embedding', 'indexing', 'ready']);
    const doc = (await backend.listDocuments())[0];
    expect(doc.chunkCount).toBeGreaterThan(0);
    expect(doc.pages).toBeGreaterThan(0);
    expect(doc.active).toBe(true);
  });

  it('indexes the progress ratio inside the embedding stage', async () => {
    const backend = createFakeBackend({ stageDelayMs: 1 });
    const embeddingRatios: number[] = [];
    backend.onRagProgress((event) => {
      if (event.stage === 'embedding') embeddingRatios.push(event.ratio);
    });
    await backend.addDocuments({ paths: ['C:/fake/contract.pdf'] });
    await vi.waitFor(async () => {
      expect((await backend.listDocuments())[0].status.state).toBe('ready');
    });
    expect(embeddingRatios.length).toBeGreaterThanOrEqual(2);
    expect(embeddingRatios.at(-1)).toBe(1);
  });

  it('does not index the same file twice', async () => {
    const backend = createFakeBackend({ stageDelayMs: 1 });
    await backend.addDocuments({ paths: ['C:/fake/a.pdf', 'C:/fake/a.pdf'] });
    expect((await backend.listDocuments())).toHaveLength(1);
  });

  it('removes a document', async () => {
    const backend = await withIndexedDocument();
    const [id] = (await backend.listDocuments()).map((d) => d.id);
    const remaining = await backend.removeDocument({ id });
    expect(remaining.map((d) => d.id)).not.toContain(id);
  });

  it('keeps a document but excludes it from retrieval when switched off', async () => {
    const backend = await withIndexedDocument();
    const [id] = (await backend.listDocuments()).map((d) => d.id);
    await backend.setDocumentActive({ id, active: false });
    expect((await backend.listDocuments())[0].active).toBe(false);

    const conv = (await backend.listConversations())[0];
    await backend.send({ conversationId: conv.id, text: 'Term?', requestId: 'off-1' });
    const last = (await backend.loadMessages({ conversationId: conv.id })).at(-1);
    expect(last?.citations).toHaveLength(0);
    expect(last?.provenance).toBe('no-context');
  });

  it('reindexes with the current chunking settings', async () => {
    const backend = await withIndexedDocument();
    const doc = (await backend.listDocuments())[0];
    await backend.setChunkingSettings({ chunkSize: 250, chunkOverlap: 40 });
    const smaller = await backend.reindexDocument({ id: doc.id });
    expect(smaller.chunkCount).toBeGreaterThan(doc.chunkCount);
  });
});

describe('fakeBackend chat', () => {
  it('streams an answer in order and closes the turn exactly once', async () => {
    const backend = await withIndexedDocument();
    const conv = (await backend.listConversations())[0];
    const parts: string[] = [];
    let doneCount = 0;
    backend.onChatChunk((event) => {
      if (event.done) doneCount += 1;
      else parts.push(event.text);
    });

    await backend.send({ conversationId: conv.id, text: 'What is the term?', requestId: 'r1' });

    expect(doneCount).toBe(1);
    const content = parts.join('');
    expect(content).toContain('[1]');
    const last = (await backend.loadMessages({ conversationId: conv.id })).at(-1);
    expect(last?.content).toBe(content);
    expect(last?.done).toBe(true);
    expect(last?.provenance).toBe('cited');
    expect(last?.citations.length).toBeGreaterThan(0);
    expect(last?.tokensPerSecond).toBeGreaterThan(0);
  });

  it('cites the document by name and page', async () => {
    const backend = await withIndexedDocument();
    const conv = (await backend.listConversations())[0];
    await backend.send({ conversationId: conv.id, text: 'Termination?', requestId: 'r2' });
    const last = (await backend.loadMessages({ conversationId: conv.id })).at(-1);
    expect(last?.citations[0]?.documentName).toBe('contract.pdf');
    expect(last?.citations[0]?.page).toBeGreaterThanOrEqual(1);
    expect(last?.citations[0]?.similarity).toBeGreaterThan(0);
  });

  it('says it has nothing to answer from when nothing is indexed', async () => {
    const backend = createFakeBackend({ stageDelayMs: 1 });
    const conv = (await backend.listConversations())[0];
    await backend.send({ conversationId: conv.id, text: 'Anything at all?', requestId: 'r3' });
    const last = (await backend.loadMessages({ conversationId: conv.id })).at(-1);
    expect(last?.provenance).toBe('no-context');
    expect(last?.content).toMatch(/nothing/i);
  });

  it('stops a turn without inventing the rest of it', async () => {
    const backend = createFakeBackend({ stageDelayMs: 30 });
    await backend.addDocuments({ paths: ['C:/fake/contract.pdf'] });
    await vi.waitFor(async () => {
      expect((await backend.listDocuments())[0].status.state).toBe('ready');
    });
    const conv = (await backend.listConversations())[0];
    const sending = backend.send({ conversationId: conv.id, text: 'Tell me everything', requestId: 'r4' });
    await new Promise((resolve) => setTimeout(resolve, 12));
    await backend.stop({ requestId: 'r4' });
    await sending;

    const last = (await backend.loadMessages({ conversationId: conv.id })).at(-1);
    expect(last?.done).toBe(true);
    expect(last?.provenance).toBe('aborted');
    expect(last?.content.length).toBeLessThan(400);
  });

  it('titles a conversation from its first question', async () => {
    const backend = await withIndexedDocument();
    const conv = (await backend.listConversations())[0];
    await backend.send({ conversationId: conv.id, text: 'Is there an indemnity clause?', requestId: 'r5' });
    expect((await backend.listConversations())[0].title).toContain('indemnity');
  });

  it('always leaves one conversation to talk into', async () => {
    const backend = createFakeBackend({ stageDelayMs: 1 });
    const first = (await backend.listConversations())[0];
    const remaining = await backend.deleteConversation({ id: first.id });
    expect(remaining.length).toBe(1);
  });
});
