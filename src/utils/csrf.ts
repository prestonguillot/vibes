import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { Logger } from './logger';
import { getCsrfSecret } from '../config/csrf';

/**
 * CSRF Protection using Signed Double Submit Cookie pattern
 *
 * This implementation provides defense-in-depth CSRF protection by:
 * 1. Generating a random CSRF token for each session
 * 2. Storing the token in a signed cookie (HttpOnly, SameSite=strict)
 * 3. Requiring the token in a custom header (X-CSRF-Token) for state-changing requests
 * 4. Validating that the header token matches the signed cookie token
 *
 * Combined with SameSite=strict cookies, this provides strong CSRF protection
 * because attackers cannot:
 * - Read the token from cookies (cross-origin restriction)
 * - Send custom headers cross-origin (without CORS permission)
 * - Forge the signed token (without the server secret)
 *
 * NOTE: The CSRF_SECRET is loaded at app startup from src/config/csrf.ts
 * to ensure all server instances use the same secret (required for multi-instance deployments)
 */

const CSRF_COOKIE_NAME = 'csrf_token';
const CSRF_HEADER_NAME = 'x-csrf-token';

/**
 * Generate a cryptographically secure CSRF token
 */
export function generateCsrfToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Sign a CSRF token using HMAC
 */
function signToken(token: string): string {
  const hmac = crypto.createHmac('sha256', getCsrfSecret());
  hmac.update(token);
  return hmac.digest('hex');
}

/**
 * Verify that a token matches its signature
 */
function verifyToken(token: string, signature: string): boolean {
  const expectedSignature = signToken(token);
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

/**
 * Middleware to generate and set CSRF token cookie
 * This should be applied to all routes that render HTML pages
 */
export function csrfCookieMiddleware(req: Request, res: Response, next: NextFunction) {
  // Check if CSRF cookie already exists and is valid
  const existingToken = req.cookies[CSRF_COOKIE_NAME];

  if (!existingToken) {
    const token = generateCsrfToken();
    const signature = signToken(token);
    const signedToken = `${token}.${signature}`;

    // Set CSRF token in httpOnly cookie
    res.cookie(CSRF_COOKIE_NAME, signedToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    });

    // Store the unsigned token in res.locals so it's immediately available
    res.locals.csrfToken = token;

    Logger.debug('Generated new CSRF token', {
      tokenPrefix: token.substring(0, 8) + '...'
    });
  } else {
    // Extract existing token from signed cookie
    const [token] = existingToken.split('.');
    res.locals.csrfToken = token;
  }

  next();
}

/**
 * Middleware to validate CSRF token on state-changing requests
 * This should be applied to all POST/PUT/DELETE/PATCH endpoints
 */
export function csrfValidationMiddleware(req: Request, res: Response, next: NextFunction) {
  // Get token from header
  const headerToken = req.headers[CSRF_HEADER_NAME] as string;

  // Get signed token from cookie
  const signedToken = req.cookies[CSRF_COOKIE_NAME] as string;

  Logger.debug('CSRF validation starting', {
    url: req.originalUrl,
    method: req.method,
    hasHeaderToken: !!headerToken,
    hasCookieToken: !!signedToken,
    headerTokenPrefix: headerToken ? headerToken.substring(0, 8) + '...' : 'NONE',
    cookieTokenPrefix: signedToken ? signedToken.substring(0, 8) + '...' : 'NONE'
  });

  if (!headerToken) {
    Logger.warn('CSRF validation failed: missing header token', {
      url: req.originalUrl,
      method: req.method,
      headers: Object.keys(req.headers).filter(h => h.toLowerCase().includes('csrf'))
    });
    return res.status(403).json({
      error: 'CSRF token missing in request header'
    });
  }

  if (!signedToken) {
    Logger.warn('CSRF validation failed: missing cookie token', {
      url: req.originalUrl,
      method: req.method,
      cookies: Object.keys(req.cookies)
    });
    return res.status(403).json({
      error: 'CSRF token missing in cookie'
    });
  }

  // Split signed token into token and signature
  const [cookieToken, signature] = signedToken.split('.');

  Logger.debug('CSRF token components', {
    cookieTokenPrefix: cookieToken ? cookieToken.substring(0, 8) + '...' : 'NONE',
    signaturePrefix: signature ? signature.substring(0, 8) + '...' : 'NONE',
    headerTokenPrefix: headerToken.substring(0, 8) + '...',
    tokensMatch: headerToken === cookieToken
  });

  if (!cookieToken || !signature) {
    Logger.warn('CSRF validation failed: malformed cookie token', {
      url: req.originalUrl,
      method: req.method,
      hasCookieToken: !!cookieToken,
      hasSignature: !!signature
    });
    return res.status(403).json({
      error: 'Invalid CSRF token format'
    });
  }

  // Verify signature
  try {
    const expectedSignature = signToken(cookieToken);
    const signatureValid = verifyToken(cookieToken, signature);

    Logger.debug('CSRF signature verification', {
      signatureValid,
      providedSigPrefix: signature.substring(0, 8) + '...',
      expectedSigPrefix: expectedSignature.substring(0, 8) + '...'
    });

    if (!signatureValid) {
      Logger.warn('CSRF validation failed: invalid signature', {
        url: req.originalUrl,
        method: req.method,
        cookieTokenPrefix: cookieToken.substring(0, 8) + '...',
        providedSigPrefix: signature.substring(0, 8) + '...',
        expectedSigPrefix: expectedSignature.substring(0, 8) + '...'
      });
      return res.status(403).json({
        error: 'Invalid CSRF token signature'
      });
    }
  } catch (error) {
    Logger.error('CSRF validation error', {
      url: req.originalUrl,
      method: req.method
    }, error);
    return res.status(403).json({
      error: 'CSRF token validation error'
    });
  }

  // Verify header token matches cookie token
  if (headerToken !== cookieToken) {
    Logger.warn('CSRF validation failed: token mismatch', {
      url: req.originalUrl,
      method: req.method,
      headerTokenPrefix: headerToken.substring(0, 8) + '...',
      cookieTokenPrefix: cookieToken.substring(0, 8) + '...'
    });
    return res.status(403).json({
      error: 'CSRF token mismatch'
    });
  }

  Logger.info('CSRF validation successful ✓', {
    url: req.originalUrl,
    method: req.method,
    tokenPrefix: headerToken.substring(0, 8) + '...'
  });

  return next();
}

/**
 * Helper function to extract CSRF token from request for rendering in templates
 * Now uses res.locals which is set by csrfCookieMiddleware
 */
export function getCsrfToken(req: Request, res: Response): string | null {
  // First check res.locals (set by middleware)
  if (res.locals.csrfToken) {
    return res.locals.csrfToken;
  }

  // Fallback: extract from cookie if middleware hasn't run yet
  const signedToken = req.cookies[CSRF_COOKIE_NAME] as string;
  if (!signedToken) {
    return null;
  }

  const [token] = signedToken.split('.');
  return token || null;
}
