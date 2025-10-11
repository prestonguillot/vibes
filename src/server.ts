import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import path from 'path';
import { spotifyRouter } from './routes/spotify';
import { youtubeRouter } from './routes/youtube';
import { syncRouter } from './routes/sync';
import { playlistDetailsRouter } from './routes/playlistDetails';
import { progressRouter } from './routes/progress';
import { Logger } from './utils/logger';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

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

  // Log response when it finishes
  const originalSend = res.send;
  res.send = function(data) {
    Logger.debug('Response sent', { statusCode: res.statusCode, statusMessage: res.statusMessage, bytes: data?.length || 0 });
    return originalSend.call(this, data);
  };

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
  res.render('index');
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Connection status check
app.get('/api/status', async (req, res) => {
  let spotifyConnected = false;
  let youtubeConnected = false;

  // Test Spotify connection
  const spotifyTokens = req.cookies.spotify_tokens ? JSON.parse(req.cookies.spotify_tokens) : null;
  if (spotifyTokens) {
    try {
      const spotifyApi = new (require('spotify-web-api-node'))({
        clientId: process.env.SPOTIFY_CLIENT_ID,
        clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
        redirectUri: process.env.SPOTIFY_REDIRECT_URI
      });

      spotifyApi.setAccessToken(spotifyTokens.accessToken);
      spotifyApi.setRefreshToken(spotifyTokens.refreshToken);

      // Test with a lightweight API call
      await spotifyApi.getMe();
      spotifyConnected = true;
      Logger.auth('Spotify', 'connection validated');
    } catch (error: any) {
      Logger.auth('Spotify', 'connection invalid', { error: error.message });
      // Try to refresh the token
      if (error.statusCode === 401 && spotifyTokens.refreshToken) {
        try {
          const spotifyApi = new (require('spotify-web-api-node'))({
            clientId: process.env.SPOTIFY_CLIENT_ID,
            clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
            redirectUri: process.env.SPOTIFY_REDIRECT_URI
          });

          spotifyApi.setAccessToken(spotifyTokens.accessToken);
          spotifyApi.setRefreshToken(spotifyTokens.refreshToken);

          const data = await spotifyApi.refreshAccessToken();
          const { access_token } = data.body;

          // Update cookie with new token
          const updatedTokens = { ...spotifyTokens, accessToken: access_token };
          res.cookie('spotify_tokens', JSON.stringify(updatedTokens), {
            httpOnly: true,
            maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
            sameSite: 'lax'
          });

          spotifyConnected = true;
          Logger.auth('Spotify', 'token refreshed');
        } catch (refreshError) {
          Logger.auth('Spotify', 'failed to refresh token');
          // Clear invalid tokens
          res.clearCookie('spotify_tokens');
        }
      } else {
        // Clear invalid tokens
        res.clearCookie('spotify_tokens');
      }
    }
  }

  // Test YouTube connection
  const youtubeTokens = req.cookies.youtube_tokens ? JSON.parse(req.cookies.youtube_tokens) : null;
  if (youtubeTokens) {
    try {
      const { google } = require('googleapis');
      const oauth2Client = new google.auth.OAuth2(
        process.env.YOUTUBE_CLIENT_ID,
        process.env.YOUTUBE_CLIENT_SECRET,
        process.env.YOUTUBE_REDIRECT_URI
      );

      oauth2Client.setCredentials(youtubeTokens);
      const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

      // Test with a lightweight API call
      await youtube.channels.list({ part: ['id'], mine: true, maxResults: 1 });
      youtubeConnected = true;
      Logger.auth('YouTube', 'connection validated');
    } catch (error: any) {
      Logger.auth('YouTube', 'connection invalid', { error: error.message });
      // Try to refresh the token
      if (error.code === 401 && youtubeTokens.refresh_token) {
        try {
          const { google } = require('googleapis');
          const oauth2Client = new google.auth.OAuth2(
            process.env.YOUTUBE_CLIENT_ID,
            process.env.YOUTUBE_CLIENT_SECRET,
            process.env.YOUTUBE_REDIRECT_URI
          );

          oauth2Client.setCredentials(youtubeTokens);
          const { credentials } = await oauth2Client.refreshAccessToken();

          // Update cookie with new tokens
          const updatedTokens = { ...youtubeTokens, ...credentials };
          res.cookie('youtube_tokens', JSON.stringify(updatedTokens), {
            httpOnly: true,
            maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
            sameSite: 'lax'
          });

          youtubeConnected = true;
          Logger.auth('YouTube', 'token refreshed');
        } catch (refreshError) {
          Logger.auth('YouTube', 'failed to refresh token');
          // Clear invalid tokens
          res.clearCookie('youtube_tokens');
        }
      } else {
        // Clear invalid tokens
        res.clearCookie('youtube_tokens');
      }
    }
  }

  res.json({
    spotify: spotifyConnected,
    youtube: youtubeConnected
  });
});

// Connection button endpoints (HTML for HTMX)
app.get('/api/status/spotify/button', async (req, res) => {
  let spotifyConnected = false;

  const spotifyTokens = req.cookies.spotify_tokens ? JSON.parse(req.cookies.spotify_tokens) : null;
  if (spotifyTokens) {
    try {
      const spotifyApi = new (require('spotify-web-api-node'))({
        clientId: process.env.SPOTIFY_CLIENT_ID,
        clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
        redirectUri: process.env.SPOTIFY_REDIRECT_URI
      });

      spotifyApi.setAccessToken(spotifyTokens.accessToken);
      spotifyApi.setRefreshToken(spotifyTokens.refreshToken);

      await spotifyApi.getMe();
      spotifyConnected = true;
    } catch (error: any) {
      Logger.auth('Spotify', 'button check failed', { error: error.message, statusCode: error.statusCode });
    }
  }

  res.render('partials/connection-button', { service: 'spotify', connected: spotifyConnected });
});

app.get('/api/status/youtube/button', async (req, res) => {
  let youtubeConnected = false;

  const youtubeTokens = req.cookies.youtube_tokens ? JSON.parse(req.cookies.youtube_tokens) : null;
  if (youtubeTokens) {
    try {
      const { google } = require('googleapis');
      const oauth2Client = new google.auth.OAuth2(
        process.env.YOUTUBE_CLIENT_ID,
        process.env.YOUTUBE_CLIENT_SECRET,
        process.env.YOUTUBE_REDIRECT_URI
      );

      oauth2Client.setCredentials(youtubeTokens);
      const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

      await youtube.channels.list({ part: ['id'], mine: true, maxResults: 1 });
      youtubeConnected = true;
    } catch (error: any) {
      Logger.auth('YouTube', 'button check failed', { error: error.message, code: error.code });
    }
  }

  res.render('partials/connection-button', { service: 'youtube', connected: youtubeConnected });
});

app.listen(PORT, () => {
  Logger.info('Server started', { port: PORT, url: `http://localhost:${PORT}` });
});
