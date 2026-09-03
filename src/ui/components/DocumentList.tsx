import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { formatGrouped } from '../../shared/budget';
import type { DocumentRecord, RagProgressEvent } from '../../shared/types';
import { DocumentCard } from './DocumentCard';

interface Props {
  documents: DocumentRecord[];
  progress: Record<string, RagProgressEvent>;
  onSetActive(id: string, active: boolean): void;
  onRemove(id: string): void;
  onReindex(id: string): void;
}

/** The indexed corpus, with a one-line summary of what retrieval will see. */
export function DocumentList({ documents, progress, onSetActive, onRemove, onReindex }: Props) {
  const active = documents.filter((d) => d.active && d.status.state === 'ready');
  const chunks = documents.reduce((total, d) => total + d.chunkCount, 0);

  return (
    <Stack spacing={1} component="section" aria-label="Indexed documents">
      <Typography variant="overline" color="text.secondary">
        Documents
      </Typography>

      {documents.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Nothing indexed yet. Drop a file above to start.
        </Typography>
      ) : (
        <Typography variant="caption" color="text.secondary">
          {active.length} of {documents.length} in answers · {formatGrouped(chunks)} chunks
        </Typography>
      )}

      {documents.map((doc) => (
        <DocumentCard
          key={doc.id}
          doc={doc}
          progress={progress[doc.id]}
          onSetActive={onSetActive}
          onRemove={onRemove}
          onReindex={onReindex}
        />
      ))}
    </Stack>
  );
}
