import type { Express } from 'express';
import http from 'node:http';
import { afterAll } from 'vitest';

/**
 * One listening server for the whole test file, instead of one per request.
 *
 * Handed an express app - a function - supertest wraps it in a server of its own and, finding it
 * has no address, calls `listen(0)` for EVERY request and closes it again afterwards
 * (supertest/lib/test.js:63). Across this suite that is roughly 1,500 servers on 1,500 ephemeral
 * ports in about three seconds, and it made tests fail about one run in twenty: a request that was
 * never answered, a reset, or another connection's bytes entirely ("Parse Error: Expected HTTP/").
 * The victim was whichever test lost the race, so it moved every time and every file passed alone.
 *
 * Handed a server that is ALREADY listening, both branches are skipped: it reuses the server and
 * never closes it (`this._server` stays undefined, so the teardown at test.js:134 has nothing to
 * do). One port, held for the file, is not a port that can be recycled underneath anybody.
 *
 * `request(server)` reads the same as `request(app)` did, so call sites do not change.
 */
export function testServer(app: Express): http.Server {
  const server = app.listen(0);

  afterAll(async () => {
    // close() waits for open connections, and a test that abandoned a request mid-flight would
    // otherwise hang the file rather than fail it.
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  return server;
}
