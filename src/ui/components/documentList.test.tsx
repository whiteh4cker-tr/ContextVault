/**
 * @vitest-environment jsdom
 */
import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DocumentList } from '../components/DocumentList';
import { makeDocument } from '../test/fixtures';
import { renderWithTheme } from '../test/render';
import type { DocumentRecord, RagProgressEvent } from '../../shared/types';

function render(
  documents: DocumentRecord[],
  progress: Record<string, RagProgressEvent> = {},
  handlers: Partial<Parameters<typeof DocumentList>[0]> = {},
) {
  const props = {
    documents,
    progress,
    onSetActive: vi.fn(),
    onRemove: vi.fn(),
    onReindex: vi.fn(),
    ...handlers,
  };
  renderWithTheme(<DocumentList {...props} />);
  return props;
}

describe('DocumentList', () => {
  it('says there is nothing indexed yet', () => {
    render([]);
    expect(screen.getByText('Nothing indexed yet. Drop a file above to start.')).toBeTruthy();
  });

  it('summarises what retrieval will actually use', () => {
    render([makeDocument({ name: 'a.pdf' }), makeDocument({ name: 'b.pdf', active: false })]);
    expect(screen.getByText('1 of 2 in answers · 256 chunks')).toBeTruthy();
  });

  it('shows size, pages and chunk count per document', () => {
    render([makeDocument({ name: 'contract.pdf', sizeBytes: 512_000, pages: 12, chunkCount: 128 })]);
    const meta = screen.getByText('500 KB · 12 pages · 128 chunks');
    expect(meta).toBeTruthy();
  });

  it('toggles a document out of the answer set', () => {
    const doc = makeDocument({ name: 'a.pdf' });
    const props = render([doc]);
    fireEvent.click(screen.getByRole('button', { name: 'Exclude a.pdf from answers' }));
    expect(props.onSetActive).toHaveBeenCalledWith(doc.id, false);
  });

  it('removes a document', () => {
    const doc = makeDocument({ name: 'a.pdf' });
    const props = render([doc]);
    fireEvent.click(screen.getByRole('button', { name: 'Remove a.pdf' }));
    expect(props.onRemove).toHaveBeenCalledWith(doc.id);
  });

  it('will not toggle a document that has finished nothing', () => {
    render([makeDocument({ name: 'wip.pdf', status: { state: 'indexing', stage: 'embedding' } })]);
    const toggle = screen.getByRole('button', { name: 'Exclude wip.pdf from answers' }) as HTMLButtonElement;
    expect(toggle.disabled).toBe(true);
  });

  it('reports the running stage with a determinate bar', () => {
    const doc = makeDocument({ name: 'big.pdf', chunkCount: 1000, status: { state: 'indexing', stage: 'embedding' } });
    render([doc], {
      [doc.id]: { docId: doc.id, stage: 'embedding', ratio: 0.4, detail: '400 / 1 000 chunks', queuePosition: 0 },
    });
    expect(screen.getByText('Generating embeddings')).toBeTruthy();
    expect(screen.getByText('400 / 1 000 chunks')).toBeTruthy();
    const bar = screen.getByRole('progressbar', { name: 'Generating embeddings' });
    expect(bar.getAttribute('aria-valuenow')).toBe('40');
  });

  it('shows an indeterminate bar when the engine cannot say how far along it is', () => {
    const doc = makeDocument({ name: 'big.pdf', status: { state: 'indexing', stage: 'parsing' } });
    render([doc], {
      [doc.id]: { docId: doc.id, stage: 'parsing', ratio: -1, detail: '', queuePosition: 0 },
    });
    const bar = screen.getByRole('progressbar', { name: 'Parsing document' });
    expect(bar.getAttribute('aria-valuenow')).toBeNull();
  });

  it('explains a failure and offers a retry', () => {
    const doc = makeDocument({
      name: 'scan.pdf',
      chunkCount: 0,
      status: { state: 'failed', stage: 'parsing', message: 'No text layer — OCR is out of scope.' },
    });
    const props = render([doc]);
    expect(screen.getByText('No text layer — OCR is out of scope.')).toBeTruthy();
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Retry' }));
    expect(props.onReindex).toHaveBeenCalledWith(doc.id);
  });

  it('marks a document embedded under another model as stale', () => {
    const doc = makeDocument({
      name: 'old.pdf',
      status: { state: 'stale', message: 'Embedded with bge-small; re-index for bge-m3.' },
    });
    const props = render([doc]);
    expect(screen.getByText('Needs re-index')).toBeTruthy();
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Re-index' }));
    expect(props.onReindex).toHaveBeenCalledWith(doc.id);
  });

  it('says an inactive document is not being searched', () => {
    render([makeDocument({ name: 'off.pdf', active: false })]);
    expect(screen.getByText('Switched off — not searched')).toBeTruthy();
  });
});
