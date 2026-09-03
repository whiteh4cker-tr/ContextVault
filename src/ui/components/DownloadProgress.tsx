import Button from '@mui/material/Button';
import LinearProgress from '@mui/material/LinearProgress';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { formatBytes } from '../../shared/budget';
import type { DownloadState } from '../state/useModels';

interface Props {
  download: DownloadState | null;
  onCancel(): void;
}

/** Byte-progress for a model download, with a cancel that actually cancels. */
export function DownloadProgress({ download, onCancel }: Props) {
  if (!download) return null;
  const knownTotal = download.total > 0;
  return (
    <Stack spacing={0.75} role="status" aria-label={`Downloading ${download.fileName}`}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Typography variant="caption" sx={{ wordBreak: 'break-all' }}>
          Downloading {download.fileName}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
          {knownTotal
            ? `${formatBytes(download.transferred)} / ${formatBytes(download.total)} · ${download.percent}%`
            : formatBytes(download.transferred)}
        </Typography>
      </Stack>
      <LinearProgress
        variant={knownTotal ? 'determinate' : 'indeterminate'}
        value={knownTotal ? download.percent : undefined}
        aria-label={`Downloading ${download.fileName}`}
        aria-valuenow={knownTotal ? download.percent : undefined}
      />
      <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
        <Button size="small" color="inherit" onClick={onCancel}>
          Cancel
        </Button>
      </Stack>
    </Stack>
  );
}
