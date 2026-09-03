import type { AiPhase, LLMState, ModelStatusSnapshot } from '../../shared/types';

export interface LlmSignals {
  /** A turn is producing tokens. */
  isStreaming: boolean;
  /** Any document is queued or being embedded. */
  isIndexing: boolean;
  /** Tokens of context occupied by the transcript, when the engine reports it. */
  usedTokens?: number;
}

/**
 * The one place the AppBar's status chip decides what to say.
 *
 * Order matters: a download in progress is more urgent than an idle model, and
 * streaming outranks indexing because it is what the user is waiting on right
 * now.
 */
export function deriveLLMState(status: ModelStatusSnapshot | null, signals: LlmSignals): LLMState {
  const chat = status?.chat;

  const phase: AiPhase = !chat || chat.state === 'missing'
    ? 'no-model'
    : chat.state === 'error'
      ? 'error'
      : signals.isStreaming
        ? 'streaming'
        : chat.state === 'downloading' || chat.state === 'loading'
          ? 'loading-model'
          : signals.isIndexing
            ? 'indexing'
            : 'idle';

  return {
    activeGgufFile: chat?.fileName ?? null,
    contextSize: status?.contextSize ?? 0,
    isModelLoaded: chat?.state === 'ready',
    isStreaming: signals.isStreaming,
    phase,
    ...(signals.usedTokens === undefined ? {} : { usedTokens: signals.usedTokens }),
  };
}

export const PHASE_LABEL: Record<AiPhase, string> = {
  'no-model': 'No model',
  idle: 'Ready',
  'loading-model': 'Loading model',
  retrieving: 'Searching documents',
  streaming: 'Streaming',
  indexing: 'Indexing',
  error: 'Engine error',
};

/** MUI `Chip` colour per phase — colour plus text, never colour alone. */
export const PHASE_TONE: Record<AiPhase, 'default' | 'primary' | 'success' | 'error' | 'warning' | 'info'> = {
  'no-model': 'default',
  idle: 'success',
  'loading-model': 'info',
  retrieving: 'info',
  streaming: 'primary',
  indexing: 'warning',
  error: 'error',
};
