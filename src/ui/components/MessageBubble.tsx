import Article from '@mui/icons-material/Article';
import Chip from '@mui/material/Chip';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { MarkdownText } from './MarkdownText';
import { confidenceLabel } from '../../shared/budget';
import type { Citation, Message } from '../../shared/types';

interface Props {
  message: Message;
  /** True for the message currently receiving chunks. */
  streaming?: boolean;
  onCitation?(citation: Citation): void;
}

const PROVENANCE_NOTE: Record<string, { label: string; severity: 'info' | 'warning' | 'success' }> = {
  'no-context': { label: 'Nothing above the similarity floor — answered from the model alone', severity: 'warning' },
  unsourced: { label: 'Not grounded: the passages retrieved do not support this answer', severity: 'warning' },
  aborted: { label: 'Stopped by you', severity: 'info' },
  cited: { label: 'Answered from your documents', severity: 'success' },
};

/**
 * One turn of the transcript.
 *
 * The sources are part of the message, not decoration under it: an answer with
 * nothing behind it says so in the same breath as the answer, because an
 * unexplained confident sentence is the failure mode this whole application
 * exists to avoid.
 */
export function MessageBubble({ message, streaming = false, onCitation }: Props) {
  const isUser = message.role === 'user';
  const note = !isUser && message.provenance !== 'error' ? PROVENANCE_NOTE[message.provenance] : undefined;
  const showNote = note !== undefined && (message.provenance !== 'cited' || message.citations.length === 0);

  return (
    <Paper
      variant="outlined"
      elevation={0}
      sx={{
        p: 1.5,
        alignSelf: isUser ? 'flex-end' : 'flex-start',
        maxWidth: isUser ? '72ch' : '86ch',
        bgcolor: isUser ? 'primary.container' : 'background.paper',
        borderColor: isUser ? 'primary.main' : 'divider',
      }}
    >
      <Stack direction="row" sx={{ alignItems: 'center', gap: 0.75, mb: 0.5 }}>
        {isUser ? null : <Article sx={{ fontSize: 16, color: 'text.secondary' }} />}
        <Typography variant="overline" color="text.secondary">
          {isUser ? 'You' : 'ContextVault'}
        </Typography>
      </Stack>

      <MarkdownText
        text={message.content}
        citations={message.citations}
        onCitation={onCitation}
        plain={isUser}
      />

      {message.citations.length > 0 && !isUser ? (
        <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.5, mt: 1 }}>
          {message.citations.map((citation) => (
            <Chip
              key={`${citation.documentId}-${citation.chunkIndex}`}
              size="small"
              variant="outlined"
              icon={<Article sx={{ fontSize: 15 }} />}
              onClick={() => onCitation?.(citation)}
              aria-label={`Source ${citation.index}: ${citation.documentName}, page ${citation.page}`}
              label={`${citation.index} · ${citation.documentName} p.${citation.page} · ${Math.round(
                citation.similarity * 100,
              )}% ${confidenceLabel(citation.similarity)}`}
            />
          ))}
        </Stack>
      ) : null}

      {streaming ? (
        <Typography role="status" variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          Writing…
        </Typography>
      ) : null}

      {showNote && note ? (
        <Typography
          role="status"
          variant="caption"
          sx={{ display: 'block', mt: 1, color: `${note.severity}.main` }}
        >
          {note.label}
        </Typography>
      ) : null}

      {message.provenance === 'error' ? (
        <Typography role="alert" variant="caption" color="error" sx={{ display: 'block', mt: 1 }}>
          {message.error ?? 'The model could not finish this answer.'}
        </Typography>
      ) : null}

      {!isUser && message.done && message.tokensPerSecond ? (
        <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mt: 0.5 }}>
          {message.tokensPerSecond.toFixed(1)} tokens/s
          {message.tokenCount ? ` · ${message.tokenCount} tokens` : ''}
        </Typography>
      ) : null}
    </Paper>
  );
}
