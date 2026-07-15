/**
 * Tests for src/youtube/scraper.ts.
 *
 * This module BROKE IN PRODUCTION (2026-07-14): Google's /sorry/ bot gate hands back a
 * GOOGLE_ABUSE_EXEMPTION cookie and redirects to the clean URL; a stateless fetch dropped it, so
 * the clean URL was un-exempted and bounced straight back - "redirected more than 5 times", every
 * search dead. It was fixed with a cookie jar and had NO tests then and none since: mutation
 * testing found 248 survivors, 235 of them never executed by anything.
 *
 * Everywhere the scraper appears in other tests it is vi.mock'd away, so the fix was never pinned.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  __resetCookieJar,
  parseSearchResultsHtml,
  scrapeYouTubeSearch,
  searchAndScoreVideos,
  searchMusicVideo,
} from '../../src/youtube/scraper';
import { fakeResponse, redirectResponse, requestAt, stubFetchSequence } from '../helpers/fetchMock';

/** A results page shaped the way YouTube serves one: results as JSON inside a script tag. */
function ytHtml(videoRenderers: unknown[]): string {
  const data = {
    contents: {
      twoColumnSearchResultsRenderer: {
        primaryContents: {
          sectionListRenderer: {
            contents: [{ itemSectionRenderer: { contents: videoRenderers } }],
          },
        },
      },
    },
  };
  return `<html><body><script>var ytInitialData = ${JSON.stringify(data)};</script></body></html>`;
}

const videoRenderer = (over: Record<string, unknown> = {}) => ({
  videoRenderer: {
    videoId: 'abc123',
    title: { runs: [{ text: 'Radiohead - Creep' }] },
    lengthText: { simpleText: '3:58' },
    viewCountText: { simpleText: '1.2M views' },
    longBylineText: { runs: [{ text: 'RadioheadVEVO' }] },
    ...over,
  },
});

beforeEach(() => {
  vi.restoreAllMocks();
  __resetCookieJar();
});

afterEach(() => {
  vi.unstubAllGlobals();
  __resetCookieJar();
});

