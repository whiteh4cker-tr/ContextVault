/**
 * Test helper: wait for a condition by polling, outside React's `act`.
 *
 * Testing Library's `waitFor` runs its callback inside an `act` scope, and React
 * holds queued state updates until that scope exits. For a hook driven by timer
 * callbacks that fire *outside* act — which is exactly how the real backend's IPC
 * events arrive — that means `waitFor` can only ever see the render from before
 * the work it is waiting for. Polling from outside act observes the committed
 * render instead, which is what these tests are about.
 */
export interface PollOptions {
  timeoutMs?: number;
  intervalMs?: number;
}

export async function pollUntil(
  // Any value is fine; the signal is the throw. Queries that return an element
  // are the common case, so the return type is deliberately not narrowed.
  assertion: () => unknown,
  { timeoutMs = 3000, intervalMs = 3 }: PollOptions = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;
  for (;;) {
    try {
      await assertion();
      return;
    } catch (error) {
      lastError = error;
    }
    if (Date.now() > deadline) {
      const detail = lastError instanceof Error ? lastError.message : String(lastError);
      throw new Error(`Timed out after ${timeoutMs}ms — ${detail}`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/** Let pending React work settle after awaiting something outside an event handler. */
export async function flushReact(work: () => Promise<unknown>): Promise<void> {
  // Imported lazily so this module can be used from node-environment tests.
  const { act } = await import('@testing-library/react');
  await act(async () => {
    await work();
  });
}
