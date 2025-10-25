/**
 * Express application setup (without server.listen)
 * This allows the app to be imported for testing without starting the server
 */

import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import path from 'path';
import { spotifyRouter } from './routes/spotify';
import { youtubeRouter } from './routes/youtube';
import { syncRouter } from './routes/sync';
import { playlistDetailsRouter } from './routes/playlistDetails';
import { progressRouter } from './routes/progress';
import playlistTracksRouter from './routes/playlistTracks';
import { Logger } from './utils/logger';
import { validateSpotifyConnection, validateYouTubeConnection } from './utils/authValidation';
import { csrfCookieMiddleware, getCsrfToken } from './utils/csrf';
import { parseSpotifyTokenCookie, parseYouTubeTokenCookie } from './utils/cookieParser';

export function createApp() {
  const app = express();

  // Security headers with Helmet
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // NOTE: 'unsafe-inline' for styles and scripts is necessary for this HTMX/Bootstrap architecture.
        // ARCHITECTURAL TRADEOFF: We allow 'unsafe-inline' to enable:
        // 1. HTMX inline script initialization (required for HTMX to work on initial page load)
        // 2. Bootstrap inline styles for certain components
        // 3. Dynamic HTML swapping via HTMX (safe because HTML comes from server, not user input)
        //
        // MITIGATION: No user-supplied data is embedded into inline scripts or styles. All dynamic
        // content (playlists, videos, etc.) is inserted via HTMX swap operations which target DOM
        // elements, not inline script/style content.
        //
        // FUTURE IMPROVEMENT: To remove 'unsafe-inline', we would need to:
        // - Generate random CSP nonces on each request
        // - Embed nonces in all inline scripts: <script nonce="...">
        // - Embed nonces in inline styles: <style nonce="...">
        // - Pass nonces to templates and dynamically generated HTML
        // This is possible but adds complexity; not justified for current risk level.
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
  app.use(playlistTracksRouter);

  // Main page
  app.get('/', (req, res) => {
    // CSRF token is now available in res.locals.csrfToken (set by csrfCookieMiddleware)
    const csrfToken = getCsrfToken(req, res);

    res.render('index', { csrfToken });
  });

  // Debug/Component showcase page
  app.get('/debug/components', (req, res) => {
    res.render('debug-components', {
      isDebug: true,
      mockPlaylists: [
        {
          id: 'demo-synced-1',
          name: 'My Favorite Songs',
          tracksTotal: 50,
          spotifyUrl: 'https://open.spotify.com/playlist/demo',
          youtubeUrl: 'https://www.youtube.com/playlist?list=demo',
          isSynced: true,
          syncIcon: '✓',
          buttonText: 'Update YouTube Playlist',
          buttonClass: 'btn-outline-success',
          isYouTubeConnected: true,
          isDisabled: false
        },
        {
          id: 'demo-unsynced-1',
          name: 'New Playlist',
          tracksTotal: 25,
          spotifyUrl: 'https://open.spotify.com/playlist/demo2',
          youtubeUrl: null,
          isSynced: false,
          syncIcon: '',
          buttonText: 'Sync to YouTube',
          buttonClass: 'btn-primary',
          isYouTubeConnected: true,
          isDisabled: false
        },
        {
          id: 'demo-no-yt-1',
          name: 'Chill Vibes',
          tracksTotal: 100,
          spotifyUrl: 'https://open.spotify.com/playlist/demo3',
          youtubeUrl: null,
          isSynced: false,
          syncIcon: '',
          buttonText: 'Connect to YouTube to Sync',
          buttonClass: 'btn-secondary',
          isYouTubeConnected: false,
          isDisabled: true
        }
      ],
      mockPlaylistDetails: {
        playlistId: 'demo-details-1',
        playlistName: 'Workout Mix',
        totalTracks: 3,
        linkedCount: 2,
        hasYoutubeConnection: true,
        hasYoutubePlaylist: true,
        tracks: [
          {
            spotify: { name: 'Blinding Lights', artist: 'The Weeknd', album: 'After Hours', id: 'sp1' },
            youtube: { title: 'The Weeknd - Blinding Lights', url: 'https://youtube.com/watch?v=demo1', thumbnail: 'https://via.placeholder.com/120x90/FF0000/FFFFFF?text=YouTube', id: 'yt1' },
            linked: true
          },
          {
            spotify: { name: 'Levitating', artist: 'Dua Lipa', album: 'Future Nostalgia', id: 'sp2' },
            youtube: null,
            linked: false
          },
          {
            spotify: { name: 'Anti-Hero', artist: 'Taylor Swift', album: 'Midnights', id: 'sp3' },
            youtube: null,
            linked: false
          }
        ]
      },
      mockConnectionButtonProps: [
        { service: 'spotify', connected: true, loading: false, error: null },
        { service: 'spotify', connected: false, loading: false, error: null },
        { service: 'spotify', connected: false, loading: true, error: null },
        { service: 'youtube', connected: true, loading: false, error: null },
        { service: 'youtube', connected: false, loading: false, error: null }
      ],
      mockSyncFeedback: {
        playlistId: 'demo-feedback-1',
        videosFound: 12,
        totalSearched: 15,
        totalTracks: 15,
        isLimited: false,
        isUpdate: false,
        unlinkedTracks: [
          { name: 'Unknown Track 1', artist: 'Unknown Artist' },
          { name: 'Unknown Track 2', artist: 'Unknown Artist' },
          { name: 'Unknown Track 3', artist: 'Unknown Artist' }
        ]
      }
    });
  });

  // Health check
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Connection status button endpoints
  app.get('/api/status/spotify/button', async (req, res) => {
    const startTime = Date.now();
    const spotifyTokens = parseSpotifyTokenCookie(req.cookies.spotify_tokens, res);
    const spotifyResult = await validateSpotifyConnection(spotifyTokens, res);

    // Ensure minimum display time of 500ms to prevent flash
    const elapsed = Date.now() - startTime;
    const minDisplayTime = 500;
    if (elapsed < minDisplayTime) {
      await new Promise(resolve => setTimeout(resolve, minDisplayTime - elapsed));
    }

    res.render('partials/connection-button', {
      service: 'spotify',
      connected: spotifyResult.connected,
      error: spotifyResult.error,
      loading: false
    });
  });

  app.get('/api/status/youtube/button', async (req, res) => {
    const startTime = Date.now();
    const youtubeTokens = parseYouTubeTokenCookie(req.cookies.youtube_tokens, res);
    const youtubeResult = await validateYouTubeConnection(youtubeTokens, res);

    // Ensure minimum display time of 500ms to prevent flash
    const elapsed = Date.now() - startTime;
    const minDisplayTime = 500;
    if (elapsed < minDisplayTime) {
      await new Promise(resolve => setTimeout(resolve, minDisplayTime - elapsed));
    }

    // Trigger playlist refresh when YouTube becomes connected
    if (youtubeResult.connected) {
      res.setHeader('HX-Trigger', 'youtubeConnected');
    }

    res.render('partials/connection-button', {
      service: 'youtube',
      connected: youtubeResult.connected,
      error: youtubeResult.error,
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

  return app;
}
