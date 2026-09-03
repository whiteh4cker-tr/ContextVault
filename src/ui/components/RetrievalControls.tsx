import Button from '@mui/material/Button';
import Box from '@mui/material/Box';
import Slider from '@mui/material/Slider';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import type { ChunkingSettings, RetrievalSettings } from '../../shared/types';

interface Props {
  retrieval: RetrievalSettings;
  chunking: ChunkingSettings;
  disabled?: boolean;
  onTopK(topK: number): void;
  onFloor(floor: number): void;
  onChunking(settings: ChunkingSettings): void;
}

const marks = (values: number[]) => values.map((value) => ({ value, label: String(value) }));

/**
 * How much context retrieval hands to the model, and how the corpus was cut up.
 *
 * More passages is not automatically better: each one spends tokens the answer
 * could have used, and a weak hit is worse than no hit because the model will
 * happily prose around it. The floor is here for that reason, and the chunk size
 * lives beside it because changing it invalidates the embeddings.
 */
export function RetrievalControls({ retrieval, chunking, disabled = false, onTopK, onFloor, onChunking }: Props) {
  const [draft, setDraft] = useState<ChunkingSettings>(chunking);
  const dirty = draft.chunkSize !== chunking.chunkSize || draft.chunkOverlap !== chunking.chunkOverlap;
  const invalid =
    draft.chunkSize < 200 || draft.chunkSize > 8000 || draft.chunkOverlap < 0 || draft.chunkOverlap >= draft.chunkSize;

  return (
    <Stack spacing={2}>
      <Box>
        <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
          <Typography variant="body2">Passages per question</Typography>
          <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
            top {retrieval.topK}
          </Typography>
        </Stack>
        <Slider
          aria-label="Passages retrieved per question"
          marks={marks([1, 4, 8, 12])}
          step={1}
          min={1}
          max={12}
          value={retrieval.topK}
          disabled={disabled}
          onChange={(_event, next) => onTopK(Array.isArray(next) ? next[0]! : next)}
          valueLabelDisplay="auto"
        />
      </Box>

      <Box>
        <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
          <Typography variant="body2">Minimum similarity</Typography>
          <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
            {Math.round(retrieval.floor * 100)}%
          </Typography>
        </Stack>
        <Slider
          aria-label="Minimum similarity for a citation"
          marks={marks([0, 25, 50, 75]) /* labels are percentages, see below */}
          step={5}
          min={0}
          max={75}
          value={Math.round(retrieval.floor * 100)}
          disabled={disabled}
          onChange={(_event, next) => onFloor((Array.isArray(next) ? next[0]! : next) / 100)}
          getAriaValueText={(v) => `${v} percent`}
          valueLabelDisplay="auto"
          valueLabelFormat={(v) => `${v}%`}
        />
        <Typography variant="caption" color="text.secondary">
          Anything below this is dropped, and a question with no qualifying passage is answered as
          unanswered.
        </Typography>
      </Box>

      <Box>
        <Typography variant="body2">Chunking</Typography>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start', mt: 1 }}>
          <TextField
            type="number"
            size="small"
            label="Chunk size"
            value={draft.chunkSize}
            disabled={disabled}
            onChange={(event) => setDraft({ ...draft, chunkSize: Number(event.target.value) })}
            slotProps={{ htmlInput: { min: 200, max: 8000, step: 50 } }}
            error={invalid}
          />
          <TextField
            type="number"
            size="small"
            label="Overlap"
            value={draft.chunkOverlap}
            disabled={disabled}
            onChange={(event) => setDraft({ ...draft, chunkOverlap: Number(event.target.value) })}
            slotProps={{ htmlInput: { min: 0, step: 10 } }}
            error={invalid}
          />
          <Button
            variant="outlined"
            disabled={disabled || invalid || !dirty}
            onClick={() => onChunking(draft)}
            aria-label="Apply chunking settings"
          >
            Apply
          </Button>
        </Stack>
        <Typography variant="caption" color="text.secondary">
          Applying re-embeds every document: vectors from two chunk sizes are not comparable.
        </Typography>
      </Box>
    </Stack>
  );
}
