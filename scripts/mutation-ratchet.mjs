#!/usr/bin/env node
/**
 * Mutation-score ratchet: a file may not become less well tested than it already is.
 *
 * Each file is compared against its own recorded score rather than a shared threshold. A single bar
 * high enough to be worth enforcing would block any edit to a file that is currently under it, for
 * reasons having nothing to do with the edit. Per-file means a weak file stays editable while a
 * well-tested one cannot quietly rot.
 *
 * Usage:
 *   node scripts/mutation-ratchet.mjs check [--base origin/main]
 *       Mutate only the files changed against the base and fail if one scores below its baseline.
 *       Mutating everything runs the test suite once per mutant, which is too slow to sit in front
 *       of a change; the files a change touches are the ones it can break.
 *
 *   node scripts/mutation-ratchet.mjs check-all
 *       Compare EVERY file in the last report against its baseline. The per-change check only looks
 *       at what a change touched, so it cannot see a file whose tests were weakened from elsewhere;
 *       this can.
 *
 *   node scripts/mutation-ratchet.mjs update
 *       Sweep everything and rewrite the baseline. Run after deliberately changing what is tested.
 *
 *   node scripts/mutation-ratchet.mjs update --from-report
 *       Rewrite the baseline from the last report, without re-running the sweep.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import picomatch from 'picomatch';

const BASELINE = 'mutation-baseline.json';
const REPORT = 'reports/mutation/report.json';
const CONFIG = 'stryker.config.json';

/**
 * Does Stryker mutate this file? Answered from stryker.config.json's own globs rather than a copy
 * of them, so changing what gets mutated cannot leave this script quietly disagreeing.
 *
 * The globs are include-minus-exclude, which is NOT what picomatch does with an array: it ORs them,
 * and reads a leading `!` as "matches anything but this" - so `!src/types/**` alone would match
 * every test and template. The two sets are applied separately.
 */
const MUTATED = (() => {
  const globs = JSON.parse(readFileSync(CONFIG, 'utf8')).mutate;
  const included = picomatch(globs.filter((g) => !g.startsWith('!')));
  const excluded = picomatch(globs.filter((g) => g.startsWith('!')).map((g) => g.slice(1)));
  return (file) => included(file) && !excluded(file);
})();

/**
 * Per-file mutation scores, plus every file the report mentions - including those with nothing
 * mutable in them, which `scores` omits. A file with no mutants is fine; one the run never reached
 * is not, and only `reported` can tell them apart.
 */
function readReport() {
  if (!existsSync(REPORT)) {
    throw new Error(`No ${REPORT}. Run stryker first.`);
  }
  const report = JSON.parse(readFileSync(REPORT, 'utf8'));
  const scores = {};
  const reported = new Set();

  for (const [file, data] of Object.entries(report.files)) {
    const relative = path.relative(process.cwd(), file);
    reported.add(relative);

    const counts = {};
    for (const mutant of data.mutants) counts[mutant.status] = (counts[mutant.status] ?? 0) + 1;

    const killed = (counts.Killed ?? 0) + (counts.Timeout ?? 0);
    const survived = (counts.Survived ?? 0) + (counts.NoCoverage ?? 0);
    const total = killed + survived;
    if (total === 0) continue; // nothing mutable in here

    scores[relative] = Math.round((killed / total) * 10000) / 100;
  }
  return { scores, reported };
}

const scoresFromReport = () => readReport().scores;

const readBaseline = () =>
  existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')).scores : {};

/**
 * Merge scores into the baseline, keeping entries the run did not measure.
 *
 * A scoped run reports only the files it mutated, so replacing wholesale would drop every other
 * file's record and silently reset the ratchet to remembering nothing. Entries are pruned only when
 * their file is gone or is no longer mutated at all.
 */
