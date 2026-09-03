import Send from '@mui/icons-material/Send';
import Stop from '@mui/icons-material/Stop';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useState } from 'react';

interface Props {
  onSend(text: string): void;
  onStop(): void;
  streaming: boolean;
  /** Why the question box is locked, phrased as the next thing to do. */
  disabledReason?: string | null;
}

/**
 * The question box.
 *
 * Enter sends and Shift+Enter makes a newline, which is what a keyboard user
 * expects; the same action is offered as a button for everyone else. While an
 * answer is being written, Send becomes Stop — one control, in the same place,
 * for the one thing you can do at that moment.
 */
export function Composer({ onSend, onStop, streaming, disabledReason = null }: Props) {
  const [text, setText] = useState('');
  const locked = disabledReason !== null;
  const canSend = !locked && !streaming && text.trim().length > 0;

  const submit = () => {
    const trimmed = text.trim();
    if (trimmed.length === 0 || locked || streaming) return;
    setText('');
    onSend(trimmed);
  };

  return (
    <Stack spacing={0.5} sx={{ p: 2, pt: 1, borderTop: '1px solid', borderColor: 'divider' }}>
      <TextField
        multiline
        minRows={2}
        maxRows={8}
        size="small"
        fullWidth
        label="Ask about your documents"
        placeholder="What does the contract say about termination?"
        value={text}
        disabled={locked}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            submit();
          }
        }}
        helperText={
          disabledReason ?? 'Enter to send · Shift+Enter for a new line · answers cite the page they came from'
        }
        slotProps={{ formHelperText: { sx: { color: disabledReason ? 'error.main' : 'text.secondary' } } }}
      />
      <Stack direction="row" sx={{ justifyContent: 'flex-end', gap: 1 }}>
        {streaming ? (
          <Button variant="outlined" color="error" startIcon={<Stop />} onClick={onStop} aria-label="Stop generating">
            Stop
          </Button>
        ) : (
          <Button variant="contained" startIcon={<Send />} disabled={!canSend} onClick={submit} aria-label="Send message">
            Send
          </Button>
        )}
      </Stack>
      {streaming ? (
        <Typography variant="caption" role="status" color="text.secondary">
          Generating an answer locally — nothing has left this machine.
        </Typography>
      ) : null}
    </Stack>
  );
}
