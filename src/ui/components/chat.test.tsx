/**
 * @vitest-environment jsdom
 */
import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ChatContainer } from '../components/ChatContainer';
import { Composer } from '../components/Composer';
import { MarkdownText } from '../components/MarkdownText';
import { MessageBubble } from '../components/MessageBubble';
import { MessageList } from '../components/MessageList';
import { SourceViewerDialog } from '../components/SourceViewerDialog';
import { makeCitation, makeMessage } from '../test/fixtures';
import { renderWithTheme } from '../test/render';
import type { ChatController } from '../state/useChat';

describe('MarkdownText', () => {
  it('renders emphasis as markup rather than as the characters around it', () => {
    const { container } = renderWithTheme(<MarkdownText text="**up 14%** costs" />);
    expect(container.querySelector('strong')?.textContent).toBe('up 14%');
  });

  it('never turns answer text into HTML elements', () => {
    const { container } = renderWithTheme(<MarkdownText text={'<img src=x onerror=alert(1)>'} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('keeps code readable and literal', () => {
    const { container } = renderWithTheme(<MarkdownText text={'```python\nx = **y\n```'} />);
    expect(container.querySelector('pre')?.textContent).toContain('x = **y');
  });

  it('turns a passage marker into a button that opens that source', () => {
    const onCitation = vi.fn();
    const citation = makeCitation({ index: 1 });
    renderWithTheme(<MarkdownText text="Revenue rose [1]." citations={[citation]} onCitation={onCitation} />);
    fireEvent.click(screen.getByRole('button', { name: /source 1/i }));
    expect(onCitation).toHaveBeenCalledWith(citation);
  });

  it('leaves a marker with no matching source as text', () => {
    // The model can invent a reference. Showing a clickable chip for a source
    // that does not exist would fabricate provenance.
    renderWithTheme(<MarkdownText text="As stated [7]." citations={[]} />);
    expect(screen.queryByRole('button', { name: /source 7/i })).toBeNull();
    expect(screen.getByText(/\[7\]/).textContent).toContain('[7]');
  });

  it('makes a link clickable only for web addresses', () => {
    const { container } = renderWithTheme(<MarkdownText text="[report](https://example.com/r)" />);
    const anchor = container.querySelector('a');
    expect(anchor?.getAttribute('href')).toBe('https://example.com/r');
    expect(anchor?.getAttribute('rel')).toContain('noopener');
  });
});

describe('MessageBubble', () => {
  it('shows the question as written, without markdown or citation chips', () => {
    const { container } = renderWithTheme(
      <MessageBubble message={makeMessage({ role: 'user', content: 'What did **revenue** do [1]?' })} />,
    );
    expect(container.querySelector('strong')).toBeNull();
    expect(screen.getByText('What did **revenue** do [1]?')).toBeTruthy();
  });

  it('lists the sources an answer used', () => {
    renderWithTheme(<MessageBubble message={makeMessage()} />);
    expect(screen.getAllByRole('button', { name: /source 1/i }).length).toBeGreaterThan(0);
    expect(screen.getByText(/annual-report\.pdf/)).toBeTruthy();
  });

  it('says how strongly each source matched', () => {
    renderWithTheme(<MessageBubble message={makeMessage({ citations: [makeCitation({ similarity: 0.31 })] })} />);
    expect(screen.getByText(/31%/)).toBeTruthy();
    expect(screen.getByText(/weak/i)).toBeTruthy();
  });

  it('marks an answer that had no supporting passage', () => {
    renderWithTheme(<MessageBubble message={makeMessage({ citations: [], provenance: 'no-context' })} />);
    expect(screen.getByRole('status').textContent).toMatch(/nothing above the similarity floor/i);
  });

  it('marks an answer the model could not support with the retrieved text', () => {
    renderWithTheme(<MessageBubble message={makeMessage({ provenance: 'unsourced' })} />);
    expect(screen.getByRole('status').textContent).toMatch(/not grounded/i);
  });

  it('shows a stopped answer as stopped, not as a failure', () => {
    renderWithTheme(<MessageBubble message={makeMessage({ provenance: 'aborted', content: 'Revenue rose' })} />);
    expect(screen.getByRole('status').textContent).toMatch(/stopped/i);
  });

  it('shows the reason for a failed answer', () => {
    renderWithTheme(
      <MessageBubble message={makeMessage({ provenance: 'error', content: '', error: 'Out of memory' })} />,
    );
    expect(screen.getByRole('alert').textContent).toContain('Out of memory');
  });

  it('shows that an answer is still arriving', () => {
    renderWithTheme(
      <MessageBubble message={makeMessage({ content: 'Revenue', done: false })} streaming />,
    );
    expect(screen.getByRole('status').textContent).toMatch(/writing/i);
  });
});

describe('MessageList', () => {
  it('invites a first question instead of showing a blank pane', () => {
    renderWithTheme(<MessageList messages={[]} streamingId={null} onCitation={() => {}} />);
    expect(screen.getByText(/drop a document/i)).toBeTruthy();
  });

  it('is announced politely so a screen reader follows the answer', () => {
    renderWithTheme(<MessageList messages={[makeMessage()]} streamingId={null} onCitation={() => {}} />);
    const log = screen.getByRole('log');
    expect(log.getAttribute('aria-live')).toBe('polite');
  });
});

describe('Composer', () => {
  it('sends on Enter and writes a newline on Shift+Enter', () => {
    const onSend = vi.fn();
    renderWithTheme(<Composer onSend={onSend} onStop={() => {}} streaming={false} />);
    const box = screen.getByLabelText('Ask about your documents') as HTMLTextAreaElement;

    fireEvent.change(box, { target: { value: 'What were the margins?' } });
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();

    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onSend).toHaveBeenCalledWith('What were the margins?');
    expect(box.value).toBe('');
  });

  it('does not send whitespace', () => {
    const onSend = vi.fn();
    renderWithTheme(<Composer onSend={onSend} onStop={() => {}} streaming={false} />);
    const box = screen.getByLabelText('Ask about your documents') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: '   ' } });
    expect((screen.getByRole('button', { name: 'Send message' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('replaces Send with Stop while an answer is arriving', () => {
    const onStop = vi.fn();
    renderWithTheme(<Composer onSend={() => {}} onStop={onStop} streaming />);
    expect(screen.queryByRole('button', { name: 'Send message' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Stop generating' }));
    expect(onStop).toHaveBeenCalled();
  });

  it('says why it cannot be used', () => {
    renderWithTheme(
      <Composer onSend={() => {}} onStop={() => {}} streaming={false} disabledReason="Load a chat model first." />,
    );
    expect((screen.getByLabelText('Ask about your documents') as HTMLTextAreaElement).disabled).toBe(true);
    expect(screen.getByText('Load a chat model first.')).toBeTruthy();
  });
});

describe('SourceViewerDialog', () => {
  it('shows the quoted passage with where it came from', () => {
    const citation = makeCitation({ page: 7, chunkIndex: 14, similarity: 0.82 });
    renderWithTheme(<SourceViewerDialog citation={citation} onClose={() => {}} />);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('annual-report.pdf')).toBeTruthy();
    expect(within(dialog).getByText(/page 7/i)).toBeTruthy();
    expect(within(dialog).getByText(/revenue rose 14%/i)).toBeTruthy();
  });

  it('quotes the passage verbatim and says so', () => {
    renderWithTheme(<SourceViewerDialog citation={makeCitation()} onClose={() => {}} />);
    expect(screen.getByText(/exactly as stored/i)).toBeTruthy();
  });

  it('closes on request', () => {
    const onClose = vi.fn();
    renderWithTheme(<SourceViewerDialog citation={makeCitation()} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('renders nothing when there is no source to show', () => {
    renderWithTheme(<SourceViewerDialog citation={null} onClose={() => {}} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('ChatContainer', () => {
  const controller = (over: Partial<ChatController> = {}): ChatController => ({
    conversations: [{ id: 'c1', title: 'First', createdAt: 0, updatedAt: 0, messageCount: 2 }],
    conversationId: 'c1',
    messages: [
      makeMessage({ role: 'user', content: 'How did revenue change?' }),
      makeMessage({ content: 'Revenue rose 14% [1].' }),
    ],
    streamingId: null,
    lastTokensPerSecond: null,
    error: null,
    send: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
    createConversation: vi.fn().mockResolvedValue(undefined),
    selectConversation: vi.fn().mockResolvedValue(undefined),
    deleteConversation: vi.fn().mockResolvedValue(undefined),
    ...over,
  });

  it('passes a question to the controller and clears the box', async () => {
    const chat = controller();
    renderWithTheme(<ChatContainer chat={chat} engineReady disabledReason={null} activeDocuments={2} />);
    const box = screen.getByLabelText('Ask about your documents') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'And margins?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(chat.send).toHaveBeenCalledWith('And margins?');
    expect(box.value).toBe('');
    await Promise.resolve();
  });

  it('opens the source behind a citation in the answer', () => {
    const chat = controller();
    renderWithTheme(<ChatContainer chat={chat} engineReady disabledReason={null} activeDocuments={2} />);
    fireEvent.click(screen.getAllByRole('button', { name: /source 1/i })[0]!);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/revenue rose 14%/i)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('tells the user how many documents are in scope', () => {
    renderWithTheme(<ChatContainer chat={controller()} engineReady disabledReason={null} activeDocuments={3} />);
    expect(screen.getByText(/3 documents/i)).toBeTruthy();
  });

  it('keeps the transcript visible but the question box locked until the engine is ready', () => {
    renderWithTheme(
      <ChatContainer
        chat={controller()}
        engineReady={false}
        disabledReason="Download the chat model to start asking."
        activeDocuments={0}
      />,
    );
    const box = screen.getByLabelText('Ask about your documents') as HTMLTextAreaElement;
    expect(box.disabled).toBe(true);
    expect(screen.getByText('Download the chat model to start asking.')).toBeTruthy();
    expect(screen.getAllByText(/revenue rose 14%/i).length).toBeGreaterThan(0);
  });

  it('surfaces a failure reported by the backend', () => {
    renderWithTheme(
      <ChatContainer
        chat={controller({ error: 'Embedding model is not loaded' })}
        engineReady
        disabledReason={null}
        activeDocuments={1}
      />,
    );
    expect(screen.getByRole('alert').textContent).toContain('Embedding model is not loaded');
  });

  it('asks the controller for a new conversation', () => {
    const chat = controller();
    renderWithTheme(<ChatContainer chat={chat} engineReady disabledReason={null} activeDocuments={1} />);
    fireEvent.click(screen.getByRole('button', { name: /new conversation/i }));
    expect(chat.createConversation).toHaveBeenCalled();
  });
});
