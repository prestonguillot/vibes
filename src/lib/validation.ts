import { Request, Response, NextFunction } from 'express';
import { z, ZodSchema, ZodError, ZodIssue } from 'zod';
import { Logger } from './logger';

/**
 * Extended Express Request type that includes validated and transformed data
 * Note: This is a utility type for documentation purposes.
 * Actual runtime typing depends on the middleware modifying req.params/query/body
 */
export interface ValidatedRequest<
  TParams = Record<string, string>,
  TQuery = Record<string, unknown>,
  TBody = Record<string, unknown>,
> extends Omit<Request, 'params' | 'query' | 'body'> {
  params: TParams;
  query: TQuery;
  body: TBody;
}

/**
 * Middleware factory for validating request data with Zod schemas
 * Validates params, query, and body based on provided schemas
 *
 * @example
 * router.get('/playlist/:id',
 *   validate({
 *     params: z.object({ id: schemas.spotifyPlaylistId }),
 *     query: z.object({ ownOnly: schemas.booleanFlag.optional() })
 *   }),
 *   (req: ValidatedRequest<{ id: string }, { ownOnly?: boolean }>, res) => {
 *     // req.params.id is string
 *     // req.query.ownOnly is boolean | undefined (properly typed!)
 *   }
 * );
 */
export function validate<
  TParams extends ZodSchema = ZodSchema,
  TQuery extends ZodSchema = ZodSchema,
  TBody extends ZodSchema = ZodSchema,
>(schemas: { params?: TParams; query?: TQuery; body?: TBody }) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Store the validated/transformed value back on the request. Express 5 makes
      // req.query (and req.params) read-only getters, so a plain assignment throws -
      // define an own data property that shadows the getter instead. This works on
      // Express 4 too. Zod transforms still apply (e.g. 'true' -> boolean true).
      const setValidated = (key: 'params' | 'query' | 'body', value: unknown) => {
        Object.defineProperty(req, key, {
          value,
          writable: true,
          enumerable: true,
          configurable: true,
        });
      };

      if (schemas.params) {
        setValidated('params', schemas.params.parse(req.params));
      }
      if (schemas.query) {
        setValidated('query', schemas.query.parse(req.query));
      }
      if (schemas.body) {
        setValidated('body', schemas.body.parse(req.body));
      }

      next();
    } catch (error) {
      if (error instanceof ZodError) {
        Logger.warn('Request validation failed', {
          path: req.path,
          errors: error.issues,
        });

        return res.status(400).render('partials/error-message', {
          type: 'danger',
          message: 'Invalid request data',
          details: error.issues
            .map((e: ZodIssue) => `${e.path.join('.')}: ${e.message}`)
            .join(', '),
        });
      }

      // Unknown error, pass to error handler
      next(error);
    }
  };
}

/**
 * Common validation schemas
 */
export const schemas = {
  // Spotify playlist ID (22 alphanumeric characters)
  spotifyPlaylistId: z.string().regex(/^[a-zA-Z0-9]{22}$/, 'Invalid Spotify playlist ID'),

  // YouTube video ID (11 characters, alphanumeric with - and _)
  youtubeVideoId: z.string().regex(/^[a-zA-Z0-9_-]{11}$/, 'Invalid YouTube video ID'),

  // YouTube playlist ID
  youtubePlaylistId: z.string().regex(/^[a-zA-Z0-9_-]{13,}$/, 'Invalid YouTube playlist ID'),

  // OAuth authorization code
  oauthCode: z.string().min(1).max(1000),

  // Batch size for syncing - a positive integer (as a string) or 'all'
  batchSize: z.union([
    z.string().regex(/^[1-9]\d*$/, 'Must be a positive number'),
    z.literal('all'),
  ]),

  // Boolean flag
  booleanFlag: z.enum(['true', 'false']).transform((val) => val === 'true'),

  // Track/song name (reasonable length)
  trackName: z.string().min(1).max(200),

  // Artist name
  artistName: z.string().min(1).max(200),

  // Generic alphanumeric ID
  alphanumericId: z
    .string()
    .regex(/^[a-zA-Z0-9_-]+$/, 'Invalid ID format')
    .min(1)
    .max(100),
};
