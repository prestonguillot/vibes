/**
 * Run `work` over `items`, at most `limit` at a time.
 *
 * Promise.all starts everything at once. For a handful of calls that is what you want; for one call
 * per playlist in a library it is a burst the other end answers with 429, and a rate limit this app
 * brought on itself is indistinguishable from one it deserved.
 *
 * Results come back in the order of `items`, not the order they finished.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (limit < 1) throw new RangeError(`Concurrency limit must be at least 1, got ${limit}`);

  const results = new Array<R>(items.length);
  let next = 0;

  // One worker per slot, each taking the next item until there are none. Fewer workers than the
  // limit when there is less work than that, rather than idle promises.
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index]!, index);
    }
  });

  await Promise.all(workers);
  return results;
}
