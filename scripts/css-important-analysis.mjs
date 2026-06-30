// Audit (and optionally prune) the !important declarations in style.css. Deterministically
// classifies each one as load-bearing or redundant using the browser's real cascade: for
// every !important declaration we drop the important flag, re-read the computed style of
// every element the rule matches, and restore it. If no computed value changed, the
// !important provably does nothing -> redundant. We compare the FULL computed style (not
// just the named property) so shorthands like `border` are handled.
//
// Coverage is a strict superset of tests/visual/*: each component is rendered in the SAME
// DOM the screenshot tests use and dialogs are opened with showModal() (top layer + :modal),
// so anything flagged redundant here is safe against that suite. !important on selectors
// that never render are kept conservatively, as are @media-nested ones.
//
// Usage:  node scripts/css-important-analysis.mjs           (read-only audit)
//         node scripts/css-important-analysis.mjs --apply   (strip the redundant ones)
// Re-run after CSS changes to catch newly-redundant !important; verify with `npm run test:visual`.
import { chromium } from '@playwright/test';
import ejs from 'ejs';
import fs from 'fs';
import postcss from 'postcss';

// `--apply` rewrites public/css/style.css in place, stripping the redundant !important via
// postcss (comments/sections/formatting preserved). Without it, this is a read-only audit.
const APPLY = process.argv.includes('--apply');

const BOOTSTRAP = fs.readFileSync('public/vendor/bootstrap.min.css', 'utf8');
const STYLE = fs.readFileSync('public/css/style.css', 'utf8');
const fixtures = JSON.parse(fs.readFileSync('src/debug-fixtures.json', 'utf8'));

const img = (c) =>
  `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1'%3E%3Crect width='1' height='1' fill='%23${c}'/%3E%3C/svg%3E`;
const score = {
  stars: 4.5,
  totalScore: 0.9,
  color: '#3bb54a',
  components: { coreMatch: 0.6, officialVideo: 0.3 },
};
const modalFixture = {
  modalTitle: 'Choose a video',
  instructionText: 'Pick the best match for <strong>Song Title</strong>',
  currentVideoId: '',
  playlistId: 'p1',
  trackId: 't1',
  videos: [
    {
      id: 'v1',
      title: 'Song Title (Official Video)',
      channelTitle: 'The Artist',
      description: 'Official music video. '.repeat(12),
      thumbnail: img('3366cc'),
      matchScore: score,
    },
    {
      id: 'v2',
      title: 'Song Title (Live)',
      channelTitle: 'A Fan',
      description: 'Live performance from a concert.',
      thumbnail: img('cc9933'),
      matchScore: { stars: 3, totalScore: 0.62, color: '#e0a800', components: { coreMatch: 0.6 } },
    },
  ],
};

function analyzeInPage() {
  const snap = (el) => {
    const cs = getComputedStyle(el);
    let s = '';
    for (const p of cs) s += p + ':' + cs.getPropertyValue(p) + ';';
    return s;
  };
  const results = [];
  const walk = (rules, inMedia) => {
    for (const rule of rules) {
      // Recurse into @media / @supports groups (they have .media/.conditionText).
      // NOTE: modern CSSStyleRule also has an (empty) .cssRules for CSS-nesting, so
      // we must NOT treat "has cssRules" as "is a group".
      if (rule.media || rule.conditionText) {
        walk(rule.cssRules, true);
        continue;
      }
      if (!rule.style || !rule.selectorText) continue;
      // Source-level declarations (shorthands intact) parsed from cssText, so the
      // output maps 1:1 to the lines written in style.css.
      const importantProps = [];
      for (const part of rule.style.cssText.split(';')) {
        const t = part.trim();
        if (!t || !/!\s*important\s*$/i.test(t)) continue;
        const prop = t.slice(0, t.indexOf(':')).trim();
        if (prop) importantProps.push(prop);
      }
      if (!importantProps.length) continue;
      let els = [];
      try {
        els = Array.from(document.querySelectorAll(rule.selectorText));
      } catch {
        els = [];
      }
      for (const prop of importantProps) {
        if (!els.length) {
          results.push({ selector: rule.selectorText, prop, matched: 0, changed: false, inMedia });
          continue;
        }
        const value = rule.style.getPropertyValue(prop);
        const before = els.map(snap);
        rule.style.setProperty(prop, value, '');
        const after = els.map(snap);
        rule.style.setProperty(prop, value, 'important');
        const changed = before.some((b, i) => b !== after[i]);
        results.push({ selector: rule.selectorText, prop, matched: els.length, changed, inMedia });
      }
    }
  };
  const target = Array.from(document.styleSheets).find(
    (sh) => sh.ownerNode && sh.ownerNode.id === 'analyze-css',
  );
  let walkErr = null;
  try {
    if (target) walk(target.cssRules, false);
  } catch (e) {
    walkErr = String(e);
  }
  return {
    results,
    diag: {
      sheets: document.styleSheets.length,
      targetFound: !!target,
      targetRules: target ? target.cssRules.length : 0,
      walkErr,
    },
  };
}

