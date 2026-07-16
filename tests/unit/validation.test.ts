/**
 * Unit tests for validation schemas.
 *
 * The schemas are built once, as the module loads. Imported at the top of this file that happens
 * before any test runs, so every regex and bound in them belongs to no test - stryker calls those
 * mutants static, and with ignoreStatic on it does not score them at all. 44 of them, which is
 * every rule in the file: the length of a YouTube id, what a batch size may be, the bounds on a
 * name. They were being asserted here and credited to nothing.
 *
 * Loading the module inside a test instead puts the construction in that test's coverage, so the
 * rules are measured by the assertions that already existed.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { schemas as Schemas } from '@/lib/validation';

let schemas: typeof Schemas;

beforeEach(async () => {
  vi.resetModules();
  ({ schemas } = await import('@/lib/validation'));
});

describe('Validation Schemas', () => {
  describe('spotifyPlaylistId', () => {
    it('should accept valid Spotify playlist IDs', () => {
      const validIds = [
        '37i9dQZF1DXcBWIGoYBM5M',
        '3cEYpjA9oz9GiPac4AsH4n',
        '5ABHKGoOzxkaa28ttQV9sE',
      ];

      validIds.forEach((id) => {
        expect(() => schemas.spotifyPlaylistId.parse(id)).not.toThrow();
      });
    });

    it('should reject invalid Spotify playlist IDs', () => {
      const invalidIds = [
        '',
        'too-short',
        '12345', // too short
        'contains spaces here',
        'contains-dashes-here',
        'contains_underscores_here',
      ];

      invalidIds.forEach((id) => {
        expect(() => schemas.spotifyPlaylistId.parse(id)).toThrow();
      });
    });
  });

  describe('youtubePlaylistId', () => {
    it('should accept valid YouTube playlist IDs', () => {
      const validIds = [
        'PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf',
        'PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI',
        'PL9tY0BWXOZFuFEG_GtOBZ8-8wbkH-NVAr',
        'PL1234567890_-', // 13+ chars with dashes and underscores
      ];

      validIds.forEach((id) => {
        expect(() => schemas.youtubePlaylistId.parse(id)).not.toThrow();
      });
    });

    it('should reject invalid YouTube playlist IDs', () => {
      const invalidIds = [
        '',
        'too-short', // less than 13 chars
        '12345', // less than 13 chars
        'contains spaces here', // spaces not allowed
        'special!chars', // special chars not allowed
      ];

      invalidIds.forEach((id) => {
        expect(() => schemas.youtubePlaylistId.parse(id)).toThrow();
      });
    });
  });

  describe('youtubeVideoId', () => {
    it('should accept valid YouTube video IDs', () => {
      const validIds = [
        'dQw4w9WgXcQ',
        'jNQXAC9IVRw',
        '9bZkp7q19f0',
        '12345678_-0', // exactly 11 chars with underscores and dashes
      ];

      validIds.forEach((id) => {
        expect(() => schemas.youtubeVideoId.parse(id)).not.toThrow();
      });
    });

    it('should reject invalid YouTube video IDs', () => {
      const invalidIds = [
        '',
        'short', // less than 11 chars
        'toolongvidid', // more than 11 chars
        'has spaces!', // spaces not allowed (and wrong length)
        'special!chr', // special chars not allowed
      ];

      invalidIds.forEach((id) => {
        expect(() => schemas.youtubeVideoId.parse(id)).toThrow();
      });
    });
  });

  describe('batchSize', () => {
    it('should accept any positive integer', () => {
      const validSizes = ['1', '10', '25', '50', '100', '999', '1000'];

      validSizes.forEach((size) => {
        expect(() => schemas.batchSize.parse(size)).not.toThrow();
      });
    });

    it('should accept the special value "all"', () => {
      expect(() => schemas.batchSize.parse('all')).not.toThrow();
      expect(schemas.batchSize.parse('all')).toBe('all');
    });

    it('should reject invalid batch sizes', () => {
      const invalidSizes = [
        '0', // zero not allowed
        '-1', // negative not allowed
        '-50', // negative not allowed
        'invalid', // non-numeric (except 'all')
        '', // empty string
        '12.5', // decimals not allowed
        '1a', // alphanumeric not allowed
        'a1', // alphanumeric not allowed
      ];

      invalidSizes.forEach((size) => {
        expect(() => schemas.batchSize.parse(size)).toThrow();
      });
    });

    it('should transform positive integers to string format', () => {
      // The schema accepts numeric strings and transforms them appropriately
      const result = schemas.batchSize.parse('25');
      expect(result).toBe('25');
      expect(typeof result).toBe('string');
    });

    it('should accept the preset options from the UI dropdown', () => {
      // These are the current preset options in the UI
      const presetOptions = ['10', '25', '50', '100', 'all'];

      presetOptions.forEach((option) => {
        expect(() => schemas.batchSize.parse(option)).not.toThrow();
      });
    });
  });

  describe('trackName', () => {
    it('should accept valid track names', () => {
      const validNames = [
        'a',
        'Never Gonna Give You Up',
        'Song with (parentheses) and "quotes"',
        'a'.repeat(200), // max length
      ];

      validNames.forEach((name) => {
        expect(() => schemas.trackName.parse(name)).not.toThrow();
      });
    });

    it('should reject invalid track names', () => {
      const invalidNames = [
        '',
        'a'.repeat(201), // too long
      ];

      invalidNames.forEach((name) => {
        expect(() => schemas.trackName.parse(name)).toThrow();
      });
    });
  });

  describe('artistName', () => {
    it('should accept valid artist names', () => {
      const validNames = [
        'Rick Astley',
        'The Beatles',
        'a'.repeat(200), // max length
      ];

      validNames.forEach((name) => {
        expect(() => schemas.artistName.parse(name)).not.toThrow();
      });
    });

    it('should reject invalid artist names', () => {
      const invalidNames = [
        '',
        'a'.repeat(201), // too long
      ];

      invalidNames.forEach((name) => {
        expect(() => schemas.artistName.parse(name)).toThrow();
      });
    });
  });

  describe('booleanFlag', () => {
    it('should accept "true" and transform to boolean true', () => {
      const result = schemas.booleanFlag.parse('true');
      expect(result).toBe(true);
      expect(typeof result).toBe('boolean');
    });

    it('should accept "false" and transform to boolean false', () => {
      const result = schemas.booleanFlag.parse('false');
      expect(result).toBe(false);
      expect(typeof result).toBe('boolean');
    });

    it('should reject invalid boolean strings', () => {
      const invalidValues = ['1', '0', 'yes', 'no', 'TRUE', 'FALSE', '', 'null'];

      invalidValues.forEach((value) => {
        expect(() => schemas.booleanFlag.parse(value)).toThrow();
      });
    });

    it('should ensure transformed boolean can be compared with === true/false', () => {
      // This test ensures the bug we fixed doesn't regress
      // The bug was: req.query.ownOnly === 'true' (string comparison)
      // Should be: req.query.ownOnly === true (boolean comparison)

      const trueResult = schemas.booleanFlag.parse('true');
      const falseResult = schemas.booleanFlag.parse('false');

      // These should work (correct comparison)
      expect(trueResult === true).toBe(true);
      expect(falseResult === false).toBe(true);

      // The bug this describes - comparing the parsed flag to the STRING 'true' - could never
      // match, because the schema hands back a boolean. Assert that, rather than re-asserting
      // that a boolean is not a string.
      expect(typeof trueResult).toBe('boolean');
      expect(typeof falseResult).toBe('boolean');
    });
  });

  /**
   * The ^ and $ anchors are the difference between "is exactly this" and "contains this". Drop
   * either and the regex matches a substring, so an id with a valid core wrapped in junk - or one
   * simply too long - passes validation and reaches the API as a malformed request the app thought
   * it had rejected. The existing reject cases used bad characters, which fail with or without the
   * anchors; these use only valid characters, in the wrong length or position.
   */
  describe('the id regexes are anchored, not substring matches', () => {
    const valid22 = 'a'.repeat(22);
    const validYtVideo = 'a'.repeat(11);
    const validYtPlaylist = 'a'.repeat(13);

    it.each([
      ['spotifyPlaylistId', () => schemas.spotifyPlaylistId, valid22],
      ['youtubeVideoId', () => schemas.youtubeVideoId, validYtVideo],
    ])('%s rejects a valid core with trailing valid characters ($ anchor)', (_l, get, core) => {
      expect(() => get().parse(core + 'a')).toThrow();
    });

    it.each([
      ['spotifyPlaylistId', () => schemas.spotifyPlaylistId, valid22],
      ['youtubeVideoId', () => schemas.youtubeVideoId, validYtVideo],
      ['youtubePlaylistId', () => schemas.youtubePlaylistId, validYtPlaylist],
    ])('%s rejects a valid core with a newline after it', (_l, get, core) => {
      // A trailing newline is the classic $-anchor bypass: without $, `{n}$` becomes `{n}` and the
      // first n chars of "core\njunk" match. youtubePlaylistId is {13,}, so length can't catch its
      // $ drop - only trailing junk can.
      expect(() => get().parse(core + '\nInvalid request data')).toThrow();
    });

    it('youtubePlaylistId (13+) rejects a leading junk char before a valid tail (^ anchor)', () => {
      // This one is open-ended (13 OR MORE), so length alone cannot catch a ^ drop; a leading
      // space in front of an otherwise valid id is what does.
      expect(() => schemas.youtubePlaylistId.parse(' ' + validYtPlaylist)).toThrow();
    });

    it('accepts the exact-length valid ids, so the anchors are not just rejecting everything', () => {
      expect(schemas.spotifyPlaylistId.parse(valid22)).toBe(valid22);
      expect(schemas.youtubeVideoId.parse(validYtVideo)).toBe(validYtVideo);
      expect(schemas.youtubePlaylistId.parse(validYtPlaylist)).toBe(validYtPlaylist);
    });
  });
});

