import { useCallback, useEffect, useRef, useState } from 'react';
import { api as defaultApi } from '../api';
import type { IpcApi } from '../../shared/ipc';
import type { ChatChunkEvent, Conversation, Message } from '../../shared/types';

const newRequestId = (): string => globalThis.crypto.randomUUID();

export interface ChatController {
  conversations: Conversation[];
  conversationId: string | null;
  messages: Message[];
  /** Id of the assistant message currently receiving chunks. */
  streamingId: string | null;
  /** Tokens per second of the turn that just finished. */
  lastTokensPerSecond: number | null;
  error: string | null;
  send(text: string): Promise<void>;
  stop(): void;
  createConversation(): Promise<void>;
  selectConversation(id: string): Promise<void>;
  deleteConversation(id: string): Promise<void>;
}

/**
 * Transcript state driven by streamed chunks.
 *
 * Chunks are applied by message id rather than "to the last message", so a late
 * event from a cancelled turn cannot append into a newer conversation. The turn
 * only stops being *streaming* on a `done` event or a rejection — a stop that
 * never produced one would otherwise leave the send button showing a spinner
 * forever.
 */
export function useChat(api: IpcApi = defaultApi): ChatController {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [lastTokensPerSecond, setLastTokensPerSecond] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activeRequest = useRef<string | null>(null);

  const loadConversation = useCallback(
    async (id: string) => {
      setConversationId(id);
      setMessages(await api.loadMessages({ conversationId: id }));
    },
    [api],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let list = await api.listConversations();
      if (list.length === 0) {
        const created = await api.createConversation();
        list = [created];
      }
      if (cancelled) return;
      setConversations(list);
      const first = list[0];
      if (first) await loadConversation(first.id);
    })();
    return () => {
      cancelled = true;
    };
  }, [api, loadConversation]);

  const applyChunk = useCallback((event: ChatChunkEvent) => {
    setMessages((prev) => {
      const index = prev.findIndex((m) => m.id === event.messageId);
      if (index === -1) {
        // First chunk of a turn we have not seen yet: open the bubble.
        const opened: Message = {
          id: event.messageId,
          conversationId: event.conversationId,
          role: 'assistant',
          content: event.text,
          citations: event.citations ?? [],
          provenance: event.provenance ?? 'cited',
          createdAt: Date.now(),
          done: event.done,
          tokenCount: event.tokenCount,
          tokensPerSecond: event.tokensPerSecond,
          error: event.error,
        };
        return [...prev, opened];
      }
      const existing = prev[index]!;
      const updated: Message = {
        ...existing,
        content: event.done ? (existing.content || event.text) : existing.content + event.text,
        done: event.done ? true : existing.done,
        citations: event.citations ?? existing.citations,
        provenance: event.provenance ?? existing.provenance,
        tokenCount: event.tokenCount ?? existing.tokenCount,
        tokensPerSecond: event.tokensPerSecond ?? existing.tokensPerSecond,
        error: event.error ?? existing.error,
      };
      const next = prev.slice();
      next.splice(index, 1, updated);
      return next;
    });
  }, []);

  useEffect(() => {
    const off = api.onChatChunk((event) => {
      if (event.conversationId !== conversationId) return;
      if (!event.done) setStreamingId(event.messageId);
      applyChunk(event);
      if (event.done) {
        setStreamingId(null);
        if (event.tokensPerSecond) setLastTokensPerSecond(event.tokensPerSecond);
      }
    });
    return off;
  }, [api, applyChunk, conversationId]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!conversationId || trimmed.length === 0 || streamingId) return;
      const optimistic: Message = {
        id: newRequestId(),
        conversationId,
        role: 'user',
        content: trimmed,
        citations: [],
        provenance: 'cited',
        createdAt: Date.now(),
        done: true,
      };
      setMessages((prev) => [...prev, optimistic]);
      const requestId = newRequestId();
      activeRequest.current = requestId;
      try {
        await api.send({ conversationId, text: trimmed, requestId });
        // The backend owns the transcript; reload so ids and citations match it.
        setMessages(await api.loadMessages({ conversationId }));
        setConversations(await api.listConversations());
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        activeRequest.current = null;
        setStreamingId(null);
      }
    },
    [api, conversationId, streamingId],
  );

  const stop = useCallback(() => {
    const requestId = activeRequest.current;
    if (requestId) void api.stop({ requestId });
  }, [api]);

  return {
    conversations,
    conversationId,
    messages,
    streamingId,
    lastTokensPerSecond,
    error,
    send,
    stop,
    createConversation: async () => {
      const created = await api.createConversation();
      setConversations((prev) => [...prev, created]);
      await loadConversation(created.id);
    },
    selectConversation: loadConversation,
    deleteConversation: async (id) => {
      const remaining = await api.deleteConversation({ id });
      setConversations(remaining);
      await loadConversation(remaining[0]?.id ?? id);
    },
  };
}
