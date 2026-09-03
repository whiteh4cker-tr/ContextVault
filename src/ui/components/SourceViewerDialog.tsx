import ContentCopy from '@mui/icons-material/ContentCopy';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { confidenceLabel } from '../../shared/budget';
import type { Citation } from '../../shared/types';

interface Props {
  citation: Citation | null;
  onClose(): void;
}

/**
 * The passage behind a citation.
 *
 * This is the point of the application: the claim and the text it came from, on
 * screen together, with the page number. The passage is shown exactly as it was
 * stored — no summarising, no tidying — so a disagreement with the answer can be
 * settled against the source rather than against the model's recollection of it.
 */
export function SourceViewerDialog({ citation, onClose }: Props) {
  const [copied, setCopied] = useState(false);
  if (!citation) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(citation.snippet);
      setCopied(true);
    } catch {
      // Clipboard access can be refused. The passage is on screen either way.
      setCopied(false);
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pb: 0.5 }}>{citation.documentName}</DialogTitle>
      <Typography variant="body2" color="text.secondary" sx={{ px: 3 }}>
        Page {citation.page} · chunk {citation.chunkIndex} · {Math.round(citation.similarity * 100)}% match (
        {confidenceLabel(citation.similarity)})
      </Typography>
      <Divider sx={{ mt: 1.5 }} />
      <DialogContent>
        <Typography variant="overline" color="text.secondary">
          Quoted exactly as stored, from your index
        </Typography>
        <Stack
          component="blockquote"
          sx={{
            m: 0,
            mt: 0.5,
            p: 1.5,
            borderLeft: 3,
            borderColor: 'primary.main',
            bgcolor: 'background.default',
            whiteSpace: 'pre-wrap',
            color: 'text.primary',
          }}
        >
          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
            {citation.snippet}
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button startIcon={<ContentCopy />} onClick={() => void copy()}>
          {copied ? 'Copied' : 'Copy passage'}
        </Button>
        <Button variant="contained" onClick={onClose}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}