/**
 * The middleware, which nothing exercised. It replaces req.params/query/body with the schema's
 * PARSED value - which is not the same object: batchSize turns '3' into a string it re-formats,
 * booleanFlag turns 'true' into a real boolean. A handler reads the validated value expecting the
 * transform to have happened; if the middleware wrote to the wrong key or skipped the assignment,
 * the handler silently sees the raw request instead.
 */
describe('the validate() middleware', () => {
  let validate: typeof import('@/lib/validation').validate;
  let z: typeof import('zod').z;

  beforeEach(async () => {
    vi.resetModules();
    ({ validate } = await import('@/lib/validation'));
    ({ z } = await import('zod'));
  });

  const run = async (
    schema: Parameters<typeof validate>[0],
    req: { params?: unknown; query?: unknown; body?: unknown; path?: string },
  ) => {
    const res = {
      statusCode: 200,
      rendered: undefined as unknown,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      render(_view: string, data: unknown) {
        this.rendered = data;
        return this;
      },
    };
    let nexted = false;
    // req.query/params are getters on a real Request; a plain object lets defineProperty stand in.
    const reqObj = { path: '/x', ...req } as never;
    await validate(schema)(reqObj, res as never, () => {
      nexted = true;
    });
    return { res, nexted, reqObj: reqObj as Record<string, unknown> };
  };

  it('writes the parsed value back, transform and all', async () => {
    const { nexted, reqObj } = await run(
      { query: z.object({ ownOnly: z.enum(['true', 'false']).transform((v) => v === 'true') }) },
      { query: { ownOnly: 'true' } },
    );

    expect(nexted).toBe(true);
    // The handler must see a real boolean, not the string it arrived as.
    expect((reqObj.query as { ownOnly: boolean }).ownOnly).toBe(true);
  });

  // Each slot is written to its own key: a handler reading req.params.id must get the parsed
  // params, not the parsed body, and vice versa. setValidated writing the wrong key name would
  // leave the real slot holding the raw request.
  it('writes each of params, query and body back to its own key', async () => {
    const idSchema = z.object({ v: z.string().transform((s) => `parsed:${s}`) });
    const { reqObj } = await run(
      { params: idSchema, query: idSchema, body: idSchema },
      { params: { v: 'p' }, query: { v: 'q' }, body: { v: 'b' } },
    );

    expect((reqObj.params as { v: string }).v).toBe('parsed:p');
    expect((reqObj.query as { v: string }).v).toBe('parsed:q');
    expect((reqObj.body as { v: string }).v).toBe('parsed:b');
  });

  it('400s with the field and message when validation fails, and does not call next', async () => {
    const { res, nexted } = await run(
      { params: z.object({ id: z.string().min(5, 'too short') }) },
      { params: { id: 'ab' } },
    );

    expect(nexted).toBe(false);
    expect(res.statusCode).toBe(400);
    expect((res.rendered as { details: string }).details).toContain('id: too short');
  });

  it('passes an unexpected non-Zod error to the error handler rather than rendering a 400', async () => {
    const exploding = {
      parse() {
        throw new Error('not a zod error');
      },
    } as never;

    let passed: unknown;
    const res = { status: () => res, render: () => res } as never;
    await validate({ body: exploding })({ path: '/x', body: {} } as never, res, (err?: unknown) => {
      passed = err;
    });

    expect(passed).toBeInstanceOf(Error);
    expect((passed as Error).message).toBe('not a zod error');
  });
});
