/**
 * Links several abort signals into one that aborts as soon as any source does.
 *
 * React Native ships no `AbortSignal.any()`, and one upload request can carry
 * two independent cancellation sources: the component's session controller
 * (close, hide, submit, unmount) and a picker-provided signal. Keeping both
 * attached means neither source has to weaken the other.
 *
 * Call `dispose()` once the linked operation settles so a long-lived picker
 * signal is not left wired to a finished upload.
 */
export function linkAbortSignals(sources: readonly (AbortSignal | undefined)[]): {
  signal: AbortSignal;
  dispose: () => void;
} {
  const controller = new AbortController();
  const links: Array<{ signal: AbortSignal; listener: () => void }> = [];
  const onAbort = () => controller.abort();

  for (const source of sources) {
    if (!source) continue;
    if (source.aborted) {
      controller.abort();
      break;
    }
    source.addEventListener('abort', onAbort, { once: true });
    links.push({ signal: source, listener: onAbort });
  }

  return {
    signal: controller.signal,
    dispose: () => {
      for (const link of links) {
        link.signal.removeEventListener('abort', link.listener);
      }
      links.length = 0;
    },
  };
}
