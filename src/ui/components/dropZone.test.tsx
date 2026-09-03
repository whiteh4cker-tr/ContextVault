/**
 * @vitest-environment jsdom
 */
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DropZone } from '../components/DropZone';
import { renderWithTheme } from '../test/render';

const file = (name: string, type = 'application/pdf') => new File(['x'], name, { type });

function drop(files: File[]): HTMLElement {
  const zone = screen.getByRole('region', { name: 'Add documents' });
  fireEvent.drop(zone, { dataTransfer: { files } });
  return zone;
}

describe('DropZone', () => {
  it('announces itself to assistive technology', () => {
    renderWithTheme(<DropZone onAdd={vi.fn()} />);
    expect(screen.getByRole('region', { name: 'Add documents' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Choose files' })).toBeTruthy();
  });

  it('has a keyboard-reachable file input that accepts the same types as the drop target', () => {
    renderWithTheme(<DropZone onAdd={vi.fn()} />);
    const input = screen.getByLabelText('Choose documents to index') as HTMLInputElement;
    expect(input.type).toBe('file');
    expect(input.multiple).toBe(true);
    expect(input.accept).toContain('.pdf');
    expect(input.accept).toContain('.txt');
  });

  it('accepts PDFs and plain text', () => {
    const onAdd = vi.fn();
    renderWithTheme(<DropZone onAdd={onAdd} />);
    drop([file('contract.pdf'), file('notes.txt', 'text/plain')]);
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd.mock.calls[0]?.[0]).toEqual(['contract.pdf', 'notes.txt']);
  });

  it('refuses anything else and says why, without dropping the accepted files', () => {
    const onAdd = vi.fn();
    renderWithTheme(<DropZone onAdd={onAdd} />);
    drop([file('contract.pdf'), file('setup.exe', 'application/octet-stream')]);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('setup.exe');
    expect(alert.textContent).toContain('only PDF and TXT');
    expect(onAdd.mock.calls[0]?.[0]).toEqual(['contract.pdf']);
  });

  it('stays silent when a drop contains nothing it can use', () => {
    const onAdd = vi.fn();
    renderWithTheme(<DropZone onAdd={onAdd} />);
    drop([file('image.png', 'image/png')]);
    expect(onAdd).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('image.png');
  });

  it('ignores drops while disabled', () => {
    const onAdd = vi.fn();
    renderWithTheme(<DropZone onAdd={onAdd} disabled />);
    drop([file('contract.pdf')]);
    expect(onAdd).not.toHaveBeenCalled();
  });
});