describe('parseSearchResultsHtml', () => {
  it('extracts a video from a results page', () => {
    const results = parseSearchResultsHtml(ytHtml([videoRenderer()]), 3);

    expect(results).toEqual([
      {
        videoId: 'abc123',
        title: 'Radiohead - Creep',
        duration: '3:58',
        views: '1.2M views',
        channel: 'RadioheadVEVO',
      },
    ]);
  });

  it('caps the results at maxResults', () => {
    const html = ytHtml([
      videoRenderer({ videoId: 'a' }),
      videoRenderer({ videoId: 'b' }),
      videoRenderer({ videoId: 'c' }),
    ]);

    expect(parseSearchResultsHtml(html, 2).map((r) => r.videoId)).toEqual(['a', 'b']);
  });

  it('prefers longBylineText over ownerText for the channel', () => {
    const html = ytHtml([
      videoRenderer({
        longBylineText: { runs: [{ text: 'The Real Channel' }] },
        ownerText: { runs: [{ text: 'Fallback Channel' }] },
      }),
    ]);

    expect(parseSearchResultsHtml(html, 3)[0]!.channel).toBe('The Real Channel');
  });

  it('falls back to ownerText when longBylineText is absent', () => {
    const html = ytHtml([
      videoRenderer({ longBylineText: undefined, ownerText: { runs: [{ text: 'Fallback' }] } }),
    ]);

    expect(parseSearchResultsHtml(html, 3)[0]!.channel).toBe('Fallback');
  });

  it.each([
    ['channel', { longBylineText: undefined, ownerText: undefined }, 'channel', 'Unknown Channel'],
    ['title', { title: undefined }, 'title', 'Unknown Title'],
    ['duration', { lengthText: undefined }, 'duration', 'Unknown Duration'],
    ['views', { viewCountText: undefined }, 'views', 'Unknown Views'],
  ])('falls back to a placeholder when %s is missing', (_label, over, field, expected) => {
    const results = parseSearchResultsHtml(ytHtml([videoRenderer(over)]), 3);

    expect(results[0]![field as keyof (typeof results)[0]]).toBe(expected);
  });

  it('reads a simpleText title when there are no runs', () => {
    const html = ytHtml([videoRenderer({ title: { simpleText: 'Plain Title' } })]);

    expect(parseSearchResultsHtml(html, 3)[0]!.title).toBe('Plain Title');
  });

  // An item with no videoId is unusable. It must not consume a maxResults slot either.
  it('skips items with no videoId without spending a result slot', () => {
    const html = ytHtml([
      videoRenderer({ videoId: undefined }),
      videoRenderer({ videoId: 'real' }),
    ]);

    expect(parseSearchResultsHtml(html, 1).map((r) => r.videoId)).toEqual(['real']);
  });

  it('skips entries that are not videos (ads, shelves, channels)', () => {
    const html = ytHtml([{ shelfRenderer: { title: 'People also watched' } }, videoRenderer()]);

    expect(parseSearchResultsHtml(html, 3)).toHaveLength(1);
  });

  it.each([
    ['a page with no script tags', '<html><body>nothing here</body></html>'],
    ['a script without the marker', '<html><script>var somethingElse = {};</script></html>'],
    ['malformed JSON', '<html><script>var ytInitialData = {not json};</script></html>'],
    [
      'the expected nesting missing',
      '<html><script>var ytInitialData = {"contents":{}};</script></html>',
    ],
    ['an empty page', ''],
  ])('returns no results for %s rather than throwing', (_label, html) => {
    expect(parseSearchResultsHtml(html, 3)).toEqual([]);
  });

  // The regex is /var ytInitialData = ({.*?});/ - `.` does not match newlines. A pretty-printed
  // page silently yields nothing. Pinned so a future "tidy up the regex" cannot pretend otherwise.
  it('does not find results when ytInitialData is pretty-printed across lines', () => {
    const html = `<html><script>var ytInitialData = {\n  "contents": {}\n};</script></html>`;

    expect(parseSearchResultsHtml(html, 3)).toEqual([]);
  });
});

