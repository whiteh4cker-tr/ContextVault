/**
 * @vitest-environment jsdom
 */
import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createFakeBackend } from '../mock/fakeBackend';
import { flushReact, pollUntil } from '../test/poll';
import { useChat } from './useChat';

async function readyBackend(tokenDelayMs: number) {
  const backend = createFakeBackend({ stageDelayMs: 1, tokenDelayMs });
  await backend.addDocuments({ paths: ['C:/fake/contract.pdf'] });
  await pollUntil(async () => {
    expect((await backend.listDocuments())[0]?.status.state).toBe('ready');
  });
  return backend;
}

describe('useChat', () => {
  it('opens a conversation on mount', async () => {
    const backend = createFakeBackend();
    const { result } = renderHook(() => useChat(backend));
    const [first] = await backend.listConversations();
    await pollUntil(() => expect(result.current.conversationId).toBe(first?.id));
  });

  it('appends streamed chunks to one assistant message and clears the flag at the end', async () => {
    const backend = await readyBackend(4);
    const { result } = renderHook(() => useChat(backend));
    await pollUntil(() => expect(result.current.conversationId).not.toBeNull());

    const sending = result.current.send('What is the term?');
    await pollUntil(() => expect(result.current.streamingId).not.toBeNull());
    expect(result.current.messages.at(-1)?.done).toBe(false);

    await flushReact(() => sending);

    const assistant = result.current.messages.at(-1);
    expect(assistant?.role).toBe('assistant');
    expect(assistant?.content.length).toBeGreaterThan(0);
    expect(assistant?.done).toBe(true);
    expect(assistant?.citations.length).toBeGreaterThan(0);
    expect(result.current.streamingId).toBeNull();
    expect(result.current.lastTokensPerSecond).toBeGreaterThan(0);
  });

  it('shows the user turn immediately, before the answer starts', async () => {
    const backend = await readyBackend(4);
    const { result } = renderHook(() => useChat(backend));
    await pollUntil(() => expect(result.current.conversationId).not.toBeNull());

    const sending = result.current.send('Is there an indemnity clause?');
    await pollUntil(() => expect(result.current.messages[0]?.role).toBe('user'));
    expect(result.current.messages[0]?.content).toBe('Is there an indemnity clause?');
    expect(result.current.messages[0]?.done).toBe(true);
    await flushReact(() => sending);
  });

  it('ends the turn as aborted when stop is pressed', async () => {
    const backend = await readyBackend(6);
    const { result } = renderHook(() => useChat(backend));
    await pollUntil(() => expect(result.current.conversationId).not.toBeNull());

    const sending = result.current.send('Tell me everything you know about this');
    await pollUntil(() => expect(result.current.streamingId).not.toBeNull());
    result.current.stop();
    await flushReact(() => sending);

    const assistant = result.current.messages.at(-1);
    expect(assistant?.done).toBe(true);
    expect(assistant?.provenance).toBe('aborted');
    expect(result.current.streamingId).toBeNull();
  });

  it('refuses a second send while a turn is streaming, and accepts it afterwards', async () => {
    const backend = await readyBackend(6);
    const { result } = renderHook(() => useChat(backend));
    await pollUntil(() => expect(result.current.conversationId).not.toBeNull());

    const first = result.current.send('First question');
    await pollUntil(() => expect(result.current.streamingId).not.toBeNull());
    await result.current.send('Second question');
    expect(result.current.messages.filter((m) => m.role === 'user')).toHaveLength(1);

    await flushReact(() => first);
    await flushReact(() => result.current.send('Second question'));
    expect(result.current.messages.filter((m) => m.role === 'user')).toHaveLength(2);
  });

  it('creates and switches between conversations', async () => {
    const backend = createFakeBackend({ stageDelayMs: 1 });
    const { result } = renderHook(() => useChat(backend));
    await pollUntil(() => expect(result.current.conversations).toHaveLength(1));

    await flushReact(() => result.current.createConversation());
    await pollUntil(() => expect(result.current.conversations).toHaveLength(2));

    const [firstId, secondId] = result.current.conversations.map((c) => c.id);
    expect(result.current.conversationId).toBe(secondId);

    if (firstId) await flushReact(() => result.current.selectConversation(firstId));
    expect(result.current.conversationId).toBe(firstId);
  });
});
