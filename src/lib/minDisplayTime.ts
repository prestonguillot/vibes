/**
 * Minimum on-screen time for the connection-status buttons. A fast connection
 * check would otherwise flash the button (loading -> result) too quickly to read,
 * so we hold the response until at least this long has passed.
 */
export const MIN_DISPLAY_TIME_MS = 500;

/**
 * Resolves once at least MIN_DISPLAY_TIME_MS has elapsed since `startTime`
 * (a Date.now() value). If the work already took that long, resolves immediately.
 */
export async function enforceMinDisplayTime(startTime: number): Promise<void> {
  const elapsed = Date.now() - startTime;
  if (elapsed < MIN_DISPLAY_TIME_MS) {
    await new Promise((resolve) => setTimeout(resolve, MIN_DISPLAY_TIME_MS - elapsed));
  }
}