const bodyOf = (html) => {
  const m = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  return m ? m[1] : html;
};
const wrap = (body) =>
  `<!doctype html><html><head><meta charset="utf-8"><style>${BOOTSTRAP}</style>` +
  `<style id="analyze-css">${STYLE}</style></head>` +
  `<body><div class="harness">${bodyOf(body)}</div></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });

// The connection-error <dialog>, rendered open. Mirrors tests/visual/connectionModal.spec.ts.
const CONNECTION_MODAL = `
  <dialog class="connection-error-modal" id="connectionErrorModal" aria-labelledby="connectionErrorLabel">
    <div class="modal-content">
      <div class="modal-header">
        <h5 class="modal-title" id="connectionErrorLabel">Spotify Connection Failed</h5>
        <button type="button" class="btn-close" data-dialog-close aria-label="Close"></button>
      </div>
      <div class="modal-body">
        <p class="modal-message" id="connectionErrorMessage">Spotify API quota exceeded. Please wait and try again later.</p>
        <div class="text-center"><button type="button" class="btn btn-error-modal" data-dialog-close>OK</button></div>
      </div>
    </div>
  </dialog>`;

const videoModalPartial = await ejs.renderFile(
  'views/partials/video-selection-modal.ejs',
  modalFixture,
);
// The sync-status box and synced playlist row. Mirrors tests/visual/syncStatus.spec.ts.
const SYNC_STATUS = `
  <div id="playlists-content">
    <div class="playlist-item" data-playlist-id="apple"><h5>Apple</h5>
      <div id="sync-status-apple" class="sync-status-box sync-status-working">
        <div class="sync-status-content"><div data-sync-success="true">Synced!</div></div>
        <button type="button" class="sync-status-close" aria-label="Close"></button>
      </div>
    </div>
  </div>`;

// Each target's DOM is rendered in the SAME structure the visual tests use; dialogs are
// opened with showModal() (top layer + :modal) so modal-only rules get exercised. This makes
// the analyzer's coverage a strict superset of tests/visual/*, so anything flagged redundant
// here is provably safe against the screenshot suite. `open` = element ids to showModal().
const targets = [
  { name: 'debug', body: await ejs.renderFile('views/debug-components.ejs', fixtures), open: [] },
  {
    name: 'video-modal',
    body: `<dialog id="videoSelectionModal" class="video-modal"><div class="modal-content"><div id="video-modal-content">${videoModalPartial}</div></div></dialog>`,
    open: ['videoSelectionModal'],
  },
  { name: 'connection-modal', body: CONNECTION_MODAL, open: ['connectionErrorModal'] },
  { name: 'sync-status', body: SYNC_STATUS, open: [] },
  {
    name: 'replace-success-alert',
    body: await ejs.renderFile('views/partials/video-replace-success.ejs', {
      message: 'Video replaced.',
    }),
    open: [],
  },
];

const agg = new Map();
for (const { name, body, open } of targets) {
  await page.setContent(wrap(body), { waitUntil: 'load' });
  if (open.length) {
    await page.evaluate((ids) => {
      for (const id of ids) {
        const d = document.getElementById(id);
        if (d && typeof d.showModal === 'function') d.showModal();
      }
    }, open);
  }
  const { results: res, diag } = await page.evaluate(analyzeInPage);
  console.log(`[${name}] diag:`, JSON.stringify(diag), '| results:', res.length);
  for (const r of res) {
    const key = r.selector + ' ||| ' + r.prop;
    const cur = agg.get(key) || { ...r, matched: 0, changed: false, inMedia: false };
    cur.matched += r.matched;
    cur.changed = cur.changed || r.changed;
    cur.inMedia = cur.inMedia || r.inMedia;
    agg.set(key, cur);
  }
}
await browser.close();

const all = [...agg.values()];
const removable = all.filter((x) => x.matched > 0 && !x.changed && !x.inMedia);
const loadBearing = all.filter((x) => x.changed);
const unmatched = all.filter((x) => x.matched === 0 && !x.changed);
const mediaKept = all.filter((x) => x.inMedia && !x.changed && x.matched > 0);

console.log('distinct (selector,property) !important entries:', all.length);
console.log('  LOAD-BEARING (keep):', loadBearing.length);
console.log('  REDUNDANT on rendered components (removable):', removable.length);
console.log('  UNMATCHED / never rendered (keep, conservative):', unmatched.length);
console.log('  @media-nested unchanged (keep, conservative):', mediaKept.length);
console.log('\n--- REMOVABLE (selector | property) ---');
removable.forEach((x) => console.log(`${x.selector}  |  ${x.prop}`));

if (!APPLY) {
  console.log('\nRead-only audit. Re-run with --apply to strip the redundant !important.');
} else {
  // Canonicalise selectors so the browser's selectorText matches the source spelling.
  const norm = (s) =>
    s
      .replace(/\s+/g, ' ')
      .replace(/\s*([>+~,])\s*/g, '$1')
      .trim();
  const set = new Set(removable.map((r) => norm(r.selector) + '|' + r.prop.toLowerCase()));
  const root = postcss.parse(STYLE);
  let removed = 0;
  root.walkRules((rule) => {
    if (rule.parent && rule.parent.type === 'atrule') return; // @media kept conservative
    rule.walkDecls((decl) => {
      if (!decl.important) return;
      if (set.has(norm(rule.selector) + '|' + decl.prop.toLowerCase())) {
        decl.important = false;
        removed++;
      }
    });
  });
  fs.writeFileSync('public/css/style.css', root.toString());
  // removed < removable.length when a redundant longhand maps to a source shorthand
  // (e.g. `border`); those are left intact rather than rewritten, which is safe.
  console.log(`\napplied: stripped !important from ${removed}/${removable.length} declarations.`);
}
