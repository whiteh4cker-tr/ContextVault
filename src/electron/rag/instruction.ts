import { needsQueryInstruction } from '../catalog.js';

/**
 * The task sentence Qwen3 Embedding expects in front of a query.
 *
 * Its training pairs were built as (instruction + query, passage). Asked about a
 * bare question, the model is doing something close to what it learned but not
 * the thing it measured similarity against, and retrieval quality drops quietly —
 * no error, just weaker hits. Passages are embedded exactly as they are, because
 * only the query side of the pair carried an instruction.
 */
export const RETRIEVAL_QUERY_INSTRUCTION =
  'Instruct: Given a question about the documents in this vault, retrieve the passages that answer that question.\nQuery: ';

/** Prefix a query for the embedder. Never used on corpus text. */
export function withQueryInstruction(query: string): string {
  return `${RETRIEVAL_QUERY_INSTRUCTION}${query}`;
}

/**
 * Decide from the loaded model's own metadata whether to prefix queries.
 *
 * A model that does not expect an instruction is not given one, so swapping the
 * embedder for another catalogue entry cannot silently change what the vectors
 * mean.
 */
export function shouldInstructQuery(architecture?: string, poolingType?: number): boolean {
  return needsQueryInstruction(architecture, poolingType);
}
