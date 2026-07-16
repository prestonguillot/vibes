/**
 * Global test setup. Runs before all test files.
 *
 * The app logger is silenced for tests via `LOG_LEVEL=silent` (vitest.config.ts `test.env`), so its
 * output - including the deliberate error-path logging many tests exercise - never interleaves with
 * the test runner's output. Note logger.ts reads that level at MODULE SCOPE, so a test that needs
 * the logger to actually emit has to set the level itself rather than rely on the env.
 *
 * No .env file is loaded, deliberately. Tests that need credentials set process.env themselves (see
 * tests/unit/spotifyClient.test.ts), which keeps each test's requirements visible in the test
 * instead of in ambient state - and leaves src/lib/envValidation.ts testable against a genuinely
 * empty environment.
 */

import http from 'node:http';
import { afterEach } from 'vitest';
import { spotifyCircuitBreaker, youtubeCircuitBreaker } from '@/lib/circuitBreaker';

process.env.NODE_ENV = 'test';

/**
 * Close both circuit breakers after every test, everywhere.
 *
 * The breakers are module singletons shared across every test file. A test that trips one - the
 * YouTube quota test opens it on purpose - leaves it open for whatever runs next, and ten files
 * touch it. In a plain run the order is stable and a per-file beforeEach papers over it; under
 * stryker each mutant reloads and re-runs the whole suite, the order shifts, and a test inherits an
 * open breaker it did not expect. That failed the initial run at random, and stryker reads a failed
 * suite as the mutant being caught - so static-mutant scores moved between sweeps for no reason in
 * the code (circuitBreakerConfig read 40 or 60 depending on whether it fired). Resetting globally
 * makes the leak impossible rather than order-dependent. Same shape as the keep-alive fix below.
 */
afterEach(() => {
  spotifyCircuitBreaker.close();
  youtubeCircuitBreaker.close();
});

/**
 * Do not let a connection outlive the server it was opened to.
 *
 * supertest stands up a fresh server on an ephemeral port for EVERY request (`app.listen(0)`) and
 * closes it once the response lands - roughly 1,500 times, in about three seconds. Node has kept
 * connections alive by default since v19, so each of those sockets is left pooled in the global
 * agent under `127.0.0.1:<port>`, outliving the server it belonged to. The OS then hands that port
 * to a later server, the agent finds what looks like a pooled connection to it, and sends a request
 * down a socket that answers to nobody: a reset ("socket hang up"), a request that is never
 * answered (a 10s timeout), or another response entirely ("Parse Error: Expected HTTP/").
 *
 * It surfaced as five different tests in five files failing about one full run in eight, each
 * perfectly green on its own, because which request loses the race is pure chance. Reusing a
 * connection is a real optimisation against one long-lived server; against per-request throwaways
 * it is only a way to talk to the wrong one.
 */
http.globalAgent = new http.Agent({ keepAlive: false });
