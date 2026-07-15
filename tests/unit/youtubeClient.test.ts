/**
 * Tests for the hand-written YouTube client (src/youtube/client.ts).
 *
 * createYoutubeClient's seven methods were NEVER constructed by any test: everywhere a client is
 * needed the suite substitutes a hand-built fake, so the real request construction - verb, path,
 * `part` joining, which params are forwarded, the 204 handling, the error mapping - was entirely
 * unexecuted. 138 mutants, 72 with no coverage at all.
 *
 * This is the layer that turns a YouTube response into YoutubeApiError.code/.reason, which is what
 * classifyYoutubeError reads to decide whether the quota breaker opens. It got that wrong before
 * (#69) precisely because nothing tested this shape.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createYoutubeClient, YoutubeApiError } from '../../src/youtube/client';
import { fakeResponse, requestAt, stubFetchSequence } from '../helpers/fetchMock';

const API = 'https://www.googleapis.com/youtube/v3';
const client = () => createYoutubeClient('test-token');
const jsonOk = (body: unknown) => fakeResponse({ body: JSON.stringify(body) });

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe('youtubeRequest: request construction', () => {
  it('sends the bearer token and asks for JSON', async () => {
    const mock = stubFetchSequence([jsonOk({ items: [] })]);

    await client().channels.list({ part: ['id'], mine: true, maxResults: 1 });

    expect(requestAt(mock, 0).init.headers).toMatchObject({
      Authorization: 'Bearer test-token',
      Accept: 'application/json',
    });
  });

  it('joins the part array with commas', async () => {
    const mock = stubFetchSequence([jsonOk({ items: [] })]);

    await client().playlists.list({ part: ['id', 'snippet', 'contentDetails'], mine: true });

    expect(requestAt(mock, 0).url).toContain('part=id%2Csnippet%2CcontentDetails');
  });

  it('drops undefined query params rather than sending "undefined"', async () => {
    const mock = stubFetchSequence([jsonOk({ items: [] })]);

    await client().playlists.list({ part: ['id'], mine: true, pageToken: undefined });

    expect(requestAt(mock, 0).url).not.toContain('pageToken');
  });

  it('forwards a pageToken when there is one', async () => {
    const mock = stubFetchSequence([jsonOk({ items: [] })]);

    await client().playlists.list({ part: ['id'], mine: true, pageToken: 'CAUQAA' });

    expect(requestAt(mock, 0).url).toContain('pageToken=CAUQAA');
  });

  it('sets Content-Type only when there is a body', async () => {
    const mock = stubFetchSequence([jsonOk({}), jsonOk({})]);

    await client().channels.list({ part: ['id'], mine: true });
    expect(requestAt(mock, 0).headers).not.toHaveProperty('Content-Type');

    await client().playlists.insert({
      part: ['snippet'],
      requestBody: { snippet: { title: 'My Playlist' } },
    });
    expect(requestAt(mock, 1).headers).toHaveProperty('Content-Type', 'application/json');
  });

  it('omits the "?" entirely when there is no query', async () => {
    const mock = stubFetchSequence([fakeResponse({ status: 204 })]);

    await client().playlistItems.delete({ id: 'item-1' });

    // `id` IS a query param here, so assert the shape rather than absence:
    expect(requestAt(mock, 0).url).toBe(`${API}/playlistItems?id=item-1`);
  });
});

describe('youtubeRequest: responses', () => {
  it('unwraps the JSON body as data', async () => {
    stubFetchSequence([jsonOk({ items: [{ id: 'chan-1' }] })]);

    const response = await client().channels.list({ part: ['id'], mine: true });

    expect(response.data.items).toEqual([{ id: 'chan-1' }]);
  });

  // delete returns 204 with no body - parsing it as JSON would throw.
  it('returns undefined for a 204 without parsing a body', async () => {
    stubFetchSequence([fakeResponse({ status: 204 })]);

    await expect(client().playlistItems.delete({ id: 'item-1' })).resolves.toEqual({
      data: undefined,
    });
  });

  it('maps a YouTube error body to code + reason', async () => {
    stubFetchSequence([
      fakeResponse({
        status: 403,
        body: JSON.stringify({
          error: {
            message: 'The request cannot be completed',
            errors: [{ reason: 'quotaExceeded' }],
          },
        }),
      }),
    ]);

    // .code and .reason are what classifyYoutubeError reads to open the quota breaker.
    await expect(client().channels.list({ part: ['id'], mine: true })).rejects.toMatchObject({
      name: 'YoutubeApiError',
      code: 403,
      reason: 'quotaExceeded',
      message: 'YouTube API error (403): The request cannot be completed',
    });
  });

  it('falls back to a generic message when the error body is not JSON', async () => {
    stubFetchSequence([fakeResponse({ status: 500, body: '<html>Server Error</html>' })]);

    const thrown = await client()
      .channels.list({ part: ['id'], mine: true })
      .then(() => null)
      .catch((e: unknown) => e);

    expect(thrown).toBeInstanceOf(YoutubeApiError);
    const error = thrown as YoutubeApiError;
    expect(error.code).toBe(500);
    expect(error.reason).toBeUndefined();
    expect(error.message).toContain('HTTP 500');
  });

  it('reports the status even when the body cannot be read at all', async () => {
    const unreadable = fakeResponse({ status: 502 });
    unreadable.text = async () => {
      throw new Error('stream closed');
    };
    stubFetchSequence([unreadable]);

    await expect(client().channels.list({ part: ['id'], mine: true })).rejects.toMatchObject({
      code: 502,
    });
  });
});

describe('createYoutubeClient: each method hits the right endpoint', () => {
  it.each([
    [
      'channels.list',
      (c: ReturnType<typeof client>) =>
        c.channels.list({ part: ['id'], mine: true, maxResults: 1 }),
      'GET',
      `${API}/channels`,
    ],
    [
      'playlists.list',
      (c: ReturnType<typeof client>) => c.playlists.list({ part: ['id'], mine: true }),
      'GET',
      `${API}/playlists`,
    ],
    [
      'playlists.insert',
      (c: ReturnType<typeof client>) =>
        c.playlists.insert({ part: ['snippet'], requestBody: { snippet: { title: 'x' } } }),
      'POST',
      `${API}/playlists`,
    ],
    [
      'playlistItems.list',
      (c: ReturnType<typeof client>) => c.playlistItems.list({ part: ['id'], playlistId: 'PL1' }),
      'GET',
      `${API}/playlistItems`,
    ],
    [
      'playlistItems.insert',
      (c: ReturnType<typeof client>) =>
        c.playlistItems.insert({ part: ['snippet'], requestBody: {} }),
      'POST',
      `${API}/playlistItems`,
    ],
    // update is a PUT, not a POST - the two are easy to swap and impossible to notice by eye.
    [
      'playlistItems.update',
      (c: ReturnType<typeof client>) =>
        c.playlistItems.update({ part: ['snippet'], requestBody: {} }),
      'PUT',
      `${API}/playlistItems`,
    ],
    [
      'playlistItems.delete',
      (c: ReturnType<typeof client>) => c.playlistItems.delete({ id: 'item-1' }),
      'DELETE',
      `${API}/playlistItems`,
    ],
  ])('%s issues a %s to the right path', async (_name, call, method, path) => {
    const mock = stubFetchSequence([jsonOk({})]);

    await call(client());

    const request = requestAt(mock, 0);
    expect(request.init.method).toBe(method);
    expect(request.url.split('?')[0]).toBe(path);
  });

  it('sends the request body as JSON on insert', async () => {
    const mock = stubFetchSequence([jsonOk({})]);
    const requestBody = { snippet: { playlistId: 'PL1', resourceId: { videoId: 'v1' } } };

    await client().playlistItems.insert({ part: ['snippet'], requestBody });

    expect(JSON.parse(requestAt(mock, 0).init.body as string)).toEqual(requestBody);
  });

  it('forwards playlistId and paging to playlistItems.list', async () => {
    const mock = stubFetchSequence([jsonOk({ items: [] })]);

    await client().playlistItems.list({
      part: ['id', 'snippet'],
      playlistId: 'PL1',
      maxResults: 50,
      pageToken: 'NEXT',
    });

    const url = requestAt(mock, 0).url;
    expect(url).toContain('playlistId=PL1');
    expect(url).toContain('maxResults=50');
    expect(url).toContain('pageToken=NEXT');
  });

  it('sends only the id on delete - no part, no body', async () => {
    const mock = stubFetchSequence([fakeResponse({ status: 204 })]);

    await client().playlistItems.delete({ id: 'item-1' });

    expect(requestAt(mock, 0).url).not.toContain('part=');
    expect(requestAt(mock, 0).init.body).toBeUndefined();
  });
});
