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
const wrapWith = (style, body) =>
  `<!doctype html><html><head><meta charset="utf-8"><style>${BOOTSTRAP}</style>` +
  `<style id="analyze-css">${style}</style></head>` +
  `<body><div class="harness">${bodyOf(body)}</div></body></html>`;
const wrap = (body) => wrapWith(STYLE, body);

// Full computed style of every element under .harness, in document order - the signature we
// diff before/after a removal to catch joint effects the per-declaration toggle can't see.
function snapshotInPage() {
  const snap = (el) => {
    const cs = getComputedStyle(el);
    let s = '';
    for (const p of cs) s += p + ':' + cs.getPropertyValue(p) + ';';
    return s;
  };
  return Array.from(document.querySelectorAll('.harness *')).map(snap);
}

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

// Interactive/JS-state showcase: one element per rule that the component fixtures never put
// into the needed state. Attribute/class states (.active, .disabled, :checked, :disabled,
// .processing-state, .htmx-indicator, ...) are baked into the markup; the pure :hover rules
// are driven separately via CDP (`hover` below). Comma-list selectors like `:active, .active`
// are satisfied by the class branch, so only genuine :hover needs forcing.
const STATES = `
  <input type="radio" class="video-option-radio" checked>
  <div class="video-option">video option (hover target + checked sibling)</div>
  <div class="card"><div class="card-header">header</div><div class="card-body">body</div></div>
  <button class="connect-btn disabled btn-danger">connect disabled danger</button>
  <input class="search-input" placeholder="search">
  <div class="htmx-indicator">indicator</div>
  <div class="no-transition">no transition</div>
  <button class="btn punk-btn">punk</button>
  <button class="btn sync-btn">sync</button>
  <button class="btn punk-btn active">punk active</button>
  <button class="btn sync-btn active">sync active</button>
  <button class="btn btn-primary punk-btn">primary punk</button>
  <button class="btn btn-primary sync-btn">primary sync</button>
  <button class="btn btn-primary punk-btn active">primary punk active</button>
  <button class="btn btn-primary sync-btn active">primary sync active</button>
  <button class="btn btn-primary punk-btn processing-state"><span class="spinner-border"></span>processing</button>
  <button class="btn btn-secondary">secondary</button>
  <button class="btn btn-secondary punk-btn">secondary punk</button>
  <button class="btn btn-secondary sync-btn">secondary sync</button>
  <button class="btn btn-secondary punk-btn active">secondary punk active</button>
  <button class="btn btn-secondary sync-btn active">secondary sync active</button>
  <button class="btn btn-outline-success sync-btn">os sync</button>
  <button class="btn btn-outline-success sync-btn active">os sync active</button>
  <button class="btn btn-outline-success sync-btn disabled">os sync disabled</button>
  <button class="btn btn-outline-primary">outline primary</button>
  <button class="btn btn-outline-primary active">outline primary active</button>
  <button class="btn btn-outline-primary btn-sm">outline primary sm</button>
  <button class="btn btn-outline-primary btn-sm disabled">outline primary sm disabled</button>`;

// Each target's DOM is rendered in the SAME structure the visual tests use; dialogs are
// opened with showModal() (top layer + :modal) so modal-only rules get exercised, and `hover`
// forces :hover on its base elements via CDP. Coverage is a strict superset of tests/visual/*
// plus every interactive state, so anything flagged redundant here is provably safe.
// `open` = element ids to showModal(); `hover` = selectors whose elements get forced :hover.
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
  {
    name: 'states',
    body: STATES,
    open: [],
    hover: ['.video-option', '.punk-btn', '.sync-btn', '.btn-secondary', '.btn-outline-primary'],
  },
];

// Force :hover on every element matching `selectors`, via the same DevTools protocol call the
// "force element state" checkboxes use. nodeIds are document-scoped, so this re-fetches per page.
const cdp = await page.context().newCDPSession(page);
await cdp.send('DOM.enable');
await cdp.send('CSS.enable');
async function forceHover(selectors) {
  const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
  for (const sel of selectors) {
    const { nodeIds } = await cdp.send('DOM.querySelectorAll', {
      nodeId: root.nodeId,
      selector: sel,
    });
    for (const nodeId of nodeIds) {
      await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['hover'] });
    }
  }
}

