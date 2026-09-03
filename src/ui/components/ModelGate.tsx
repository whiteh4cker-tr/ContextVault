import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { DownloadProgress } from './DownloadProgress';
import { formatBytes } from '../../shared/budget';
import type { ModelsController } from '../state/useModels';
import type { ModelCatalogEntry, ModelRole } from '../../shared/types';

interface Props {
  open: boolean;
  models: ModelsController;
}

const ROLE_COPY: Record<ModelRole, { title: string; why: string }> = {
  chat: {
    title: 'Chat model',
    why: 'Reads the passages and writes the answer. This is the one that needs the memory.',
  },
  embedding: {
    title: 'Embedding model',
    why: 'Turns your documents into vectors so the right passages can be found.',
  },
};

function pickFor(models: ModelsController, role: ModelRole): ModelCatalogEntry | undefined {
  const forRole = models.catalog.filter((entry) => entry.role === role);
  return forRole.find((entry) => entry.recommended) ?? forRole[0];
}

/**
 * The first-run gate: no model on disk, nothing to ask.
 *
 * It is an overlay rather than a replacement for the window, so the corpus and
 * the transcript stay behind it — the work someone did before a model changed is
 * still there when the download finishes.
 *
 * This screen is also the only place in the application that offers to reach the
 * network, and it does nothing until a button is pressed.
 */
export function ModelGate({ open, models }: Props) {
  if (!open) return null;

  return (
    <Box
      role="dialog"
      aria-modal="true"
      aria-labelledby="model-gate-title"
      sx={{
        position: 'fixed',
        inset: 0,
        zIndex: 'modal',
        bgcolor: 'rgba(0, 0, 0, 0.62)',
        display: 'grid',
        placeItems: 'center',
        p: 3,
      }}
    >
      <Paper variant="outlined" sx={{ maxWidth: 620, width: '100%', p: 3 }}>
        <Typography variant="h5" id="model-gate-title" sx={{ mb: 1 }}>
          Put a model on disk to begin
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          ContextVault answers from files on this machine. Downloading is the only time it reaches the network, and
          it happens only when you press the button. If you would rather fetch the file yourself, save the{' '}
          <code>.gguf</code> anywhere and register it under Engine → Already on this machine.
        </Typography>

        <Stack spacing={2}>
          {(['chat', 'embedding'] as ModelRole[]).map((role) => {
            const entry = pickFor(models, role);
            const installedFile = role === 'chat' ? models.status?.chat.fileName : models.status?.embedding.fileName;
            const state = role === 'chat' ? models.status?.chat.state : models.status?.embedding.state;

            return (
              <Stack key={role} spacing={1} sx={{ gap: 1 }}>
                <Typography variant="subtitle2">{ROLE_COPY[role].title}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {entry ? `${entry.label} · ${formatBytes(entry.sizeBytes)}` : 'No catalog entry for this role.'}
                  {` — ${ROLE_COPY[role].why}`}
                </Typography>

                {installedFile ? (
                  <Typography variant="body2">
                    {state === 'ready' ? `Ready: ${installedFile}` : `On disk: ${installedFile}`}
                  </Typography>
                ) : entry ? (
                  <Stack direction="row" sx={{ gap: 1 }}>
                    <Button
                      variant="contained"
                      onClick={() => void models.downloadEntry(role, { fileName: entry.fileName, url: entry.url })}
                    >
                      Download {entry.label} ({formatBytes(entry.sizeBytes)})
                    </Button>
                  </Stack>
                ) : null}
              </Stack>
            );
          })}

          <DownloadProgress download={models.download} onCancel={() => void models.cancel('chat')} />

          {models.error ? (
            <Typography variant="caption" color="error" role="alert">
              {models.error}
            </Typography>
          ) : null}
        </Stack>
      </Paper>
    </Box>
  );
}
