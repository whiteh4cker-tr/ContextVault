import Box from '@mui/material/Box';
import LinearProgress from '@mui/material/LinearProgress';
import Typography from '@mui/material/Typography';
import type { IngestStage } from '../../shared/types';
import { STAGE_LABEL, stagePercent } from './ingestStage';

interface Props {
  stage: IngestStage;
  /** 0..1 within the stage; -1 means the total is unknown. */
  ratio: number;
  detail: string;
}

/**
 * One line of ingestion progress: the stage, a bar, and the counts behind it.
 *
 * An unknown ratio renders an indeterminate bar rather than one parked at zero —
 * a stalled bar reads as a stalled app, and here the difference is real: the
 * engine simply cannot say how many tokens a page will produce.
 */
export function IngestStageProgress({ stage, ratio, detail }: Props) {
  const percent = stagePercent(ratio);

  return (
    <Box sx={{ mt: 1 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 1 }}>
        <Typography variant="caption" color="text.secondary">
          {STAGE_LABEL[stage] ?? stage}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
          {percent === null ? '…' : `${percent}%`}
        </Typography>
      </Box>
      <LinearProgress
        variant={percent === null ? 'indeterminate' : 'determinate'}
        value={percent ?? undefined}
        aria-label={STAGE_LABEL[stage] ?? stage}
        aria-valuenow={percent ?? undefined}
        aria-valuemin={percent === null ? undefined : 0}
        aria-valuemax={percent === null ? undefined : 100}
        sx={{ mt: 0.5 }}
      />
      {detail ? (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
          {detail}
        </Typography>
      ) : null}
    </Box>
  );
}
