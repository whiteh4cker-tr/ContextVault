import Memory from '@mui/icons-material/Memory';
import Chip from '@mui/material/Chip';
import { formatTokens } from '../../shared/budget';

interface Props {
  file: string | null;
  contextSize: number;
}

/**
 * Which GGUF is answering, and how much context it was given.
 *
 * Both numbers change the answer: quantisation and model choice change what the
 * model notices, and the context window decides how much of the conversation and
 * the retrieved text it can see at all. Showing them in the title bar keeps that
 * out of the way but never unknown.
 */
export function ModelChip({ file, contextSize }: Props) {
  if (!file) {
    return <Chip size="small" variant="outlined" icon={<Memory />} label="No model" aria-label="No model selected" />;
  }

  return (
    <Chip
      size="small"
      variant="outlined"
      icon={<Memory />}
      onClick={undefined}
      aria-label={`Model ${file}, ${contextSize} tokens of context`}
      label={
        <span>
          {file.replace(/\.gguf$/i, '')}
          {contextSize > 0 ? ` · ${formatTokens(contextSize)} ctx` : ''}
        </span>
      }
      sx={{ maxWidth: 420, '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }}
    />
  );
}
