/**
 * The ignore-plugin that keeps log wording out of the mutation score
 * (scripts/stryker-ignore-log-text.mjs).
 *
 * A fifth of every survivor list in this repo was the text of a log line: rewording one is not a
 * behaviour change, so no test fails, so it survives forever. The danger of removing that noise is
 * removing signal with it - `excludedMutations: ['StringLiteral']` would also stop measuring
 * `secure: NODE_ENV === 'production'`, `sameSite: 'strict'` and `hmac.digest('hex')`, which is why
 * this is a plugin that names what it ignores rather than a mutator switch.
 *
 * So what these pin is the NARROWNESS. Over-matching here does not fail anything; it quietly stops
 * measuring code, and the score goes UP as it does.
 */

import { describe, it, expect } from 'vitest';
import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
import { LogTextIgnorer } from '../../scripts/stryker-ignore-log-text.mjs';

// @babel/traverse ships CJS; under ESM the callable hides behind .default.
const traverse = ((_traverse as unknown as { default?: typeof _traverse }).default ??
  _traverse) as typeof _traverse;

const ignorer = new LogTextIgnorer();

/** Every string/template literal in `code`, with the ignorer's verdict on it. */
function verdicts(code: string): Array<{ text: string; ignored: boolean }> {
  const found: Array<{ text: string; ignored: boolean }> = [];
  traverse(parse(code, { sourceType: 'module', plugins: ['typescript'] }), {
    StringLiteral: (path) => {
      found.push({ text: path.node.value, ignored: !!ignorer.shouldIgnore(path) });
    },
    TemplateLiteral: (path) => {
      found.push({
        text: path.node.quasis.map((q) => q.value.raw).join('${}'),
        ignored: !!ignorer.shouldIgnore(path),
      });
    },
  });
  return found;
}

const isIgnored = (code: string, text: string) =>
  verdicts(code).find((v) => v.text === text)?.ignored;

describe('what it ignores', () => {
  it.each([
    ["Logger.info('Reconciling YouTube playlist');", 'Reconciling YouTube playlist'],
    ["Logger.warn('Could not fetch', { url });", 'Could not fetch'],
    ["Logger.error('Failed', {}, error);", 'Failed'],
    ["Logger.debug('CSRF token components', { a });", 'CSRF token components'],
  ])('ignores the message in %s', (code, text) => {
    expect(isIgnored(code, text)).toBe(true);
  });

  // The client scripts log through a global of the same shape, lowercased in some files.
  it('ignores a lowercase logger too', () => {
    expect(isIgnored("logger.info('starting up');", 'starting up')).toBe(true);
  });

  it('ignores a template-literal message', () => {
    const code = 'Logger.debug(`Scraping YouTube for: "${query}"`);';
    expect(verdicts(code)[0]).toMatchObject({ ignored: true });
  });

  it('gives a reason, so the report says why', () => {
    const found = verdicts("Logger.info('anything');");
    expect(found).toHaveLength(1);
    // The reason is what makes an ignored mutant labelled rather than hidden.
    const code = "Logger.info('anything');";
    let reason: string | undefined;
    traverse(parse(code, { sourceType: 'module' }), {
      StringLiteral: (path) => {
        reason = ignorer.shouldIgnore(path);
      },
    });
    expect(reason).toContain('log wording');
  });
});

/**
 * Each of these is a real line from this repo, and each is a string literal that decides something.
 * If any of them starts being ignored, the score rises while the app stops being measured.
 */
describe('what it must never ignore', () => {
  it.each([
    ["const opts = { secure: process.env.NODE_ENV === 'production' };", 'production'],
    ["const opts = { sameSite: 'strict' };", 'strict'],
    ["function sign() { return hmac.digest('hex'); }", 'hex'],
    ["youtube.playlists.insert({ status: { privacyStatus: 'private' } });", 'private'],
    ["await youtubeWrite('playlistItems.insert', fn);", 'playlistItems.insert'],
    ["const scopes = ['playlist-read-private'];", 'playlist-read-private'],
    [
      "res.redirect('/?error=youtube&reason=quota_exceeded');",
      '/?error=youtube&reason=quota_exceeded',
    ],
    ["if (item.snippet?.title === 'My Playlist (from Spotify)') {}", 'My Playlist (from Spotify)'],
  ])('measures %s', (code, text) => {
    expect(isIgnored(code, text)).toBe(false);
  });

  // The values in a log's context are real data, and this app's own rule is that an unexpected API
  // response must log its status, url and a body snippet. Only the wording is noise.
  it('measures a string that is a VALUE in a log context, not the message', () => {
    const code = "Logger.warn('Refused', { reason: 'quotaExceeded' });";

    expect(isIgnored(code, 'Refused')).toBe(true);
    expect(isIgnored(code, 'quotaExceeded')).toBe(false);
  });

  // A message built first and logged second is a computation, and the computation is code.
  it('measures a message that is computed before it is logged', () => {
    const code = "const msg = 'Refused: ' + reason; Logger.warn(msg);";

    expect(isIgnored(code, 'Refused: ')).toBe(false);
  });

  // Same call shape, different object: only the loggers are noise.
  it('measures a string argument to something that merely looks like a logger', () => {
    expect(isIgnored("audit.info('user deleted account');", 'user deleted account')).toBe(false);
  });
});
