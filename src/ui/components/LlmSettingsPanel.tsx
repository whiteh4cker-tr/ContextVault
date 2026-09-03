import Accordion from '@mui/material/Accordion';
import AccordionDetails from '@mui/material/AccordionDetails';
import AccordionSummary from '@mui/material/AccordionSummary';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { ContextSizeField } from './ContextSizeField';
import { DownloadProgress } from './DownloadProgress';
import { GgufSelect } from './GgufSelect';
import { RetrievalControls } from './RetrievalControls';
import type { ModelsController } from '../state/useModels';
import type { SettingsController } from '../state/useSettings';
import type { ModelRole } from '../../shared/types';

interface Props {
  models: ModelsController;
  settings: SettingsController;
  /** Ingestion is running; changing a model would invalidate it mid-flight. */
  busy?: boolean;
}

/**
 * The engine controls: which GGUF answers, which GGUF embeds, how much context
 * the answer may use, and how retrieval selects passages.
 *
 * Everything here is opt-in and closed by default — the sidebar's job is the
 * corpus, and the engine is only opened when something needs changing.
 */
export function LlmSettingsPanel({ models, settings, busy = false }: Props) {
  const status = models.status;

  const modelSection = (role: ModelRole, title: string, caption: string) => (
    <GgufSelect
      role={role}
      title={title}
      caption={caption}
      installed={models.installed}
      catalog={models.catalog}
      active={role === 'chat' ? status?.chat.fileName : status?.embedding.fileName}
      disabled={busy}
      onSelect={(fileName) => void models.select(role, fileName)}
      onDownload={(entry) => void models.downloadEntry(role, { fileName: entry.fileName, url: entry.url })}
      onImport={(path) => void models.importFile(role, path)}
      onDelete={(fileName) => void models.remove(role, fileName)}
    />
  );

  return (
    <Stack spacing={0.5}>
      <Typography variant="overline" color="text.secondary">
        Engine
      </Typography>

      <Accordion disableGutters elevation={0}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />} aria-label="Model files">
          <Typography variant="subtitle2">Models</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Stack spacing={2}>
            {modelSection('chat', 'Chat model', 'Writes the answers. Larger models read better and stream slower.')}
            <Divider />
            {modelSection(
              'embedding',
              'Embedding model',
              'Turns text into vectors. Changing it re-embeds the whole corpus.',
            )}
            <DownloadProgress download={models.download} onCancel={() => void models.cancel('chat')} />
            {models.error ? (
              <Typography variant="caption" color="error" role="alert">
                {models.error}
              </Typography>
            ) : null}
          </Stack>
        </AccordionDetails>
      </Accordion>

      <Accordion disableGutters elevation={0}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />} aria-label="Context budget">
          <Typography variant="subtitle2">Context budget</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <ContextSizeField
            bounds={models.bounds}
            value={status?.contextSize ?? 0}
            onChange={(contextSize) => void models.applyContextSize(contextSize)}
            disabled={busy}
          />
        </AccordionDetails>
      </Accordion>

      <Accordion disableGutters elevation={0}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />} aria-label="Retrieval settings">
          <Typography variant="subtitle2">Retrieval</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <RetrievalControls
            retrieval={settings.retrieval}
            chunking={settings.chunking}
            disabled={busy}
            onTopK={(topK) => void settings.setTopK(topK)}
            onFloor={(floor) => void settings.setFloor(floor)}
            onChunking={(chunking) => void settings.setChunking(chunking)}
          />
        </AccordionDetails>
      </Accordion>
    </Stack>
  );
}
