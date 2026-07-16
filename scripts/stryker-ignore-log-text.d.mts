/**
 * Types for the log-text ignore plugin, so its tests are type-checked.
 *
 * Hand-written for the same reason as mutation-ratchet.d.mts: the plugin is plain JS (stryker loads
 * it directly) and tsconfig.test.json cannot turn allowJs on. What catches drift is
 * tests/unit/strykerIgnoreLogText.test.ts, which drives the real class with real babel paths.
 */

import type { NodePath } from '@babel/traverse';

export declare class LogTextIgnorer {
  /** The reason this mutant is log wording, or undefined to measure it as normal. */
  shouldIgnore(path: NodePath): string | undefined;
}

export declare const strykerPlugins: unknown[];
