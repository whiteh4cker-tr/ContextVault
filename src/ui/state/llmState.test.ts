import { describe, expect, it } from 'vitest';
import { PHASE_LABEL, deriveLLMState } from './llmState';
import type { ModelStatusSnapshot } from '../../shared/types';

function snapshot(state: ModelStatusSnapshot['chat']['state'], contextSize = 16_384): ModelStatusSnapshot {
  return {
    contextSize,
    chat: { role: 'chat', state, fileName: state === 'missing' ? undefined : 'gemma-4-12B.gguf' },
    embedding: { role: 'embedding', state, fileName: 'bge-m3-q8_0.gguf', dimensions: 1024 },
  };
}

describe('deriveLLMState', () => {
  it('says no-model when nothing is installed', () => {
    const state = deriveLLMState(snapshot('missing'), { isStreaming: false, isIndexing: false });
    expect(state.phase).toBe('no-model');
    expect(state.activeGgufFile).toBeNull();
    expect(state.isModelLoaded).toBe(false);
  });

  it('says ready when a model is loaded and nothing is happening', () => {
    const state = deriveLLMState(snapshot('ready'), { isStreaming: false, isIndexing: false });
    expect(state.phase).toBe('idle');
    expect(state.activeGgufFile).toBe('gemma-4-12B.gguf');
    expect(state.contextSize).toBe(16_384);
    expect(PHASE_LABEL[state.phase]).toBe('Ready');
  });

  it('reports streaming ahead of indexing, because that is what the user is waiting for', () => {
    const state = deriveLLMState(snapshot('ready'), { isStreaming: true, isIndexing: true });
    expect(state.phase).toBe('streaming');
  });

  it('reports a download ahead of indexing', () => {
    const state = deriveLLMState(snapshot('downloading'), { isStreaming: false, isIndexing: true });
    expect(state.phase).toBe('loading-model');
  });

  it('reports indexing when documents are being embedded', () => {
    const state = deriveLLMState(snapshot('ready'), { isStreaming: false, isIndexing: true });
    expect(state.phase).toBe('indexing');
  });

  it('surfaces an engine error rather than falling back to ready', () => {
    expect(deriveLLMState(snapshot('error'), { isStreaming: false, isIndexing: false }).phase).toBe('error');
  });

  it('tolerates a status that has not arrived yet', () => {
    const state = deriveLLMState(null, { isStreaming: false, isIndexing: false });
    expect(state.phase).toBe('no-model');
    expect(state.contextSize).toBe(0);
  });

  it('omits usedTokens when the engine has not reported any', () => {
    const state = deriveLLMState(snapshot('ready'), { isStreaming: false, isIndexing: false });
    expect('usedTokens' in state).toBe(false);
  });
});