describe('scrapeYouTubeSearch: the /sorry/ bot gate (production regression)', () => {
  const EXEMPTION = 'GOOGLE_ABUSE_EXEMPTION=abc123xyz';

  it('carries the exemption cookie from /sorry/ into the retried request', async () => {
    const mock = stubFetchSequence([
      redirectResponse('https://www.google.com/sorry/index?continue=youtube'),
      redirectResponse('https://www.youtube.com/results?search_query=creep', {
        setCookie: [
          `${EXEMPTION}; Domain=.google.com; Path=/; Expires=Tue, 15 Jul 2026 05:00:00 GMT`,
        ],
      }),
      fakeResponse({ body: ytHtml([videoRenderer()]) }),
    ]);

    const results = await scrapeYouTubeSearch('creep', 3);

    // It resolves rather than looping to "redirected more than 5 times".
    expect(results).toHaveLength(1);
    // THE assertion: the third request must carry the exemption the gate handed back. Against the
    // pre-fix stateless fetch this is absent and the clean URL bounces straight back to /sorry/.
    expect(requestAt(mock, 2).headers.Cookie).toContain(EXEMPTION);
    // ...and the seeded consent cookie is still there alongside it.
    expect(requestAt(mock, 2).headers.Cookie).toContain('SOCS=');
  });

  it('sends the seeded SOCS consent cookie on the very first request', async () => {
    const mock = stubFetchSequence([fakeResponse({ body: ytHtml([]) })]);

    await scrapeYouTubeSearch('creep', 3);

    expect(requestAt(mock, 0).headers.Cookie).toContain('SOCS=');
  });

  it('follows redirects manually so a bounce is visible', async () => {
    const mock = stubFetchSequence([
      redirectResponse('https://www.youtube.com/results?search_query=creep&retry=1'),
      fakeResponse({ body: ytHtml([videoRenderer()]) }),
    ]);

    await scrapeYouTubeSearch('creep', 3);

    expect(requestAt(mock, 0).init.redirect).toBe('manual');
  });

  it('gives up after 5 redirects and names the whole chain', async () => {
    stubFetchSequence([redirectResponse('https://www.google.com/sorry/index')]);

    // The error is re-wrapped by scrapeYouTubeSearch's catch-all.
    await expect(scrapeYouTubeSearch('creep', 3)).rejects.toThrow(/redirected more than 5 times/);
    await expect(scrapeYouTubeSearch('creep', 3)).rejects.toThrow(/sorry\/index/);
  });

  it('resolves a relative Location against the current URL', async () => {
    const mock = stubFetchSequence([
      redirectResponse('/results?search_query=creep&fixed=1'),
      fakeResponse({ body: ytHtml([]) }),
    ]);

    await scrapeYouTubeSearch('creep', 3);

    expect(requestAt(mock, 1).url).toBe(
      'https://www.youtube.com/results?search_query=creep&fixed=1',
    );
  });

  it('hands back a redirect with no Location instead of following it', async () => {
    stubFetchSequence([fakeResponse({ status: 302, statusText: 'Found' })]);

    // Not followable: it falls through to the !response.ok path and reports the status.
    await expect(scrapeYouTubeSearch('creep', 3)).rejects.toThrow(/HTTP 302/);
  });

  it('tolerates a runtime whose headers have no getSetCookie', async () => {
    stubFetchSequence([fakeResponse({ body: ytHtml([videoRenderer()]), noGetSetCookie: true })]);

    await expect(scrapeYouTubeSearch('creep', 3)).resolves.toHaveLength(1);
  });

  it('does not leak cookies between searches once the jar is reset', async () => {
    stubFetchSequence([
      redirectResponse('https://www.youtube.com/results', { setCookie: ['SESSION=leaky'] }),
      fakeResponse({ body: ytHtml([]) }),
    ]);
    await scrapeYouTubeSearch('creep', 3);

    __resetCookieJar();
    const mock = stubFetchSequence([fakeResponse({ body: ytHtml([]) })]);
    await scrapeYouTubeSearch('creep', 3);

    expect(requestAt(mock, 0).headers.Cookie).not.toContain('SESSION=leaky');
  });
});

describe('scrapeYouTubeSearch: requests and failures', () => {
  it('url-encodes the query', async () => {
    const mock = stubFetchSequence([fakeResponse({ body: ytHtml([]) })]);

    await scrapeYouTubeSearch('creep & other songs', 3);

    expect(requestAt(mock, 0).url).toBe(
      'https://www.youtube.com/results?search_query=creep%20%26%20other%20songs',
    );
  });

  it('reports the status when YouTube serves an error', async () => {
    stubFetchSequence([
      fakeResponse({ status: 429, statusText: 'Too Many Requests', body: 'slow down' }),
    ]);

    await expect(scrapeYouTubeSearch('creep', 3)).rejects.toThrow(/HTTP 429: Too Many Requests/);
  });

  it('wraps failures, keeping the original as the cause', async () => {
    const boom = new Error('socket hang up');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw boom;
      }),
    );

    await expect(scrapeYouTubeSearch('creep', 3)).rejects.toMatchObject({
      message: expect.stringContaining('Failed to scrape YouTube search: socket hang up'),
      cause: boom,
    });
  });
});

/**
 * searchAndScoreVideos / searchMusicVideo: the query ladder.
 *
 * These sleep 1s between queries, so fake timers are mandatory - otherwise the ladder alone takes
 * 4 seconds and would blow the 10s testTimeout. This whole area had zero coverage: every other
 * test in the repo vi.mock's these away.
 */
