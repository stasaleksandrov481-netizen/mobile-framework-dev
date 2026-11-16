/**
 * Coalesce concurrent probes and reuse recent results per warm server instance.
 * A failed or timed-out check is cached briefly so outages cannot amplify load.
 */
export function createCachedHealthCheck(
  probe: () => Promise<boolean>,
  ttlMs = 10_000,
  timeoutMs = 1_500,
): () => Promise<boolean> {
  let expiresAt = 0;
  let lastResult = false;
  let pending: Promise<boolean> | undefined;

  return () => {
    if (Date.now() < expiresAt) return Promise.resolve(lastResult);
    if (pending) return pending;

    const run = async (): Promise<boolean> => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const timeout = new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(false), timeoutMs);
        });
        const result = await Promise.race([Promise.resolve().then(probe), timeout]);
        lastResult = result === true;
      } catch {
        lastResult = false;
      } finally {
        if (timer) clearTimeout(timer);
        expiresAt = Date.now() + ttlMs;
      }
      return lastResult;
    };
    const current = run();
    pending = current;
    void current.finally(() => {
      if (pending === current) pending = undefined;
    });
    return current;
  };
}
