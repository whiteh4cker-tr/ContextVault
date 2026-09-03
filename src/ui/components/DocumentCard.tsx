import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import CheckBoxIcon from '@mui/icons-material/CheckBox';
import CheckBoxOutlineBlankIcon from '@mui/icons-material/CheckBoxOutlineBlank';
import DeleteIcon from '@mui/icons-material/Delete';
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined';
import PictureAsPdfOutlinedIcon from '@mui/icons-material/PictureAsPdfOutlined';
import { formatBytes, formatGrouped } from '../../shared/budget';
import type { DocumentRecord, RagProgressEvent } from '../../shared/types';
import { IngestStageProgress } from './IngestStageProgress';

interface Props {
  doc: DocumentRecord;
  progress?: RagProgressEvent;
  onSetActive(id: string, active: boolean): void;
  onRemove(id: string): void;
  onReindex(id: string): void;
}

const HEALTH_LABEL: Record<DocumentRecord['status']['state'], string> = {
  queued: 'Queued',
  indexing: 'Indexing',
  ready: 'Indexed',
  failed: 'Failed',
  stale: 'Needs re-index',
};

const HEALTH_TONE: Record<DocumentRecord['status']['state'], 'default' | 'primary' | 'success' | 'error' | 'warning'> =
  {
    queued: 'default',
    indexing: 'warning',
    ready: 'success',
    failed: 'error',
    stale: 'warning',
  };

/**
 * One ingested document: what it is, how far the pipeline got, and the two
 * switches that matter — is it in the answer set, and is it here at all.
 */
export function DocumentCard({ doc, progress, onSetActive, onRemove, onReindex }: Props) {
  const Icon = doc.kind === 'application/pdf' ? PictureAsPdfOutlinedIcon : InsertDriveFileOutlinedIcon;
  const busy = doc.status.state === 'indexing' || doc.status.state === 'queued';

  return (
    <Paper variant="outlined" sx={{ p: 1.5 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
        <Icon fontSize="small" color="action" />
        <Box sx={{ minWidth: 0, flexGrow: 1 }}>
          <Typography variant="body2" noWrap title={doc.name}>
            {doc.name}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            {formatBytes(doc.sizeBytes)} · {doc.pages} page{doc.pages === 1 ? '' : 's'}
            {doc.chunkCount > 0 ? ` · ${formatGrouped(doc.chunkCount)} chunks` : ''}
          </Typography>
        </Box>
        <Stack direction="row" spacing={0.25} sx={{ alignItems: 'center' }}>
          <Tooltip title={doc.active ? 'Exclude from answers' : 'Include in answers'}>
            <span>
              <IconButton
                size="small"
                aria-label={`${doc.active ? 'Exclude' : 'Include'} ${doc.name} ${doc.active ? 'from' : 'in'} answers`}
                aria-pressed={doc.active}
                disabled={doc.status.state !== 'ready'}
                onClick={() => onSetActive(doc.id, !doc.active)}
                color={doc.active ? 'primary' : 'default'}
              >
                {doc.active ? <CheckBoxIcon fontSize="small" /> : <CheckBoxOutlineBlankIcon fontSize="small" />}
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Remove document">
            <span>
              <IconButton
                size="small"
                aria-label={`Remove ${doc.name}`}
                onClick={() => onRemove(doc.id)}
                color="error"
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
      </Stack>

      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mt: 1 }}>
        <Chip
          size="small"
          label={HEALTH_LABEL[doc.status.state]}
          color={HEALTH_TONE[doc.status.state]}
          variant={doc.active ? 'filled' : 'outlined'}
        />
        {!doc.active && doc.status.state === 'ready' ? (
          <Typography variant="caption" color="text.secondary">
            Switched off — not searched
          </Typography>
        ) : null}
      </Stack>

      {busy ? (
        <IngestStageProgress
          stage={progress?.stage ?? doc.status.stage ?? 'queued'}
          ratio={progress?.ratio ?? -1}
          detail={progress?.detail ?? (doc.status.state === 'queued' ? 'Waiting for the embedding engine' : '')}
        />
      ) : null}

      {doc.status.state === 'failed' ? (
        <>
          <Divider sx={{ my: 1 }} />
          <Alert
            severity="error"
            variant="outlined"
            sx={{ py: 0.25 }}
            action={
              <Button size="small" onClick={() => onReindex(doc.id)}>
                Retry
              </Button>
            }
          >
            {doc.status.message ?? 'Indexing failed.'}
          </Alert>
        </>
      ) : null}

      {doc.status.state === 'stale' ? (
        <>
          <Divider sx={{ my: 1 }} />
          <Alert
            severity="warning"
            variant="outlined"
            sx={{ py: 0.25 }}
            action={
              <Button size="small" onClick={() => onReindex(doc.id)}>
                Re-index
              </Button>
            }
          >
            {doc.status.message ?? 'Embedded with a different model.'}
          </Alert>
        </>
      ) : null}
    </Paper>
  );
}
