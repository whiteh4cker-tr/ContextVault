import Box from '@mui/material/Box';
import LinearProgress from '@mui/material/LinearProgress';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { formatBytes } from '../../shared/budget';
import type { SystemStats } from '../../shared/types';

interface Props {
  stats: SystemStats | null;
}

/**
 * Memory headroom, as a bar and as numbers.
 *
 * The gauge is not decoration. A local model is the largest thing most users
 * will ever run on a laptop, and the difference between "it works" and "the
 * allocator refused" is a couple of gigabytes. Showing free memory next to the
 * model's own footprint is what makes the context budget comprehensible rather
 * than magical.
 */
export function RamGauge({ stats }: Props) {
  if (!stats || stats.totalBytes === 0) {
    return (
      <Typography variant="caption" color="text.secondary" role="status">
        Memory: reading…
      </Typography>
    );
  }

  const usedPercent = Math.min(100, Math.round((stats.usedBytes / stats.totalBytes) * 100));

  return (
    <Tooltip
      title={`Total ${formatBytes(stats.totalBytes)} · free ${formatBytes(stats.freeBytes)} · model ${formatBytes(
        stats.modelBytes,
      )} · this app ${formatBytes(stats.residentBytes)}${stats.gpuBackend ? ` · ${stats.gpuBackend}` : ''}`}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <LinearProgress
          variant="determinate"
          value={usedPercent}
          color={usedPercent > 90 ? 'error' : usedPercent > 75 ? 'warning' : 'primary'}
          aria-label="Memory in use"
          aria-valuenow={usedPercent}
          aria-valuemin={0}
          aria-valuemax={100}
          sx={{ width: 96, height: 6, borderRadius: 3 }}
        />
        <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
          {formatBytes(stats.freeBytes)} free of {formatBytes(stats.totalBytes)}
        </Typography>
      </Box>
    </Tooltip>
  );
}
