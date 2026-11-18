/** Ignore responses from requests superseded by a refresh or navigation. */
export function createLatestRequest() {
  let generation = 0;

  return {
    begin(): number { return ++generation; },
    isCurrent(requestId: number): boolean { return requestId === generation; },
    invalidate(): void { generation++; },
  };
}