// Render one target into the page under the given stylesheet, in its tested state (dialogs
// opened, :hover forced). Shared so the analysis pass and the before/after snapshot pass set
// up identical DOM - the diff is then attributable solely to the stylesheet change.
async function renderTarget(style, { body, open, hover }) {
  await page.setContent(wrapWith(style, body), { waitUntil: 'load' });
  if (open.length) {
    await page.evaluate((ids) => {
      for (const id of ids) {
        const d = document.getElementById(id);
        if (d && typeof d.showModal === 'function') d.showModal();
      }
    }, open);
  }
  if (hover) await forceHover(hover);
}
// Keyframe animations make getComputedStyle time-varying, so two renders of identical CSS
// would diff on animation frame alone. Freeze them (appended last so it wins) - applied to
// before AND after identically, so real base-style regressions still surface. Transitions
// need no trigger during a static snapshot, so they stay live.
const ANIM_OFF = '\n*,*::before,*::after{animation:none !important;}';
const snapshotAll = async (style) => {
  const out = {};
  for (const t of targets) {
    await renderTarget(style + ANIM_OFF, t);
    out[t.name] = await page.evaluate(snapshotInPage);
  }
  return out;
};

const agg = new Map();
for (const t of targets) {
  await renderTarget(STYLE, t);
  const { results: res, diag } = await page.evaluate(analyzeInPage);
  console.log(`[${t.name}] diag:`, JSON.stringify(diag), '| results:', res.length);
  for (const r of res) {
    const key = r.selector + ' ||| ' + r.prop;
    const cur = agg.get(key) || { ...r, matched: 0, changed: false, inMedia: false };
    cur.matched += r.matched;
    cur.changed = cur.changed || r.changed;
    cur.inMedia = cur.inMedia || r.inMedia;
    agg.set(key, cur);
  }
}

const all = [...agg.values()];
const removable = all.filter((x) => x.matched > 0 && !x.changed && !x.inMedia);
const loadBearing = all.filter((x) => x.changed);
const unmatched = all.filter((x) => x.matched === 0 && !x.changed);
const mediaKept = all.filter((x) => x.inMedia && !x.changed && x.matched > 0);

