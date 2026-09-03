/**
 * @vitest-environment jsdom
 */
import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { AppProviders } from '../AppProviders';
import { AiStatusChip } from '../components/AiStatusChip';
import { ModelChip } from '../components/ModelChip';
import { ModelGate } from '../components/ModelGate';
import { RamGauge } from '../components/RamGauge';
import { TopAppBar } from '../components/TopAppBar';
import { composerBlock } from '../state/engineGate';
import { renderWithTheme } from '../test/render';
import { pollUntil } from '../test/poll';
import { createFakeBackend } from '../mock/fakeBackend';
import { formatBytes } from '../../shared/budget';
import type { LLMState, ModelCatalogEntry, SystemStats } from '../../shared/types';
import type { ModelsController } from '../state/useModels';

const llm = (over: Partial<LLMState> = {}): LLMState => ({
  activeGgufFile: 'gemma-4-12B-it-qat-UD-Q4_K_XL.gguf',
  contextSize: 16_384,
  isModelLoaded: true,
  isStreaming: false,
  phase: 'idle',
  ...over,
});

const stats = (over: Partial<SystemStats> = {}): SystemStats => ({
  totalBytes: 17_179_869_184,
  freeBytes: 6_871_947_673,
  usedBytes: 10_307_921_511,
  modelBytes: 6_719_400_000,
  residentBytes: 420_000_000,
  ...over,
});

describe('TopAppBar', () => {
  it('names the application and states the model and its budget', () => {
    renderWithTheme(<TopAppBar state={llm()} stats={stats()} dark onToggleTheme={() => {}} />);
    expect(screen.getByRole('heading', { name: 'ContextVault' })).toBeTruthy();
    expect(screen.getByLabelText(/model gemma-4-12B-it-qat-UD-Q4_K_XL\.gguf, 16384 tokens of context/i)).toBeTruthy();
    expect(screen.getByText(/16k ctx/)).toBeTruthy();
    expect(screen.getByText('Ready')).toBeTruthy();
  });

  it('offers the colour scheme switch by what it does', () => {
    const onToggleTheme = vi.fn();
    renderWithTheme(<TopAppBar state={llm()} stats={stats()} dark onToggleTheme={onToggleTheme} />);
    fireEvent.click(screen.getByRole('button', { name: 'Use light theme' }));
    expect(onToggleTheme).toHaveBeenCalled();
  });
});

describe('ModelChip', () => {
  it('says there is no model rather than showing an empty chip', () => {
    renderWithTheme(<ModelChip file={null} contextSize={0} />);
    expect(screen.getByText('No model')).toBeTruthy();
  });
});

describe('AiStatusChip', () => {
  it('names the phase in words, not only in colour', () => {
    renderWithTheme(<AiStatusChip state={llm({ phase: 'streaming', isStreaming: true })} />);
    expect(screen.getByText('Streaming')).toBeTruthy();
    expect(screen.getByLabelText('Engine status: Streaming')).toBeTruthy();
  });

  it('reports indexing separately from streaming', () => {
    renderWithTheme(<AiStatusChip state={llm({ phase: 'indexing' })} />);
    expect(screen.getByText('Indexing')).toBeTruthy();
  });
});

describe('RamGauge', () => {
  it('states memory as a bar and as a sentence', () => {
    renderWithTheme(<RamGauge stats={stats()} />);
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('60');
    expect(screen.getByText(`${formatBytes(6_871_947_673)} free of ${formatBytes(17_179_869_184)}`)).toBeTruthy();
  });

  it('says it is reading rather than showing zero', () => {
    renderWithTheme(<RamGauge stats={null} />);
    expect(screen.getByText(/reading/i)).toBeTruthy();
  });
});

describe('composerBlock', () => {
  it('names the next action for every reason the engine cannot answer', () => {
    expect(composerBlock(llm({ phase: 'no-model', isModelLoaded: false, activeGgufFile: null }), 0)).toContain(
      'Download the chat model',
    );
    expect(composerBlock(llm({ phase: 'loading-model', isModelLoaded: false }), 2)).toContain('Loading');
    expect(composerBlock(llm({ phase: 'error', isModelLoaded: false }), 2)).toContain('error');
    expect(composerBlock(llm(), 0)).toContain('Add a document');
  });

  it('says nothing when questions are fine', () => {
    expect(composerBlock(llm(), 3)).toBeNull();
    expect(composerBlock(llm({ phase: 'streaming', isStreaming: true }), 3)).toBeNull();
  });
});

describe('ModelGate', () => {
  const entry = (over: Partial<ModelCatalogEntry> = {}): ModelCatalogEntry => ({
    fileName: 'gemma-4-12B-it-qat-UD-Q4_K_XL.gguf',
    role: 'chat',
    url: 'https://huggingface.co/unsloth/gemma-4-12B-it-qat-GGUF/resolve/main/gemma-4-12B-it-qat-UD-Q4_K_XL.gguf',
    sizeBytes: 6_719_400_000,
    label: 'Gemma 4 12B Instruct — QAT Q4_K_XL',
    recommended: true,
    ...over,
  });

  const models = (over: Partial<ModelsController> = {}): ModelsController => ({
    status: {
      contextSize: 16_384,
      chat: { role: 'chat', state: 'missing' },
      embedding: { role: 'embedding', state: 'missing' },
    },
    catalog: [
      entry(),
      entry({
        fileName: 'bge-m3-q8_0.gguf',
        role: 'embedding',
        url: 'https://example.com/bge-m3-q8_0.gguf',
        sizeBytes: 609_700_000,
        label: 'BGE-M3 embeddings — q8_0, 1024-d',
      }),
    ],
    installed: [],
    bounds: null,
    download: null,
    error: null,
    refresh: vi.fn(),
    select: vi.fn(),
    remove: vi.fn(),
    downloadEntry: vi.fn(),
    cancel: vi.fn(),
    importFile: vi.fn(),
    applyContextSize: vi.fn(),
    ...over,
  });

  it('offers both models before anything is on disk', () => {
    const controller = models();
    renderWithTheme(<ModelGate open models={controller} />);
    const gate = screen.getByRole('dialog');
    expect(within(gate).getByText(/only time it reaches the network/i)).toBeTruthy();
    fireEvent.click(within(gate).getByRole('button', { name: /Download Gemma 4 12B/i }));
    expect(controller.downloadEntry).toHaveBeenCalledWith('chat', {
      fileName: 'gemma-4-12B-it-qat-UD-Q4_K_XL.gguf',
      url: expect.stringContaining('gemma-4-12B-it-qat-UD-Q4_K_XL.gguf'),
    });
  });

  it('is not in the way once a model is loaded', () => {
    renderWithTheme(<ModelGate open={false} models={models()} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('App', () => {
  it('gates the window until a model is on disk', async () => {
    const api = createFakeBackend({ stageDelayMs: 1, modelsInstalled: false });
    renderWithTheme(
      <AppProviders>
        <App api={api} />
      </AppProviders>,
    );
    await pollUntil(() => screen.getByText('Put a model on disk to begin'));
    // The corpus and the transcript stay behind the gate rather than being replaced.
    expect(screen.getByRole('heading', { name: 'ContextVault' })).toBeTruthy();
  });

  it('explains why an empty corpus cannot be asked about', async () => {
    const api = createFakeBackend({ stageDelayMs: 1 });
    renderWithTheme(
      <AppProviders>
        <App api={api} />
      </AppProviders>,
    );
    await pollUntil(() => screen.getByText('Add a document to ask a question about it.'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('heading', { name: 'ContextVault' })).toBeTruthy();
  });
});
