import type { LLMState } from '../../shared/types';

/**
 * Why the question box is locked, in the words the user needs.
 *
 * The engine can be unusable for four different reasons and the remedy differs
 * each time. "Assistant unavailable" would be true in all four and useful in
 * none, so this returns the next action instead: download, wait, recover, or add
 * a document.
 */
export function composerBlock(llm: LLMState, readyDocuments: number): string | null {
  switch (llm.phase) {
    case 'no-model':
      return 'Download the chat model to start asking.';
    case 'loading-model':
      return `Loading ${llm.activeGgufFile ?? 'the model'} — you can ask as soon as it is ready.`;
    case 'error':
      return 'The engine reported an error. Re-select the model under Engine to try again.';
    default:
      break;
  }
  if (!llm.isModelLoaded) return 'The chat model is not loaded yet.';
  if (readyDocuments === 0) return 'Add a document to ask a question about it.';
  return null;
}
