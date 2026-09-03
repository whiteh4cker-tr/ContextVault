import { describe, expect, it } from 'vitest';
import {
  CATALOG,
  POOLING,
  catalogForRole,
  needsQueryInstruction,
  recommendedFor,
  rolesForArchitecture,
} from './catalog';
import { RETRIEVAL_QUERY_INSTRUCTION, withQueryInstruction } from './rag/instruction.js';

/**
 * Role detection is decided by the file, not by its name.
 *
 * The case that forced this: `qwen3-embedding-4b-q4_k_m.gguf` declares
 * architecture `qwen3`, the same string the Qwen3 chat models declare, and the
 * only thing that separates them is `pooling_type: last`. A name- or
 * architecture-based guess would offer the embedder in the chat dropdown, where
 * it fails at load with a message about pooling.
 */
describe('rolesForArchitecture', () => {
  it('reads a pooling head as an embedding model even when the architecture is a chat one', () => {
    expect(rolesForArchitecture('qwen3', POOLING.last)).toEqual(['embedding']);
  });

  it('treats a decoder with no pooling head as chat-only', () => {
    expect(rolesForArchitecture('qwen3', undefined)).toEqual(['chat']);
    expect(rolesForArchitecture('gemma4', undefined)).toEqual(['chat']);
  });

  it('recognises encoder architectures by name as well', () => {
    expect(rolesForArchitecture('bert', undefined)).toEqual(['embedding']);
    expect(rolesForArchitecture('xlmr', POOLING.cls)).toEqual(['embedding']);
  });

  it('refuses a reranker, which scores pairs instead of producing vectors', () => {
    // Indexing one would fill the store with numbers that are not embeddings and
    // never return a hit — a silent failure worth refusing outright.
    expect(rolesForArchitecture('bce', POOLING.rank)).toEqual([]);
  });

  it('is undecided only when the file said nothing at all', () => {
    expect(rolesForArchitecture(undefined, undefined)).toEqual(['chat', 'embedding']);
  });
});

describe('needsQueryInstruction', () => {
  it('instructs the query side of models trained that way', () => {
    expect(needsQueryInstruction('qwen3', POOLING.last)).toBe(true);
  });

  it('leaves other embedders alone, because prefixing them moves their vectors', () => {
    expect(needsQueryInstruction('bert', POOLING.cls)).toBe(false);
    expect(needsQueryInstruction('nomic-bert', POOLING.mean)).toBe(false);
    expect(needsQueryInstruction('gemma4', undefined)).toBe(false);
  });
});

describe('query instruction text', () => {
  it('puts the question after the task sentence, unchanged', () => {
    const question = 'What notice period does clause 4 require?';
    const built = withQueryInstruction(question);
    expect(built.startsWith(RETRIEVAL_QUERY_INSTRUCTION)).toBe(true);
    expect(built.endsWith(question)).toBe(true);
    expect(built.slice(RETRIEVAL_QUERY_INSTRUCTION.length)).toBe(question);
  });

  it('states a retrieval task and stays on two lines', () => {
    expect(RETRIEVAL_QUERY_INSTRUCTION.split('\n')).toHaveLength(2);
    expect(RETRIEVAL_QUERY_INSTRUCTION.startsWith('Instruct:')).toBe(true);
    expect(RETRIEVAL_QUERY_INSTRUCTION.trimEnd().endsWith('Query:')).toBe(true);
  });
});

describe('catalogue', () => {
  it('recommends exactly one file per role', () => {
    for (const role of ['chat', 'embedding'] as const) {
      const recommended = catalogForRole(role).filter((entry) => entry.recommended);
      expect(recommended).toHaveLength(1);
      expect(recommendedFor(role)?.fileName).toBe(recommended[0]?.fileName);
    }
  });

  it('lists direct download addresses, not repository pages', () => {
    // The downloader takes a file URL; a blob page would fail mid-download.
    for (const entry of CATALOG) {
      expect(entry.url.startsWith('https://')).toBe(true);
      expect(entry.url).toContain('/resolve/main/');
      expect(entry.url.endsWith(entry.fileName)).toBe(true);
    }
  });

  it('states a size for every entry, because the download progress needs a denominator', () => {
    for (const entry of CATALOG) {
      expect(entry.sizeBytes).toBeGreaterThan(100_000_000);
    }
  });

  it('records the vector width of the embedder it recommends', () => {
    // The index filename carries the width; an entry without it would leave the
    // schema to be guessed from the first vector that arrives.
    expect(recommendedFor('embedding')?.dimensions).toBeGreaterThan(0);
  });

  it('names the embedding model the engine can actually load', () => {
    // Regression guard for the BGE-M3 incident: that file converts as `xlmr`,
    // which the bundled llama.cpp refuses, so it must not come back as a choice.
    expect(CATALOG.some((entry) => entry.fileName.includes('bge-m3'))).toBe(false);
    expect(recommendedFor('embedding')?.fileName).toBe('qwen3-embedding-4b-q4_k_m.gguf');
  });
});
