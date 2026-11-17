/** Prevent unresponsive upstream requests from pinning the entire UI forever. */
export async function settleWithTimeout<T>(request: PromiseLike<T>, timeoutMs = 9_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(request),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("CORTEX_REQUEST_TIMEOUT")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
