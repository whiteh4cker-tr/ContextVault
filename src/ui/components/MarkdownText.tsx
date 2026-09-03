import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import { Fragment } from 'react';
import { parseMarkdown } from '../render/markdown';
import type { Block, Inline } from '../render/markdown';
import type { Citation } from '../../shared/types';

interface Props {
  text: string;
  /** The passages the answer cites; a marker with no entry stays plain text. */
  citations?: Citation[];
  onCitation?(citation: Citation): void;
  /** Render model text as written. Used for the user's own question. */
  plain?: boolean;
}

const HEADING_VARIANTS = ['h5', 'h6', 'subtitle1', 'subtitle2', 'subtitle2', 'subtitle2'] as const;

function CitationMarker({
  index,
  citation,
  onCitation,
}: {
  index: number;
  citation: Citation | undefined;
  onCitation?: (citation: Citation) => void;
}) {
  if (!citation) return <>{`[${index}]`}</>;
  return (
    <Chip
      size="small"
      label={`[${index}]`}
      color="primary"
      onClick={() => onCitation?.(citation)}
      aria-label={`Source ${index}: ${citation.documentName}, page ${citation.page}`}
      sx={{ mx: 0.25, verticalAlign: 'baseline', fontFamily: 'ui-monospace, monospace' }}
    />
  );
}

function InlineRun({
  inline,
  citations,
  onCitation,
}: {
  inline: Inline;
  citations: Citation[];
  onCitation?: (citation: Citation) => void;
}) {
  switch (inline.type) {
    case 'code':
      return (
        <Box
          component="code"
          sx={{
            fontFamily: 'ui-monospace, SFMono-Regular, monospace',
            fontSize: '0.92em',
            bgcolor: 'action.hover',
            color: 'text.primary',
            px: 0.5,
            borderRadius: 0.5,
          }}
        >
          {inline.text}
        </Box>
      );
    case 'bold':
      return <strong>{inline.text}</strong>;
    case 'italic':
      return <em>{inline.text}</em>;
    case 'link':
      // A link is the one thing in an answer that leaves the machine, and only
      // when the reader chooses it. Nothing here is fetched automatically.
      return (
        <Link href={inline.href} target="_blank" rel="noopener noreferrer" underline="always">
          {inline.text}
        </Link>
      );
    case 'citation':
      return (
        <CitationMarker
          index={inline.cite}
          citation={citations.find((c) => c.index === inline.cite)}
          onCitation={onCitation}
        />
      );
    default:
      return <>{inline.text}</>;
  }
}

function Runs({
  inlines,
  citations,
  onCitation,
}: {
  inlines: Inline[];
  citations: Citation[];
  onCitation?: (citation: Citation) => void;
}) {
  return (
    <>
      {inlines.map((inline, i) => (
        <Fragment key={i}>
          <InlineRun inline={inline} citations={citations} onCitation={onCitation} />
        </Fragment>
      ))}
    </>
  );
}

function BlockView({
  block,
  citations,
  onCitation,
}: {
  block: Block;
  citations: Citation[];
  onCitation?: (citation: Citation) => void;
}) {
  switch (block.type) {
    case 'heading':
      return (
        <Typography variant={HEADING_VARIANTS[Math.min(block.level - 1, 5)]} sx={{ mt: 1.5, mb: 0.5 }}>
          <Runs inlines={block.children} citations={citations} onCitation={onCitation} />
        </Typography>
      );
    case 'quote':
      return (
        <Box sx={{ borderLeft: 2, borderColor: 'divider', pl: 1.5, my: 1 }}>
          <Typography variant="body2" color="text.secondary">
            <Runs inlines={block.children} citations={citations} onCitation={onCitation} />
          </Typography>
        </Box>
      );
    case 'code':
      return (
        <Box
          component="pre"
          sx={{
            fontFamily: 'ui-monospace, SFMono-Regular, monospace',
            fontSize: '0.85rem',
            bgcolor: 'background.default',
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 1,
            p: 1.25,
            my: 1,
            overflowX: 'auto',
            whiteSpace: 'pre',
          }}
        >
          {block.text}
        </Box>
      );
    case 'list':
      return block.ordered ? (
        <Box component="ol" sx={{ m: 0, pl: 2.5 }}>
          {block.items.map((item, i) => (
            <Typography key={i} component="li" variant="body2" sx={{ mb: 0.25 }}>
              <Runs inlines={item.children} citations={citations} onCitation={onCitation} />
            </Typography>
          ))}
        </Box>
      ) : (
        <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
          {block.items.map((item, i) => (
            <Typography key={i} component="li" variant="body2" sx={{ mb: 0.25 }}>
              <Runs inlines={item.children} citations={citations} onCitation={onCitation} />
            </Typography>
          ))}
        </Box>
      );
    case 'hr':
      return <Divider sx={{ my: 1.5 }} />;
    default:
      return (
        <Typography variant="body2" sx={{ mb: 0.75, whiteSpace: 'pre-wrap' }}>
          <Runs inlines={block.children} citations={citations} onCitation={onCitation} />
        </Typography>
      );
  }
}

/**
 * Answer text, rendered as elements and nothing else.
 *
 * The parser produces plain data and this file turns it into MUI components, so
 * a document that contains markup shows its markup. User questions are rendered
 * `plain`: their wording is the record of what was asked, and a `[1]` someone
 * typed is not a source.
 */
export function MarkdownText({ text, citations = [], onCitation, plain = false }: Props) {
  if (plain) {
    return (
      <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
        {text}
      </Typography>
    );
  }
  const blocks = parseMarkdown(text);
  if (blocks.length === 0) return null;
  return (
    <Box>
      {blocks.map((block, i) => (
        <BlockView key={i} block={block} citations={citations} onCitation={onCitation} />
      ))}
    </Box>
  );
}
