import AlertTitle from '@mui/material/AlertTitle';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import { Composer } from './Composer';
import { ConversationBar } from './ConversationBar';
import { MessageList } from './MessageList';
import { SourceViewerDialog } from './SourceViewerDialog';
import { useState } from 'react';
import type { ChatController } from '../state/useChat';
import type { Citation } from '../../shared/types';

interface Props {
  chat: ChatController;
  engineReady: boolean;
  /** Why questions cannot be asked yet. Null when they can. */
  disabledReason: string | null;
  activeDocuments: number;
}

/**
 * The chat pane: transcript, question box, and the source viewer they share.
 *
 * The transcript stays mounted while the engine is unavailable. Hiding the
 * conversation because a model is not loaded would destroy the record of what
 * was asked, and the record is the part the user cannot recreate.
 */
export function ChatContainer({ chat, engineReady, disabledReason, activeDocuments }: Props) {
  const [source, setSource] = useState<Citation | null>(null);

  return (
    <Stack sx={{ flex: 1, minHeight: 0 }}>
      <ConversationBar
        conversations={chat.conversations}
        conversationId={chat.conversationId}
        messageCount={chat.messages.length}
        activeDocuments={activeDocuments}
        engineReady={engineReady}
        onSelect={(id) => void chat.selectConversation(id)}
        onCreate={() => void chat.createConversation()}
      />

      {chat.error ? (
        <Box sx={{ px: 2, pt: 1.5 }}>
          <Alert severity="error" onClose={() => undefined}>
            <AlertTitle>The last turn did not finish</AlertTitle>
            {chat.error}
          </Alert>
        </Box>
      ) : null}

      <MessageList messages={chat.messages} streamingId={chat.streamingId} onCitation={setSource} />

      <Composer
        onSend={(text) => void chat.send(text)}
        onStop={chat.stop}
        streaming={chat.streamingId !== null}
        disabledReason={disabledReason}
      />

      <SourceViewerDialog citation={source} onClose={() => setSource(null)} />
    </Stack>
  );
}
