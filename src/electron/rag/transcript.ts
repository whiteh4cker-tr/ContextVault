import fs from 'node:fs/promises';
import path from 'node:path';
import type { Conversation, Message } from '../../shared/types.js';

/**
 * The transcript, kept on disk.
 *
 * Conversations survive a restart because someone may have spent an afternoon
 * going through a contract and closed the window at the end of it. The message
 * text is what was actually said and answered, citations included — the record is
 * the useful part, not the model's memory of it.
 *
 * Written atomically, for the same reason the registry is: this file holds the
 * only copy of those conversations.
 */
export class TranscriptStore {
  private conversations: Conversation[] = [];
  private messages = new Map<string, Message[]>();
  private loaded = false;

  private readonly file: string;

  constructor(file: string) {
    this.file = file;
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = await fs.readFile(this.file, 'utf8');
      const parsed = JSON.parse(raw) as {
        conversations?: Conversation[];
        messages?: Record<string, Message[]>;
      };
      this.conversations = Array.isArray(parsed.conversations) ? parsed.conversations : [];
      this.messages = new Map(Object.entries(parsed.messages ?? {}));
    } catch {
      this.conversations = [];
      this.messages = new Map();
    }
  }

  listConversations(): Conversation[] {
    return [...this.conversations].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async create(now = Date.now()): Promise<Conversation> {
    await this.load();
    const conversation: Conversation = {
      id: globalThis.crypto.randomUUID(),
      title: `Conversation ${this.conversations.length + 1}`,
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
    };
    this.conversations.push(conversation);
    this.messages.set(conversation.id, []);
    await this.flush();
    return conversation;
  }

  async remove(id: string): Promise<Conversation[]> {
    await this.load();
    this.conversations = this.conversations.filter((conversation) => conversation.id !== id);
    this.messages.delete(id);
    await this.flush();
    return this.listConversations();
  }

  async rename(id: string, title: string): Promise<Conversation[]> {
    await this.load();
    this.conversations = this.conversations.map((conversation) =>
      conversation.id === id ? { ...conversation, title } : conversation,
    );
    await this.flush();
    return this.listConversations();
  }

  async messagesFor(conversationId: string): Promise<Message[]> {
    await this.load();
    return [...(this.messages.get(conversationId) ?? [])];
  }

  async append(message: Message): Promise<Message> {
    await this.load();
    const list = this.messages.get(message.conversationId) ?? [];
    const existing = list.findIndex((entry) => entry.id === message.id);
    if (existing === -1) list.push(message);
    else list[existing] = message;
    this.messages.set(message.conversationId, list);

    this.conversations = this.conversations.map((conversation) =>
      conversation.id === message.conversationId
        ? {
            ...conversation,
            updatedAt: Date.now(),
            messageCount: list.length,
            // The first question becomes the title, which is how a person finds an
            // old conversation again.
            title:
              conversation.title.startsWith('Conversation ') && message.role === 'user'
                ? titleFrom(message.content)
                : conversation.title,
          }
        : conversation,
    );

    await this.flush();
    return message;
  }

  private async flush(): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.tmp`;
    const payload = {
      version: 1,
      conversations: this.conversations,
      messages: Object.fromEntries(this.messages),
    };
    await fs.writeFile(temp, JSON.stringify(payload), 'utf8');
    await fs.rename(temp, this.file);
  }
}

/** First line, shortened. A title that says "terminate the suppl…" is findable. */
function titleFrom(question: string): string {
  const line = question.trim().split('\n')[0] ?? question;
  return line.length <= 60 ? line : `${line.slice(0, 57)}…`;
}
