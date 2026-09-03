import type { ModelCatalogEntry, ModelRole } from '../shared/types.js';

/**
 * The two models ContextVault is designed around.
 *
 * Both are needed, and they are not interchangeable. The chat model is a causal
 * language model with no pooling head — it writes answers and cannot produce
 * usable embeddings. The embedding model does the opposite: it maps text to a
 * 2560-wide vector space so passages can be found by meaning, and it cannot
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
    sizeBytes: 6_716_356_800,
    label: 'Gemma 4 12B Instruct — QAT Q4_K_XL',
    recommended: true,
    trainedContext: 262_144,
  },
  {
    // BGE-M3 was the original choice and is gone for a measured reason: its
    // published GGUF converts as architecture `xlmr`, and the llama.cpp build
    // node-llama-cpp ships refuses it — `unknown model architecture: 'xlmr'`, a
    // download that could never run. Qwen3 Embedding declares `qwen3` with
    // `pooling_type: last`, which the engine reads, and it is the file the
    // 2560-wide index is sized for.
    fileName: 'qwen3-embedding-4b-q4_k_m.gguf',
    role: 'embedding',
    url: 'https://huggingface.co/enacimie/Qwen3-Embedding-4B-Q4_K_M-GGUF/resolve/main/qwen3-embedding-4b-q4_k_m.gguf',
    sizeBytes: 2_496_703_776,
    label: 'Qwen3 Embedding 4B — Q4_K_M, 2560-d',
    recommended: true,
    dimensions: 2560,
    trainedContext: 40_960,
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
 * `pooling_type` as the GGUF file stores it, from llama.cpp's own enum.
 *
 * This one field says more about a file than its name does. A model that
 * announces how its token vectors are pooled into one sentence vector is an
 * embedding model; a model that says nothing is a decoder that writes text.
 */
export const POOLING = { unspecified: -1, none: 0, mean: 1, cls: 2, last: 3, rank: 4 } as const;

/**
 * Which roles a file can serve, from what its own metadata says.
 *
 * A causal decoder cannot embed and an encoder cannot chat; guessing wrong here
 * means the engine fails at load time with a message about pooling, which is a
 * poor experience for what is really a wrong dropdown choice.
 *
 * The pooling head decides first, because architecture names are unreliable:
 * Qwen3 Embedding reports architecture `qwen3`, the same string the Qwen3 chat
 * models use, and only `pooling_type: last` separates them.
 */
export function rolesForArchitecture(architecture?: string, poolingType?: number): ModelRole[] {
  // A rerank model reads a pair and returns one score. It produces no vectors, so
  // it cannot fill an index — better to refuse it here than to store nonsense.
  if (poolingType === POOLING.rank) return [];
  if (poolingType === POOLING.mean || poolingType === POOLING.cls || poolingType === POOLING.last) {
    return ['embedding'];
  }
  if (!architecture) return ['chat', 'embedding'];
  const lower = architecture.toLowerCase();
  const encoder = ['bert', 'ernie', 'xlmr', 'gte', 'bge', 'jina', 'nomic'].some((needle) => lower.includes(needle));
  if (encoder || lower.includes('embed')) return ['embedding'];
  return ['chat'];
}

/**
 * Whether a query needs an instruction prefix before it is embedded.
 *
 * Qwen3 Embedding was trained with "Instruct: … Query: " in front of the query
 * side of its pairs, so an unmarked query is measured in a slightly different
 * place from the passages. Passages never get the prefix — only one side of the
 * training pair carried it, and prefixing both would move the corpus too.
 */
export function needsQueryInstruction(architecture?: string, poolingType?: number): boolean {
  return poolingType === POOLING.last && (architecture ?? '').toLowerCase().startsWith('qwen3');
}
