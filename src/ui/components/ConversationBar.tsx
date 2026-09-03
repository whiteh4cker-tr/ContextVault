import Add from '@mui/icons-material/Add';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import type { Conversation } from '../../shared/types';

interface Props {
  conversations: Conversation[];
  conversationId: string | null;
  messageCount: number;
  /** How many documents are currently in the retrieval scope. */
  activeDocuments: number;
  /** False while the corpus is still being indexed. */
  engineReady: boolean;
  onSelect(id: string): void;
  onCreate(): void;
}

/**
 * The strip above the transcript: which conversation this is, what it can see,
 * and how to start another.
 *
 * The counts are here rather than buried in settings because they change what a
 * question can be answered: three documents in scope is a different claim from
 * thirty, and a corpus that is still indexing is not a corpus yet.
 */
export function ConversationBar({
  conversations,
  conversationId,
  messageCount,
  activeDocuments,
  engineReady,
  onSelect,
  onCreate,
}: Props) {
  return (
    <Stack
      direction="row"
      sx={{
        alignItems: 'center',
        gap: 1,
        px: 2,
        py: 1,
        borderBottom: '1px solid',
        borderColor: 'divider',
      }}
    >
      <Select
        size="small"
        value={conversationId ?? ''}
        onChange={(event) => onSelect(event.target.value)}
        aria-label="Conversation"
        sx={{ minWidth: 180 }}
      >
        {conversations.map((conversation) => (
          <MenuItem key={conversation.id} value={conversation.id}>
            {conversation.title}
          </MenuItem>
        ))}
      </Select>

      <Tooltip title="Start a new conversation">
        <IconButton onClick={onCreate} aria-label="Start a new conversation" size="small">
          <Add />
        </IconButton>
      </Tooltip>

      <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
        {activeDocuments} {activeDocuments === 1 ? 'document' : 'documents'} in scope · {messageCount}{' '}
        {messageCount === 1 ? 'message' : 'messages'}
        {engineReady ? '' : ' · indexing'}
      </Typography>
    </Stack>
  );
}
