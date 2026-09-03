import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { MessageBubble } from './MessageBubble';
import { useEffect, useRef } from 'react';
import type { Citation, Message } from '../../shared/types';

interface Props {
  messages: Message[];
  streamingId: string | null;
  onCitation(citation: Citation): void;
}

/**
 * The transcript, kept scrolled to the newest line.
 *
 * `role="log"` with a polite live region is what a screen reader needs for a
 * streaming answer: new text is announced as it settles rather than on every
 * token, and the reader keeps their place in the rest of the page.
 */
export function MessageList({ messages, streamingId, onCitation }: Props) {
  const bottom = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = bottom.current;
    // Guarded because not every host implements it (jsdom does not), and a
    // transcript that fails to scroll should not take the render down with it.
    if (typeof el?.scrollIntoView === 'function') el.scrollIntoView({ block: 'end' });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <Box
        role="log"
        aria-live="polite"
        aria-label="Conversation"
        sx={{
          flex: 1,
          display: 'grid',
          placeItems: 'center',
          px: 4,
          textAlign: 'center',
        }}
      >
        <Typography color="text.secondary">
          Drop a document on the left, then ask something about it. Answers arrive with the passage they came
          from, so you can check the work.
        </Typography>
      </Box>
    );
  }

  return (
    <Box
      role="log"
      aria-live="polite"
      aria-label="Conversation"
      sx={{ flex: 1, overflowY: 'auto', px: 2, py: 2 }}
    >
      <Stack spacing={1.5} sx={{ alignItems: 'stretch' }}>
        {messages.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            streaming={message.id === streamingId}
            onCitation={onCitation}
          />
        ))}
      </Stack>
      <div ref={bottom} />
    </Box>
  );
}
