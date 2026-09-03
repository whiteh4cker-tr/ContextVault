/**
 * Human-readable names for the pipeline stages, shared by the progress row and
 * the document card so a stage is described identically everywhere.
 */
export const STAGE_LABEL: Record<string, string> = {
  queued: 'Queued',
  hashing: 'Hashing file',
  parsing: 'Parsing document',
  chunking: 'Chunking text',
  embedding: 'Generating embeddings',
  indexing: 'Writing index',
  ready: 'Indexed',
  failed: 'Failed',
};

/** Percent for the current stage, or null when the ratio is genuinely unknown. */
export function stagePercent(ratio: number): number | null {
  return ratio < 0 ? null : Math.round(Math.min(1, ratio) * 100);
}
