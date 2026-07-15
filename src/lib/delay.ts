/**
 * Wait, without blocking the event loop.
 *
 * The waits here are for other people's systems: YouTube propagating a write, a rate limit, a
 * spinner that should not flash. Calling this rather than reaching for setTimeout keeps them
 * something a test can stub, since a test that really waits is both slow and load-flaky.
 */
export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
