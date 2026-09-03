import { useRef, useState, type DragEvent } from 'react';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import { pathOf } from '../api';

const ACCEPT = ['.pdf', '.txt'];
const ACCEPT_INPUT = '.pdf,.txt,application/pdf,text/plain';

interface Props {
  /** Called with the resolved path (Electron) or name (browser) of each accepted file. */
  onAdd(paths: string[]): void;
  disabled?: boolean;
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot).toLowerCase();
}

/**
 * The ingestion entry point: drag files onto the panel, or click to browse.
 *
 * Both paths are real. The drop target is not the only way in — the same
 * selection is reachable with a keyboard through a hidden file input, because a
 * drag-only affordance is unusable with a switch device or a screen reader.
 */
export function DropZone({ onAdd, disabled = false }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [rejected, setRejected] = useState<string[]>([]);

  function accept(files: Iterable<File>): void {
    const names: string[] = [];
    const refused: string[] = [];
    for (const file of files) {
      if (ACCEPT.includes(extensionOf(file.name))) names.push(pathOf(file));
      else refused.push(file.name);
    }
    setRejected(refused);
    if (names.length > 0) onAdd(names);
  }

  function handleDrop(event: DragEvent<HTMLElement>): void {
    event.preventDefault();
    setDragging(false);
    if (disabled) return;
    const files = event.dataTransfer?.files;
    if (files && files.length > 0) accept(files);
  }

  return (
    <Stack
      component="section"
      aria-label="Add documents"
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      spacing={1}
      sx={{
        border: '2px dashed',
        borderColor: dragging ? 'primary.main' : 'divider',
        backgroundColor: dragging ? 'background.selected' : 'background.paper',
        borderRadius: 2,
        p: 2,
        textAlign: 'center',
        transition: 'border-color 120ms ease, background-color 120ms ease',
      }}
    >
      <UploadFileIcon color={dragging ? 'primary' : 'disabled'} />
      <Typography variant="body2">
        {dragging ? 'Release to index these files' : 'Drag PDFs or plain text here'}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        Nothing leaves this machine. Files are parsed, chunked and embedded locally.
      </Typography>
      <Button
        variant="outlined"
        size="small"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        startIcon={<UploadFileIcon fontSize="small" />}
      >
        Choose files
      </Button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT_INPUT}
        hidden
        aria-label="Choose documents to index"
        onChange={(event) => {
          const files = event.target.files;
          if (files && files.length > 0) accept(files);
          event.target.value = '';
        }}
      />
      {rejected.length > 0 ? (
        <Typography variant="caption" color="error" role="alert">
          Unsupported file{rejected.length === 1 ? '' : 's'}: {rejected.join(', ')} — only PDF and TXT are
          indexed.
        </Typography>
      ) : null}
    </Stack>
  );
}
