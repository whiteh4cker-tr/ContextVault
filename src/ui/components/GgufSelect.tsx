import { useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import DeleteForeverIcon from '@mui/icons-material/DeleteForever';
import DownloadIcon from '@mui/icons-material/Download';
import FileOpenIcon from '@mui/icons-material/FileOpen';
import { formatBytes } from '../../shared/budget';
import type { ModelCatalogEntry, ModelFileInfo, ModelRole } from '../../shared/types';

interface Props {
  role: ModelRole;
  /** Human label, e.g. "Chat model". */
  title: string;
  caption: string;
  installed: ModelFileInfo[];
  catalog: ModelCatalogEntry[];
  active?: string;
  disabled?: boolean;
  onSelect(fileName: string): void;
  onDownload(entry: { url: string; fileName: string; sizeBytes: number; label: string; role: ModelRole }): void;
  onImport(path: string): void;
  onDelete(fileName: string): void;
}

/**
 * Pick a GGUF file for one role: choose from what is installed, fetch a catalog
 * entry, paste a direct Hugging Face resolve URL, or point at a file already on
 * disk.
 *
 * A GGUF that was not downloaded here still works — importing only records the
 * path, it never copies gigabytes around.
 */
export function GgufSelect({
  role,
  title,
  caption,
  installed,
  catalog,
  active,
  disabled = false,
  onSelect,
  onDownload,
  onImport,
  onDelete,
}: Props) {
  const [customUrl, setCustomUrl] = useState('');
  const [importPath, setImportPath] = useState('');
  const forRole = installed.filter((m) => m.role === role);
  const catalogForRole = catalog.filter((entry) => entry.role === role);
  const recommended = catalogForRole.find((entry) => entry.recommended) ?? catalogForRole[0];
  const urlIsGguf = /\.gguf(\?.*)?$/i.test(customUrl.trim());

  return (
    <Stack spacing={1.5}>
      <Box>
        <Typography variant="subtitle2">{title}</Typography>
        <Typography variant="caption" color="text.secondary">
          {caption}
        </Typography>
      </Box>

      {forRole.length === 0 ? (
        <Alert severity="warning" variant="outlined">
          No {role} model installed.
          {recommended ? (
            <Button
              size="small"
              startIcon={<DownloadIcon fontSize="small" />}
              onClick={() => onDownload({ ...recommended, role })}
              sx={{ ml: 1 }}
            >
              Download {recommended.label} ({formatBytes(recommended.sizeBytes)})
            </Button>
          ) : null}
        </Alert>
      ) : (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <TextField
            select
            size="small"
            fullWidth
            label={title}
            value={active ?? ''}
            disabled={disabled}
            onChange={(event) => onSelect(event.target.value)}
          >
            {forRole.map((model) => (
              <MenuItem key={model.fileName} value={model.fileName}>
                {model.fileName} — {formatBytes(model.sizeBytes)}
              </MenuItem>
            ))}
          </TextField>
          <Tooltip title={`Delete ${active ?? 'selected model'}`}>
            <span>
              <IconButton
                aria-label={`Delete ${active ?? 'selected'} ${role} model`}
                disabled={disabled || !active}
                onClick={() => active && onDelete(active)}
                color="error"
              >
                <DeleteForeverIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
      )}

      <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
        <TextField
          size="small"
          fullWidth
          label="Custom GGUF URL"
          placeholder="https://huggingface.co/…/resolve/main/model.gguf"
          value={customUrl}
          disabled={disabled}
          onChange={(event) => setCustomUrl(event.target.value)}
          helperText={
            customUrl.length > 0 && !urlIsGguf ? 'The URL must point at a .gguf file.' : 'Direct download link.'
          }
          error={customUrl.length > 0 && !urlIsGguf}
        />
        <Button
          variant="outlined"
          disabled={disabled || !urlIsGguf}
          onClick={() => {
            const url = customUrl.trim();
            const fileName = url.split('?')[0]!.split('/').pop() ?? 'model.gguf';
            onDownload({ url, fileName, sizeBytes: 0, label: fileName, role });
          }}
          startIcon={<DownloadIcon fontSize="small" />}
        >
          Download
        </Button>
      </Stack>

      <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
        <TextField
          size="small"
          fullWidth
          label="Already on this machine"
          placeholder="D:/models/mistral-7b-instruct.Q4_K_M.gguf"
          value={importPath}
          disabled={disabled}
          onChange={(event) => setImportPath(event.target.value)}
          helperText="Registers the file where it is; nothing is copied."
        />
        <Button
          variant="outlined"
          disabled={disabled || importPath.trim().length === 0}
          onClick={() => onImport(importPath.trim())}
          startIcon={<FileOpenIcon fontSize="small" />}
        >
          Use file
        </Button>
      </Stack>
    </Stack>
  );
}
