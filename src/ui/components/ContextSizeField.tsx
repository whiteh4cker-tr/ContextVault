import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { estimateContextBytes, formatBytes, formatGrouped, validateContextSize } from '../../shared/budget';
import type { ContextBounds } from '../../shared/types';

interface Props {
  bounds: ContextBounds | null;
  /** The size the engine is using now. */
  value: number;
  onChange(size: number): void;
  disabled?: boolean;
}

/**
 * The context window, entered as a number.
 *
 * Typing a size is the honest interaction: the number is a budget the user
 * chooses, not a point on a rail. What the measurement still does is judge the
 * number before it is applied — a size the model cannot represent is refused
 * outright, and a size that would not fit in the memory free right now is
 * labelled with what it needs and what is available, but stays applyable. The
 * memory figure is a snapshot; the user may know better than it.
 */
export function ContextSizeField({ bounds, value, onChange, disabled = false }: Props) {
  // null means "show the value the engine reports"; anything else is an edit in
  // progress. Deriving the field this way avoids adopting the prop in an effect.
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? String(value);

  if (!bounds) {
    return (
      <Typography variant="body2" color="text.secondary">
        Measuring the model’s memory requirements…
      </Typography>
    );
  }

  const verdict = validateContextSize(shown, { min: bounds.min, maxModel: bounds.maxModel, maxSafe: bounds.maxSafe });
  const parsed = verdict.ok ? verdict.value : verdict.value === null ? Number.NaN : verdict.value;
  const dirty = verdict.ok && parsed !== value;

  const estimateForShown = Number.isFinite(parsed)
    ? estimateContextBytes(bounds.weightsBytes, bounds.bytesPerToken, parsed)
    : 0;

  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
        <TextField
          // A plain number input would silently swallow "16k" and refuse digit
          // groups; this is a counted quantity the user should be able to paste
          // in the form the app shows it, so the text is validated here instead.
          inputMode="numeric"
          size="small"
          fullWidth
          label="Context size (tokens)"
          value={shown}
          disabled={disabled}
          onChange={(event) => setDraft(event.target.value)}
          error={!verdict.ok && shown.length > 0}
          helperText={
            !verdict.ok && shown.length > 0
              ? verdict.error
              : `Weights ${formatBytes(bounds.weightsBytes)} + ~${formatBytes(
                  Math.max(0, estimateForShown - bounds.weightsBytes),
                )} of KV cache`
          }
          slotProps={{ htmlInput: { inputMode: 'numeric', autoComplete: 'off', spellCheck: false } }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && verdict.ok && dirty && !disabled) {
              event.preventDefault();
              onChange(parsed);
              setDraft(null);
            }
          }}
        />
        <Button
          variant="outlined"
          disabled={disabled || !verdict.ok || !dirty}
          onClick={() => {
            onChange(parsed);
            setDraft(null);
          }}
        >
          Apply
        </Button>
      </Stack>

      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <Button size="small" variant="text" disabled={disabled} onClick={() => onChange(bounds.maxSafe)}>
          Use largest that fits ({formatGrouped(bounds.maxSafe)})
        </Button>
        <Typography variant="caption" color="text.secondary">
          Ceiling from {formatBytes(bounds.freeBytes)} free · model trained to{' '}
          {formatGrouped(bounds.maxModel)}
        </Typography>
      </Stack>

      {verdict.ok && verdict.level === 'over-committed' ? (
        <Alert severity="warning" variant="outlined">
          {formatGrouped(verdict.value)} tokens needs ~{formatBytes(estimateForShown)} but only{' '}
          {formatBytes(bounds.freeBytes)} is free right now, so the model may fail to load.{' '}
          {bounds.reason ?? 'Close other memory-heavy applications, or apply a smaller window.'}
        </Alert>
      ) : null}
    </Stack>
  );
}
