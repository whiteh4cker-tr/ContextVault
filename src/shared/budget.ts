/**
 * Pure arithmetic shared by the engine and the interface: retrieval selection,
 * context budgeting, and the formatting the UI shows for those numbers.
 *
 * No I/O, no platform globals — these are the functions worth testing hardest,
 * because they are where a wrong number becomes a wrong answer or an OOM.
 */

export const CONTEXT_MIN = 256;

/** The only context sizes the UI offers, in tokens. */
export const CONTEXT_STEPS = [
  256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536, 131072,
] as const;

/**
 * ruvector scores are distances — 0 means identical — while everything above
 * this function speaks in similarity. Converting at the boundary keeps the
 * inversion in exactly one place.
 */
export function similarityFromDistance(distance: number): number {
  return 1 - distance;
}

/** The floor is inclusive: a hit exactly at the threshold is a hit. */
export function passesFloor(similarity: number, floor: number): boolean {
  return similarity >= floor;
}

export interface ScoredRow {
  docId: string;
  similarity: number;
}

/**
 * Narrow a raw ANN result set to what the user should be shown.
 *
 * The registry, not the index, decides which documents exist and are active:
 * ruvector's Node metadata filtering cannot express "any of these ids" and
 * returns zero rows when asked (spec §4.1), so we over-fetch and filter here,
 * where a mistake shows up in a test rather than as a silently empty answer.
 *
 * Filtering by activity happens before the floor, so a document switched off
 * can never occupy a slot that a qualifying hit needed.
 */
export function selectTopK<T extends ScoredRow>(
  rows: readonly T[],
  { topK, floor, activeDocIds }: { topK: number; floor: number; activeDocIds: ReadonlySet<string> },
): T[] {
  return rows
    .filter((row) => activeDocIds.has(row.docId))
    .filter((row) => passesFloor(row.similarity, floor))
    .slice()
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK);
}

export interface ContextBudgetInput {
  /** Bytes available to the process right now. */
  freeBytes: number;
  /** Model weights, which must be resident before any context is. */
  weightsBytes: number;
  /** KV cache + graph overhead for one token of context. */
  bytesPerToken: number;
  /** Usually the model's trained context length. */
  maxContext?: number;
}

/**
 * The largest offered step that fits.
 *
 * Returns CONTEXT_MIN rather than 0 or null when nothing fits: the UI would
 * rather show "8 192 of these is not available on this machine" next to a
 * disabled slider than pretend there is no model at all.
 */
export function largestSafeContext({
  freeBytes,
  weightsBytes,
  bytesPerToken,
  maxContext = CONTEXT_STEPS[CONTEXT_STEPS.length - 1],
}: ContextBudgetInput): number {
  const headroom = freeBytes - weightsBytes;
  const fit = CONTEXT_STEPS.filter((size) => size <= maxContext)
    .filter((size) => size * bytesPerToken <= headroom)
    .pop();
  return fit ?? CONTEXT_MIN;
}

/** The limits a typed context size is judged against. */
export interface ContextLimits {
  min: number;
  /** The model's trained context length. */
  maxModel: number;
  /** What fits in the memory measured right now; advisory, not a hard limit. */
  maxSafe: number;
}

export type ContextSizeVerdict =
  | { ok: true; value: number; level: 'fits' | 'over-committed' }
  | { ok: false; value: number | null; error: string };

/**
 * Judge a context size typed into the field.
 *
 * Two kinds of refusal, deliberately kept apart. A size that is not a whole
 * number, or outside 256..trained-length, is a mistake — the engine cannot honour
 * it, so the field says so and does not offer Apply. A size that would fit the
 * model but not the memory free right now is a *decision*: the estimate and the
 * shortfall are shown, and applying it stays possible, because the measurement is
 * a snapshot and the user may know something it does not.
 */
export function validateContextSize(raw: string, limits: ContextLimits): ContextSizeVerdict {
  // Spaces and underscores are stripped so "16 384" — how this UI writes the
  // number everywhere — can be typed or pasted back in.
  const text = raw.trim().replace(/[\s_]/g, '');
  if (text.length === 0) return { ok: false, value: null, error: 'Enter a context size in tokens.' };

  const value = Number(text);
  // `Number` accepts "1e5", "0x1000" and "Infinity", none of which a person
  // should be able to enter as a token count.
  if (!/^-?\d+$/.test(text) || !Number.isFinite(value) || !Number.isInteger(value)) {
    return { ok: false, value: Number.isFinite(value) ? value : null, error: 'Context size must be a whole number of tokens.' };
  }
  if (value < limits.min) {
    return { ok: false, value, error: `Context size must be at least ${formatGrouped(limits.min)} tokens.` };
  }
  if (value > limits.maxModel) {
    return {
      ok: false,
      value,
      error: `This model supports at most ${formatGrouped(limits.maxModel)} tokens.`,
    };
  }
  return { ok: true, value, level: value > limits.maxSafe ? 'over-committed' : 'fits' };
}

/** Estimated resident bytes for a given context size. */
export function estimateContextBytes(weightsBytes: number, bytesPerToken: number, contextSize: number): number {
  return weightsBytes + contextSize * bytesPerToken;
}

export type ConfidenceBand = 'strong' | 'moderate' | 'weak';

/** The word printed on a citation chip. */
export function confidenceLabel(similarity: number): ConfidenceBand {
  if (similarity >= 0.75) return 'strong';
  if (similarity >= 0.45) return 'moderate';
  return 'weak';
}

/** "16 384" as "16k" — compact enough for a chip, exact enough to trust. */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;
}

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

export function formatBytes(n: number): string {
  let value = Math.max(0, n);
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = value >= 100 || unit === 0 ? Math.round(value) : Number(value.toFixed(1));
  return `${rounded} ${BYTE_UNITS[unit]}`;
}

/**
 * Thousands separators for token counts, which the context slider prints in
 * full ("16 384 tokens") because "16384" is hard to read at a glance.
 */
export function formatGrouped(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}