describe('searchAndScoreVideos', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** Run to completion, letting the 1s inter-query sleeps elapse. */
  async function runLadder<T>(work: Promise<T>): Promise<T> {
    const settled = work.finally(() => undefined);
    await vi.advanceTimersByTimeAsync(30_000);
    return settled;
  }

  const goodMatch = () =>
    videoRenderer({
      videoId: 'good',
      title: { runs: [{ text: 'Radiohead - Creep (Official Music Video)' }] },
      longBylineText: { runs: [{ text: 'RadioheadVEVO' }] },
    });

  it('returns on the first query that yields a match, without trying the rest', async () => {
    const mock = stubFetchSequence([fakeResponse({ body: ytHtml([goodMatch()]) })]);

    const results = await runLadder(searchAndScoreVideos('Radiohead', 'Creep'));

    expect(results).toHaveLength(1);
    expect(mock).toHaveBeenCalledTimes(1); // the ladder stopped at query 1
  });

  it('tries the most specific query first', async () => {
    const mock = stubFetchSequence([fakeResponse({ body: ytHtml([goodMatch()]) })]);

    await runLadder(searchAndScoreVideos('Radiohead', 'Creep'));

    expect(decodeURIComponent(requestAt(mock, 0).url)).toContain(
      '"Radiohead" "Creep" official music video',
    );
  });

  it('walks the whole ladder when nothing matches, then gives up', async () => {
    const mock = stubFetchSequence([fakeResponse({ body: ytHtml([]) })]);

    const results = await runLadder(searchAndScoreVideos('Radiohead', 'Creep'));

    expect(results).toEqual([]);
    expect(mock).toHaveBeenCalledTimes(5); // five queries, then done
  });

  it('discards results scoring below the 0.4 threshold', async () => {
    const unrelated = videoRenderer({
      videoId: 'nope',
      title: { runs: [{ text: 'Totally Different Cooking Tutorial' }] },
      longBylineText: { runs: [{ text: 'Some Chef' }] },
    });
    stubFetchSequence([fakeResponse({ body: ytHtml([unrelated]) })]);

    expect(await runLadder(searchAndScoreVideos('Radiohead', 'Creep'))).toEqual([]);
  });

  it('carries on to the next query when one throws', async () => {
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        call += 1;
        if (call === 1) throw new Error('socket hang up');
        return fakeResponse({ body: ytHtml([goodMatch()]) });
      }),
    );

    const results = await runLadder(searchAndScoreVideos('Radiohead', 'Creep'));

    expect(results).toHaveLength(1); // query 1 died, query 2 delivered
  });

  it('attaches the match score to what it returns', async () => {
    stubFetchSequence([fakeResponse({ body: ytHtml([goodMatch()]) })]);

    const results = await runLadder(searchAndScoreVideos('Radiohead', 'Creep'));

    expect(results[0]!.matchScore!.score).toBeGreaterThanOrEqual(0.4);
    expect(results[0]!.matchScore!.breakdown.components.coreMatch).toBe(0.6);
  });
});

describe('searchMusicVideo', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  async function runLadder<T>(work: Promise<T>): Promise<T> {
    const settled = work.finally(() => undefined);
    await vi.advanceTimersByTimeAsync(30_000);
    return settled;
  }

  it('returns the id of the highest-scoring video, not merely the first', async () => {
    const weaker = videoRenderer({
      videoId: 'weaker',
      title: { runs: [{ text: 'Creep' }] },
      longBylineText: { runs: [{ text: 'Some Uploader' }] },
    });
    const stronger = videoRenderer({
      videoId: 'stronger',
      title: { runs: [{ text: 'Radiohead - Creep (Official Music Video)' }] },
      longBylineText: { runs: [{ text: 'RadioheadVEVO' }] },
    });
    // Deliberately weakest-first: returning results[0] would pick the wrong one.
    stubFetchSequence([fakeResponse({ body: ytHtml([weaker, stronger]) })]);

    expect(await runLadder(searchMusicVideo('Radiohead', 'Creep'))).toBe('stronger');
  });

  it('returns null when nothing is found', async () => {
    stubFetchSequence([fakeResponse({ body: ytHtml([]) })]);

    expect(await runLadder(searchMusicVideo('Radiohead', 'Creep'))).toBeNull();
  });
});
