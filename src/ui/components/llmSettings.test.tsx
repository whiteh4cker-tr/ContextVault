/**
 * @vitest-environment jsdom
 */
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ContextSizeField } from '../components/ContextSizeField';
import { GgufSelect } from '../components/GgufSelect';
import { RetrievalControls } from '../components/RetrievalControls';
import { estimateContextBytes, formatBytes } from '../../shared/budget';
import type { ContextBounds } from '../../shared/types';
import { renderWithTheme } from '../test/render';

const bounds: ContextBounds = {
  fileName: 'gemma-4-12B-it-qat-UD-Q4_K_XL.gguf',
  min: 256,
  maxModel: 262_144,
  maxSafe: 4096,
  default: 16384,
  weightsBytes: 6_719_400_000,
  bytesPerToken: 196_608,
  freeBytes: 8_000_000_000,
  reason: 'Above 4 096 tokens the KV cache no longer fits.',
};

const field = () => screen.getByLabelText('Context size (tokens)') as HTMLInputElement;
const apply = () => screen.getByRole('button', { name: 'Apply' }) as HTMLButtonElement;

describe('ContextSizeField', () => {
  it('waits for the measurement rather than showing a made-up limit', () => {
    renderWithTheme(<ContextSizeField bounds={null} value={16384} onChange={() => {}} />);
    expect(screen.getByText('Measuring the model’s memory requirements…')).toBeTruthy();
  });

  it('shows the applied size with the memory it costs', () => {
    renderWithTheme(<ContextSizeField bounds={bounds} value={2048} onChange={() => {}} />);
    expect(field().value).toBe('2048');
    const total = estimateContextBytes(bounds.weightsBytes, bounds.bytesPerToken, 2048);
    expect(
      screen.getByText(`Weights 6.3 GB + ~${formatBytes(total - bounds.weightsBytes)} of KV cache`),
    ).toBeTruthy();
  });

  it('does not offer Apply until something is actually changing', () => {
    renderWithTheme(<ContextSizeField bounds={bounds} value={2048} onChange={() => {}} />);
    expect(apply().disabled).toBe(true);
  });

  it('applies a typed size', () => {
    const onChange = vi.fn();
    renderWithTheme(<ContextSizeField bounds={bounds} value={2048} onChange={onChange} />);
    fireEvent.change(field(), { target: { value: '4096' } });
    expect(apply().disabled).toBe(false);
    fireEvent.click(apply());
    expect(onChange).toHaveBeenCalledWith(4096);
  });

  it('applies on Enter, because that is how a number field is submitted', () => {
    const onChange = vi.fn();
    renderWithTheme(<ContextSizeField bounds={bounds} value={2048} onChange={onChange} />);
    fireEvent.change(field(), { target: { value: '8192' } });
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(8192);
  });

  it('refuses a size the model cannot represent', () => {
    const onChange = vi.fn();
    renderWithTheme(<ContextSizeField bounds={bounds} value={2048} onChange={onChange} />);
    fireEvent.change(field(), { target: { value: '300000' } });
    expect(screen.getByText('This model supports at most 262 144 tokens.')).toBeTruthy();
    expect(apply().disabled).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('refuses a size below the engine minimum', () => {
    renderWithTheme(<ContextSizeField bounds={bounds} value={2048} onChange={() => {}} />);
    fireEvent.change(field(), { target: { value: '128' } });
    expect(screen.getByText('Context size must be at least 256 tokens.')).toBeTruthy();
    expect(apply().disabled).toBe(true);
  });

  it('refuses a size that is not a whole number of tokens', () => {
    renderWithTheme(<ContextSizeField bounds={bounds} value={2048} onChange={() => {}} />);
    fireEvent.change(field(), { target: { value: '16k' } });
    expect(screen.getByText('Context size must be a whole number of tokens.')).toBeTruthy();
    expect(apply().disabled).toBe(true);
  });

  it('warns that a size needs more memory than is free, and still lets it be applied', () => {
    const onChange = vi.fn();
    renderWithTheme(<ContextSizeField bounds={bounds} value={2048} onChange={onChange} />);
    fireEvent.change(field(), { target: { value: '16384' } });

    const warning = screen.getByRole('alert');
    expect(warning.textContent).toContain('16 384 tokens needs ~');
    expect(warning.textContent).toContain(`only ${formatBytes(bounds.freeBytes)} is free`);
    expect(warning.textContent).toContain('Above 4 096 tokens the KV cache no longer fits.');
    // The measurement is a snapshot; the decision stays with the user.
    expect(apply().disabled).toBe(false);
    fireEvent.click(apply());
    expect(onChange).toHaveBeenCalledWith(16384);
  });

  it('jumps to the largest size that fits', () => {
    const onChange = vi.fn();
    renderWithTheme(<ContextSizeField bounds={bounds} value={256} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Use largest that fits (4 096)' }));
    expect(onChange).toHaveBeenCalledWith(4096);
  });

  it('is inert while the engine is busy', () => {
    const onChange = vi.fn();
    renderWithTheme(<ContextSizeField bounds={bounds} value={2048} onChange={onChange} disabled />);
    expect(field().disabled).toBe(true);
    expect(apply().disabled).toBe(true);
    expect(
      screen.getByRole('button', { name: 'Use largest that fits (4 096)' }).hasAttribute('disabled'),
    ).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('prints where the ceiling came from', () => {
    renderWithTheme(<ContextSizeField bounds={bounds} value={2048} onChange={() => {}} />);
    expect(
      screen.getByText(`Ceiling from ${formatBytes(bounds.freeBytes)} free · model trained to 262 144`),
    ).toBeTruthy();
  });
});

describe('GgufSelect', () => {
  const base = {
    caption: 'Writes the answers.',
    catalog: [
      {
        fileName: 'gemma-4-12B-it-qat-UD-Q4_K_XL.gguf',
        role: 'chat' as const,
        url: 'https://huggingface.co/unsloth/gemma-4-12B-it-qat-GGUF/resolve/main/gemma-4-12B-it-qat-UD-Q4_K_XL.gguf',
        sizeBytes: 6_719_400_000,
        label: 'Gemma 4 12B Instruct — QAT Q4_K_XL',
        recommended: true,
      },
    ],
    installed: [
      { fileName: 'gemma-4-12B-it-qat-UD-Q4_K_XL.gguf', role: 'chat' as const, sizeBytes: 6_719_400_000 },
    ],
    active: 'gemma-4-12B-it-qat-UD-Q4_K_XL.gguf',
  };

  it('shows the installed file in the control', () => {
    renderWithTheme(
      <GgufSelect
        {...base}
        role="chat"
        title="Chat model"
        onSelect={() => {}}
        onDownload={() => {}}
        onImport={() => {}}
        onDelete={() => {}}
      />,
    );
    const combo = screen.getByRole('combobox', { name: 'Chat model' });
    expect(combo.textContent).toContain('gemma-4-12B-it-qat-UD-Q4_K_XL.gguf');
    expect(
      screen.getByRole('button', { name: 'Delete gemma-4-12B-it-qat-UD-Q4_K_XL.gguf chat model' }),
    ).toBeTruthy();
  });

  it('states the size of each file once the list is opened', () => {
    // Asserted on its own: while a MUI menu is open it marks the rest of the
    // document aria-hidden, so controls outside it are no longer reachable.
    renderWithTheme(
      <GgufSelect
        {...base}
        role="chat"
        title="Chat model"
        onSelect={() => {}}
        onDownload={() => {}}
        onImport={() => {}}
        onDelete={() => {}}
      />,
    );
    // MUI's Select opens on mouseDown, not click.
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Chat model' }));
    expect(screen.getByRole('option', { name: /gemma-4-12B-it-qat-UD-Q4_K_XL\.gguf/ }).textContent).toContain(
      '6.3 GB',
    );
  });

  it('offers to delete an installed file', () => {
    renderWithTheme(
      <GgufSelect
        {...base}
        role="chat"
        title="Chat model"
        onSelect={() => {}}
        onDownload={() => {}}
        onImport={() => {}}
        onDelete={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: 'Delete gemma-4-12B-it-qat-UD-Q4_K_XL.gguf chat model' })).toBeTruthy();
  });

  it('selects a different installed file', () => {
    const onSelect = vi.fn();
    renderWithTheme(
      <GgufSelect
        {...base}
        role="chat"
        title="Chat model"
        installed={[
          ...base.installed,
          { fileName: 'llama-3.1-8b.Q4_K_M.gguf', role: 'chat', sizeBytes: 4_920_000_000 },
        ]}
        onSelect={onSelect}
        onDownload={() => {}}
        onImport={() => {}}
        onDelete={() => {}}
      />,
    );
    // MUI's Select opens on mouseDown, not click.
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Chat model' }));
    fireEvent.click(screen.getByRole('option', { name: /llama-3\.1-8b\.Q4_K_M\.gguf/ }));
    expect(onSelect).toHaveBeenCalledWith('llama-3.1-8b.Q4_K_M.gguf');
  });

  it('offers the recommended download when nothing is installed', () => {
    const onDownload = vi.fn();
    renderWithTheme(
      <GgufSelect
        {...base}
        role="embedding"
        title="Embedding model"
        installed={[]}
        catalog={[
          {
            fileName: 'bge-m3-q8_0.gguf',
            role: 'embedding',
            url: 'https://huggingface.co/cstr/bge-m3-GGUF/resolve/main/bge-m3-q8_0.gguf',
            sizeBytes: 609_700_000,
            label: 'BGE-M3 embeddings — q8_0, 1024-d',
            recommended: true,
          },
        ]}
        active={undefined}
        onSelect={() => {}}
        onDownload={onDownload}
        onImport={() => {}}
        onDelete={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Download BGE-M3 embeddings/ }));
    expect(onDownload).toHaveBeenCalledWith(
      expect.objectContaining({ fileName: 'bge-m3-q8_0.gguf', role: 'embedding' }),
    );
  });

  it('refuses a URL that is not a GGUF file', () => {
    const onDownload = vi.fn();
    renderWithTheme(
      <GgufSelect
        {...base}
        role="chat"
        title="Chat model"
        onSelect={() => {}}
        onDownload={onDownload}
        onImport={() => {}}
        onDelete={() => {}}
      />,
    );
    const urlField = screen.getByLabelText('Custom GGUF URL');
    fireEvent.change(urlField, { target: { value: 'https://example.com/model.safetensors' } });
    const download = screen.getByRole('button', { name: 'Download' }) as HTMLButtonElement;
    expect(download.disabled).toBe(true);
    expect(screen.getByText('The URL must point at a .gguf file.')).toBeTruthy();

    fireEvent.change(urlField, { target: { value: 'https://example.com/models/llama-3.1-8b.Q4_K_M.gguf' } });
    expect(download.disabled).toBe(false);
    fireEvent.click(download);
    expect(onDownload).toHaveBeenCalledWith(
      expect.objectContaining({ fileName: 'llama-3.1-8b.Q4_K_M.gguf', role: 'chat' }),
    );
  });

  it('registers a file that is already on disk', () => {
    const onImport = vi.fn();
    renderWithTheme(
      <GgufSelect
        {...base}
        role="chat"
        title="Chat model"
        onSelect={() => {}}
        onDownload={() => {}}
        onImport={onImport}
        onDelete={() => {}}
      />,
    );
    const use = screen.getByRole('button', { name: 'Use file' }) as HTMLButtonElement;
    expect(use.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Already on this machine'), {
      target: { value: 'D:/models/mistral.Q4_K_M.gguf' },
    });
    expect(use.disabled).toBe(false);
    fireEvent.click(use);
    expect(onImport).toHaveBeenCalledWith('D:/models/mistral.Q4_K_M.gguf');
  });
});

describe('RetrievalControls', () => {
  const base = {
    retrieval: { topK: 5, floor: 0.25 },
    chunking: { chunkSize: 1000, chunkOverlap: 150 },
  };

  const handlers = (over: Partial<Parameters<typeof RetrievalControls>[0]> = {}) => ({
    onTopK: vi.fn(),
    onFloor: vi.fn(),
    onChunking: vi.fn(),
    ...over,
  });

  it('changes how many passages are retrieved', () => {
    const props = handlers();
    renderWithTheme(<RetrievalControls {...base} {...props} />);
    expect(screen.getByText('top 5')).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Passages retrieved per question' }), { key: 'End' });
    expect(props.onTopK).toHaveBeenCalledWith(12);
  });

  it('reports the similarity floor as a percentage', () => {
    renderWithTheme(<RetrievalControls {...base} {...handlers()} />);
    expect(screen.getByText('Minimum similarity')).toBeTruthy();
    expect(screen.getAllByText('25%').length).toBeGreaterThanOrEqual(1);
  });

  it('requires an explicit apply before re-embedding anything', () => {
    const props = handlers();
    renderWithTheme(<RetrievalControls {...base} {...props} />);
    const applyButton = screen.getByRole('button', { name: 'Apply chunking settings' }) as HTMLButtonElement;
    expect(applyButton.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Chunk size'), { target: { value: '1500' } });
    expect(applyButton.disabled).toBe(false);
    fireEvent.click(applyButton);
    expect(props.onChunking).toHaveBeenCalledWith({ chunkSize: 1500, chunkOverlap: 150 });
  });

  it('refuses an overlap that is not smaller than the chunk', () => {
    renderWithTheme(<RetrievalControls {...base} {...handlers()} />);
    fireEvent.change(screen.getByLabelText('Chunk size'), { target: { value: '1000' } });
    fireEvent.change(screen.getByLabelText('Overlap'), { target: { value: '1000' } });
    expect(screen.getByRole('button', { name: 'Apply chunking settings' }).hasAttribute('disabled')).toBe(true);
  });
});
