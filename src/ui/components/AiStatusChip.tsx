import CheckCircle from '@mui/icons-material/CheckCircle';
import CircularProgress from '@mui/material/CircularProgress';
import Chip from '@mui/material/Chip';
import { PHASE_LABEL, PHASE_TONE } from '../state/llmState';
import type { LLMState } from '../../shared/types';

interface Props {
  state: LLMState;
}

const BUSY = new Set(['streaming', 'loading-model', 'retrieving', 'indexing']);

/**
 * What the engine is doing right now.
 *
 * Colour carries it, but never colour alone: the same state is written as a word
 * beside the dot, so the phase survives greyscale, colour-blindness and a screen
 * reader reading the toolbar aloud.
 */
export function AiStatusChip({ state }: Props) {
  const busy = BUSY.has(state.phase);

  return (
    <Chip
      size="small"
      color={PHASE_TONE[state.phase]}
      variant={state.phase === 'error' ? 'filled' : 'outlined'}
      aria-label={`Engine status: ${PHASE_LABEL[state.phase]}`}
      icon={
        busy ? (
          <CircularProgress size={12} thickness={5} color="inherit" />
        ) : state.phase === 'idle' ? (
          <CheckCircle sx={{ fontSize: 15 }} />
        ) : undefined
      }
      label={PHASE_LABEL[state.phase]}
    />
  );
}
