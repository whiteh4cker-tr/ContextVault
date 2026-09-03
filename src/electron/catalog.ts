import type { ModelCatalogEntry, ModelRole } from '../shared/types.js';

/**
 * The two models ContextVault is designed around.
 *
 * Both are needed, and they are not interchangeable. The chat model is a causal
 * language model with no pooling head — it writes answers and cannot produce
 * usable embeddings. The embedding model does the opposite: it maps text to a
 * 1024-wide vector space so passages can be found by meaning, and it cannot
 * generate a sentence to save its life. Retrieval and generation are separate
 * jobs with separate files.
 *
 * The catalogue is a suggestion list, not a whitelist: any `.gguf` the user
 * registers is accepted for a role its architecture supports.
 */
export const CATALOG: ModelCatalogEntry[] = [
  {
    fileName: 'gemma-4-12B-it-qat-UD-Q4_K_XL.gguf',
    role: 'chat',
    url: 'https://huggingface.co/unsloth/gemma-4-12B-it-qat-GGUF/resolve/main/gemma-4-12B-it-qat-UD-Q4_K_XL.gguf',
    sizeBytes: 6_719_400_000,
    label: 'Gemma 4 12B Instruct — QAT Q4_K_XL',
    recommended: true,
    trainedContext: 262_144,
  },
  {
    fileName: 'bge-m3-q8_0.gguf',
    role: 'embedding',
    url: 'https://huggingface.co/cstr/bge-m3-GGUF/resolve/main/bge-m3-q8_0.gguf',
    sizeBytes: 609_700_000,
    label: 'BGE-M3 embeddings — q8_0, 1024-d',
    recommended: true,
    dimensions: 1024,
    trainedContext: 8_192,
  },
  {
    // A smaller chat model for machines that cannot hold the 12B weights
    // alongside a workday of other applications.
    fileName: 'Qwen3-4B-Instruct-2507-Q4_K_M.gguf',
    role: 'chat',
    url: 'https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507-GGUF/resolve/main/Qwen3-4B-Instruct-2507-Q4_K_M.gguf',
    sizeBytes: 2_502_000_000,
    label: 'Qwen3 4B Instruct — Q4_K_M (small machines)',
    recommended: false,
    trainedContext: 262_144,
  },
];

/** Fallback ceiling for a file whose metadata cannot be read. */
export const UNKNOWN_TRAINED_CONTEXT = 131_072;

export function catalogForRole(role: ModelRole): ModelCatalogEntry[] {
  return CATALOG.filter((entry) => entry.role === role);
}

export function recommendedFor(role: ModelRole): ModelCatalogEntry | undefined {
  return catalogForRole(role).find((entry) => entry.recommended) ?? catalogForRole(role)[0];
}

/** The catalogue entry for a file name, if we know it. */
export function entryForFile(fileName: string): ModelCatalogEntry | undefined {
  return CATALOG.find((entry) => entry.fileName === fileName);
}

/**
 * Which roles a file can serve, from its GGUF architecture.
 *
 * A causal decoder cannot embed and a BERT-style encoder cannot chat; guessing
 * wrong here means the engine fails at load time with a message about pooling,
 * which is a poor user experience for what is really a wrong dropdown choice.
 */
export function rolesForArchitecture(architecture: string | undefined): ModelRole[] {
  if (!architecture) return ['chat', 'embedding'];
  const lower = architecture.toLowerCase();
  const encoder = ['bert', 'modern-bert', 'ernie', 'jina-bert', 'nomic-bert', 'gte', 'bge'].some((needle) =>
    lower.includes(needle),
  );
  if (encoder) return ['embedding'];
  return ['chat'];
}