// Render-analysis only proves "not rendered in THESE states", not "renders nowhere". To tell
// genuinely-dead CSS from state-gated rules (:hover/:disabled/error views the fixtures don't
// trigger), cross-reference every never-rendered selector against the codebase: a class/id
// token referenced NOWHERE in templates/JS/TS can never match, so its whole rule is dead.
const readAll = (dir, exts, acc = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) {
      if (e.name !== 'node_modules' && e.name !== 'dist') readAll(p, exts, acc);
    } else if (exts.some((x) => e.name.endsWith(x))) {
      acc.push(fs.readFileSync(p, 'utf8'));
    }
  }
  return acc;
};
const haystack = [
  ...readAll('views', ['.ejs', '.html']),
  ...readAll('public', ['.js', '.html']), // .js/.html only - never style.css itself
  ...readAll('src', ['.ts']),
].join('\n');
const esc = (t) => t.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
const referenced = (token) => new RegExp(`\\b${esc(token)}\\b`).test(haystack);
// .class / #id tokens only; element names, pseudos, attrs and combinators are state, not identity.
const identTokens = (sel) => (sel.match(/[.#][A-Za-z0-9_-]+/g) || []).map((t) => t.slice(1));
const deadSelector = (sel) => {
  const toks = identTokens(sel);
  return toks.length > 0 && toks.some((t) => !referenced(t));
};
const unmatchedSelectors = [...new Set(unmatched.map((x) => x.selector))];
const dead = unmatchedSelectors.filter(deadSelector);
const stateGated = unmatchedSelectors.filter((s) => !deadSelector(s));

console.log('distinct (selector,property) !important entries:', all.length);
console.log('  LOAD-BEARING (keep):', loadBearing.length);
console.log('  REDUNDANT on rendered components (removable):', removable.length);
console.log(
  '  UNMATCHED / never rendered:',
  unmatched.length,
  `(${unmatchedSelectors.length} selectors)`,
);
console.log('    └ DEAD (class/id referenced nowhere - whole rule removable):', dead.length);
console.log(
  '    └ state-gated (class exists, needs :hover/:disabled/unrendered view):',
  stateGated.length,
);
console.log('  @media-nested unchanged (keep, conservative):', mediaKept.length);
console.log('\n--- NEVER-RENDERED selectors classified as DEAD (mystery CSS) ---');
dead.forEach((s) => console.log(`  ${s}`));
console.log('\n--- NEVER-RENDERED selectors that are state-gated (kept) ---');
stateGated.forEach((s) => console.log(`  ${s}`));
console.log('\n--- REMOVABLE (selector | property) ---');
removable.forEach((x) => console.log(`${x.selector}  |  ${x.prop}`));

if (!APPLY) {
  console.log('\nRead-only audit. Re-run with --apply to strip the redundant !important.');
  await browser.close();
} else {
  // Strip the !important flag from exactly the (selector,prop) pairs in `removeSet`, via postcss
  // (comments/sections/formatting preserved). Canonicalise selectors so the browser's
  // selectorText matches the source spelling.
  const norm = (s) =>
    s
      .replace(/\s+/g, ' ')
      .replace(/\s*([>+~,])\s*/g, '$1')
      .trim();
  const keyOf = (r) => norm(r.selector) + '|' + r.prop.toLowerCase();
  const styleWithout = (removeSet) => {
    const root = postcss.parse(STYLE);
    let removed = 0;
    root.walkRules((rule) => {
      if (rule.parent && rule.parent.type === 'atrule') return; // @media kept conservative
      rule.walkDecls((decl) => {
        if (!decl.important) return;
        if (removeSet.has(norm(rule.selector) + '|' + decl.prop.toLowerCase())) {
          decl.important = false;
          removed++;
        }
      });
    });
    return { css: root.toString(), removed };
  };
  // Measure the harness's own noise floor: snapshot identical CSS twice and mark any element
  // that disagrees with itself (residual animation/timing jitter ANIM_OFF doesn't fully still).
  // Those elements are excluded from the diff so only REPRODUCIBLE regressions count - otherwise
  // jitter would make the greedy's accept/reject non-deterministic.
  const before = await snapshotAll(STYLE);
  const before2 = await snapshotAll(STYLE);
  const noisy = {};
  for (const name of Object.keys(before)) {
    noisy[name] = new Set();
    const [a, b] = [before[name], before2[name]];
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) noisy[name].add(i);
  }
  const noiseFloor = Object.values(noisy).reduce((n, s) => n + s.size, 0);
  if (noiseFloor) console.log(`noise floor: ${noiseFloor} unstable element(s) excluded from diff.`);
  const diffCount = (a, b) => {
    let d = 0;
    for (const name of Object.keys(a)) {
      const [x, y] = [a[name], b[name]];
      for (let i = 0; i < x.length; i++) if (x[i] !== y[i] && !noisy[name].has(i)) d++;
    }
    return d;
  };

  // The per-declaration toggle proves each flag is redundant IN ISOLATION, but flags that
  // compete on the same element/property can be jointly necessary (drop one and another
  // !important still wins; drop both and a lower rule takes over). So instead of removing the
  // whole candidate set, find the MAXIMAL jointly-safe subset: try all at once, and if that
  // perturbs any computed style, fall back to a greedy pass that commits a removal only while
  // the full before/after diff (every element, every forced state) stays at zero.
  const keys = [...new Set(removable.map(keyOf))];
  let committed = new Set(keys);
  if (diffCount(before, await snapshotAll(styleWithout(committed).css)) > 0) {
    console.log('\njoint conflicts detected - resolving to the maximal jointly-safe subset...');
    committed = new Set();
    for (const k of keys) {
      const trial = new Set(committed).add(k);
      if (diffCount(before, await snapshotAll(styleWithout(trial).css)) === 0) committed = trial;
    }
  }

  const { css: finalCss, removed } = styleWithout(committed);
  const finalDiff = diffCount(before, await snapshotAll(finalCss));
  await browser.close();
  if (finalDiff > 0) {
    console.log(`\nREFUSED to write: ${finalDiff} residual computed-style differences.`);
    process.exitCode = 1;
  } else {
    fs.writeFileSync('public/css/style.css', finalCss);
    const heldBack = keys.length - committed.size;
    console.log(
      `\nverified: 0 computed-style changes across all tested states (incl. forced :hover).` +
        `\napplied: stripped !important from ${removed} declarations` +
        (heldBack ? `; kept ${heldBack} that are only jointly necessary.` : '.'),
    );
  }
}
