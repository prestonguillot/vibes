import { PluginKind, declareClassPlugin } from '@stryker-mutator/api/plugin';

const REASON = 'log wording: asserting it pins the message rather than any behaviour';

/**
 * The names the app logs through. `Logger` is the server-side one (src/lib/logger.ts); the client
 * scripts use a `Logger` global of the same shape (public/js/logger.js).
 *
 * `console` is deliberately absent. Nothing outside the two loggers is allowed to call it, and the
 * calls inside them pass a built-up variable rather than a literal - so listing it would ignore
 * nothing, while widening what this can reach.
 */
const LOGGER_OBJECTS = new Set(['Logger', 'logger']);

/**
 * Ignore mutants in the TEXT a log line says.
 *
 * Rewording a log message is not a behaviour change, so no test fails, so every one of them
 * survives - about a fifth of every survivor list in this repo, which is a fifth of the noise to
 * read past when deciding what actually needs a test.
 *
 * This ignores only string literals and template literals passed DIRECTLY to a log call. It does
 * not touch:
 * - the context object (`Logger.warn(msg, { status, url })`), where the VALUES are real data and
 *   the app's own rule is that an unexpected API response must log status, url and a body snippet;
 * - anything computed and then logged, since the computation is the code under test;
 * - string literals anywhere else, which is why this is a plugin and not
 *   `excludedMutations: ['StringLiteral']` - that would also stop measuring
 *   `secure: NODE_ENV === 'production'`, `sameSite: 'strict'`, `hmac.digest('hex')` and
 *   `privacyStatus: 'private'`.
 *
 * Ignored mutants are still reported, with this reason attached. They are labelled, not hidden.
 */
export class LogTextIgnorer {
  shouldIgnore(path) {
    if (!path.isStringLiteral() && !path.isTemplateLiteral()) return undefined;

    const call = path.parentPath;
    if (!call?.isCallExpression()) return undefined;
    // Only a direct argument. A literal nested inside an object or an expression is something else.
    if (!call.get('arguments').some((arg) => arg.node === path.node)) return undefined;

    const callee = call.get('callee');
    if (!callee.isMemberExpression()) return undefined;

    const object = callee.get('object');
    return object.isIdentifier() && LOGGER_OBJECTS.has(object.node.name) ? REASON : undefined;
  }
}

export const strykerPlugins = [declareClassPlugin(PluginKind.Ignore, 'log-text', LogTextIgnorer)];
