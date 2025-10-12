import dotenv from 'dotenv';
dotenv.config();

// Validate environment variables before starting server
import { validateEnvironment } from './utils/envValidation';
validateEnvironment();

import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import path from 'path';
import rateLimit from 'express-rate-limit';
import { spotifyRouter } from './routes/spotify';
import { youtubeRouter } from './routes/youtube';
import { syncRouter } from './routes/sync';
import { playlistDetailsRouter } from './routes/playlistDetails';
import { progressRouter } from './routes/progress';
import { Logger } from './utils/logger';
import { validateSpotifyConnection, validateYouTubeConnection } from './utils/authValidation';
import { csrfCookieMiddleware, getCsrfToken } from './utils/csrf';

const app = express();
const PORT = process.env.PORT || 3000;

// Security headers with Helmet
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://fonts.googleapis.com"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com", "https://cdn.jsdelivr.net"],
      imgSrc: ["'self'", "data:", "https:", "http:"], // Allow external images (YouTube thumbnails, etc.)
      connectSrc: ["'self'"], // Allow SSE connections to same origin
      fontSrc: ["'self'", "data:", "https://cdn.jsdelivr.net", "https://fonts.gstatic.com"], // Google Fonts
      frameSrc: ["'none'"]
    }
  },
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true
  }
}));

// Middleware
app.use(express.json({ limit: '10kb' })); // Limit request body size to prevent DoS
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(cookieParser());
app.use(csrfCookieMiddleware); // CSRF protection - set token cookie on all requests

// Rate limiting for status check endpoints
const statusLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute window
  max: 30, // Limit each IP to 30 requests per minute
  message: 'Too many status check requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});

// Request logging middleware
app.use((req, res, next) => {
  // Skip logging for static assets and favicon to reduce noise
  if (req.originalUrl.includes('.css') || req.originalUrl.includes('.js') ||
      req.originalUrl.includes('.png') || req.originalUrl.includes('.ico') ||
      req.originalUrl.includes('/favicon')) {
    return next();
  }

  const hasSpotifyToken = !!req.cookies.spotify_tokens;
  const hasYoutubeToken = !!req.cookies.youtube_tokens;

  Logger.requestStart(`${req.method} ${req.originalUrl}`, {
    fullUrl: `${req.protocol}://${req.get('host')}${req.originalUrl}`,
    userAgent: req.get('User-Agent')?.slice(0, 100) || 'none',
    hasAuth: hasSpotifyToken || hasYoutubeToken
  });

  if (Object.keys(req.query).length > 0) {
    Logger.debug('Request query parameters', { query: req.query });
  }
  if (Object.keys(req.body).length > 0) {
    Logger.debug('Request body', { body: req.body });
  }

  // Track response completion
  res.on('finish', () => {
    Logger.debug('Response sent', {
      statusCode: res.statusCode,
      statusMessage: res.statusMessage
    });
  });

  next();
});

// Static files
app.use(express.static(path.join(__dirname, '../public')));

// View engine setup (EJS for templating)
app.set('views', path.join(__dirname, '../views'));
app.set('view engine', 'ejs');

// Routes
app.use('/auth/spotify', spotifyRouter);
app.use('/auth/youtube', youtubeRouter);
app.use('/api/sync', syncRouter);
app.use('/api/playlistDetails', playlistDetailsRouter);
app.use('/api/progress', progressRouter);

// Main page
app.get('/', (req, res) => {
  // CSRF token is now available in res.locals.csrfToken (set by csrfCookieMiddleware)
  const csrfToken = getCsrfToken(req, res);

  res.render('index', { csrfToken });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Connection status button endpoints (with rate limiting)
app.get('/api/status/spotify/button', statusLimiter, async (req, res) => {
  const spotifyTokens = req.cookies.spotify_tokens ? JSON.parse(req.cookies.spotify_tokens) : null;
  const spotifyConnected = await validateSpotifyConnection(spotifyTokens, res);

  res.render('partials/connection-button', {
    service: 'spotify',
    connected: spotifyConnected,
    loading: false
  });
});

app.get('/api/status/youtube/button', statusLimiter, async (req, res) => {
  const youtubeTokens = req.cookies.youtube_tokens ? JSON.parse(req.cookies.youtube_tokens) : null;
  const youtubeConnected = await validateYouTubeConnection(youtubeTokens, res);

  res.render('partials/connection-button', {
    service: 'youtube',
    connected: youtubeConnected,
    loading: false
  });
});

// 404 handler - must come after all other routes
app.use((req, res) => {
  res.status(404).render('partials/error-message', {
    type: 'warning',
    message: 'Page not found',
    details: `Cannot ${req.method} ${req.originalUrl}`
  });
});

// Global error handler - must be last
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  Logger.error('Unhandled error', { url: req.originalUrl, method: req.method }, err);

  // Don't expose error details in production
  const errorDetails = process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong';

  res.status(err.status || 500).render('partials/error-message', {
    type: 'danger',
    message: 'Internal server error',
    details: errorDetails
  });
});

app.listen(PORT, () => {
  Logger.info('Server started', { port: PORT, url: `http://localhost:${PORT}`, env: process.env.NODE_ENV || 'development' });
});