function writeBaseline(scores) {
  const merged = { ...readBaseline(), ...scores };
  for (const file of Object.keys(merged)) {
    if (!existsSync(file) || !MUTATED(file)) delete merged[file];
  }
  const sorted = Object.fromEntries(Object.entries(merged).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(
    BASELINE,
    JSON.stringify(
      {
        _comment:
          'Per-file mutation scores. The ratchet (scripts/mutation-ratchet.mjs) fails a change ' +
          'that drops a file below its entry here. Regenerate with: npm run test:mutation:update',
        scores: sorted,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`Wrote ${BASELINE} (${Object.keys(sorted).length} files)`);
}

function changedFiles(base) {
  const out = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { encoding: 'utf8' });
  // The diff includes deleted files and the old side of a rename; passing one of those to --mutate
  // would fail on a path that is no longer there.
  return out.split('\n').filter((f) => f && MUTATED(f) && existsSync(f));
}

/**
 * Compare scores against the baseline and report. Returns the files that dropped.
 *
 * A file absent from the report counts as a drop: it was not measured, which is not the same as not
 * having regressed.
 *
 * On CI this also writes the table to the run summary: a report that has to be downloaded and
 * unzipped to be read is a report nobody reads.
 */
function compare(files, { verbose = false } = {}) {
  const baseline = readBaseline();
  const { scores, reported } = readReport();
  const regressions = [];
  const rows = [];

  for (const file of files) {
    if (!reported.has(file)) {
      regressions.push({ file, before: baseline[file], now: undefined });
      rows.push(`| ${file} | ${baseline[file] ?? '–'}% | – | **not measured** |`);
      continue;
    }

    const now = scores[file];
    if (now === undefined) continue; // in the report, but nothing mutable in it

    const before = baseline[file];
    if (before === undefined) {
      rows.push(`| ${file} | – | ${now}% | new |`);
      continue;
    }
    // A point of tolerance: mutant counts shift slightly as code moves around.
    if (now < before - 1) {
      regressions.push({ file, before, now });
      rows.push(`| ${file} | ${before}% | ${now}% | **worse** |`);
    } else {
      rows.push(`| ${file} | ${before}% | ${now}% | ok |`);
      if (verbose) console.log(`  OK    ${file}: ${now}% (baseline ${before}%)`);
    }
  }

  if (process.env.GITHUB_STEP_SUMMARY) {
    const summary = [
      regressions.length ? '## Mutation score regressed' : '## Mutation score held',
      '',
      '| File | Baseline | Now | |',
      '| --- | --- | --- | --- |',
      ...(regressions.length ? rows.filter((r) => r.includes('worse') || r.includes('new')) : rows),
      '',
    ].join('\n');
    writeFileSync(process.env.GITHUB_STEP_SUMMARY, summary, { flag: 'a' });
  }

  return regressions;
}

function reportRegressions(regressions) {
  if (regressions.length === 0) return false;
  console.error('\nMutation score regressed:');
  for (const { file, before, now } of regressions) {
    if (now === undefined) console.error(`  ${file}: not in the report - it was never scored`);
    else console.error(`  ${file}: ${before}% -> ${now}%`);
  }
  console.error(
    '\nThe tests no longer catch changes they used to. Either cover the new code, or ' +
      're-record deliberately with: npm run test:mutation:update',
  );
  return true;
}

/**
 * A dead run must leave no report behind - the comparison cannot tell a stale one from a fresh one.
 * With `thresholds.break` null, stryker exits non-zero only on failure.
 */
function runStryker(args) {
  rmSync(REPORT, { force: true });
  const result = spawnSync('npx', ['stryker', 'run', ...args], { stdio: 'inherit', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`stryker exited ${result.status}. Nothing was scored; see the output above.`);
  }
}

const command = process.argv[2];

if (command === 'update') {
  if (!process.argv.includes('--from-report')) runStryker([]);
  writeBaseline(scoresFromReport());
} else if (command === 'check') {
  const baseIndex = process.argv.indexOf('--base');
  const base = baseIndex === -1 ? 'origin/main' : process.argv[baseIndex + 1];
  const files = changedFiles(base);

  if (files.length === 0) {
    console.log('No mutated files changed - nothing to check.');
    process.exit(0);
  }

  console.log(`Mutating ${files.length} changed file(s):\n  ${files.join('\n  ')}\n`);
  runStryker(['--mutate', files.join(',')]);

  if (reportRegressions(compare(files, { verbose: true }))) process.exit(1);
  console.log('\nNo file scored below its baseline.');
} else if (command === 'check-all') {
  const files = Object.keys(scoresFromReport());
  if (reportRegressions(compare(files))) process.exit(1);
  console.log(`No file scored below its baseline (${files.length} checked).`);
} else {
  console.error(
    'Usage: mutation-ratchet.mjs check [--base <ref>] | check-all | update [--from-report]',
  );
  process.exit(2);
}
