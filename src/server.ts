import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import session from 'express-session';
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

// Temporary token storage for OAuth (in production, use Redis or database)
export const tempTokenStorage = new Map<string, any>();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
  // Skip logging for static assets and favicon to reduce noise
  if (req.originalUrl.includes('.css') || req.originalUrl.includes('.js') || 
      req.originalUrl.includes('.png') || req.originalUrl.includes('.ico') ||
      req.originalUrl.includes('/favicon')) {
    return next();
  }
  
  Logger.requestStart(`${req.method} ${req.originalUrl}`, {
    fullUrl: `${req.protocol}://${req.get('host')}${req.originalUrl}`,
    userAgent: req.get('User-Agent')?.slice(0, 100) || 'none',
    sessionId: req.sessionID || 'none'
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

app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-in-production',
  resave: false,
  saveUninitialized: true, // Create session for all requests (needed for OAuth popup compatibility)
  cookie: { 
    secure: false, // Set to true in production with HTTPS
    httpOnly: true, // Prevent XSS attacks
    maxAge: 24 * 60 * 60 * 1000, // 24 hours in milliseconds
    sameSite: 'lax' // CSRF protection while allowing OAuth redirects
  },
  name: 'spotify-youtube-session', // Custom session name
  rolling: true // Reset expiration on each request
}));

// Static files
app.use(express.static(path.join(__dirname, '../public')));

// View engine setup (for serving HTML templates)
app.set('views', path.join(__dirname, '../views'));
app.set('view engine', 'html');
app.engine('html', (filePath, options, callback) => {
  const fs = require('fs');
  fs.readFile(filePath, (err: any, content: Buffer) => {
    if (err) return callback(err);
    const rendered = content.toString();
    return callback(null, rendered);
  });
});

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
  if (req.session.spotifyTokens) {
    try {
      const spotifyApi = new (require('spotify-web-api-node'))({
        clientId: process.env.SPOTIFY_CLIENT_ID,
        clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
        redirectUri: process.env.SPOTIFY_REDIRECT_URI
      });
      
      spotifyApi.setAccessToken(req.session.spotifyTokens.accessToken);
      spotifyApi.setRefreshToken(req.session.spotifyTokens.refreshToken);
      
      // Test with a lightweight API call
      await spotifyApi.getMe();
      spotifyConnected = true;
      Logger.auth('Spotify', 'connection validated', { sessionId: req.sessionID });
    } catch (error: any) {
      Logger.auth('Spotify', 'connection invalid', { sessionId: req.sessionID, error: error.message });
      // Try to refresh the token
      if (error.statusCode === 401 && req.session.spotifyTokens.refreshToken) {
        try {
          const spotifyApi = new (require('spotify-web-api-node'))({
            clientId: process.env.SPOTIFY_CLIENT_ID,
            clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
            redirectUri: process.env.SPOTIFY_REDIRECT_URI
          });
          
          spotifyApi.setAccessToken(req.session.spotifyTokens.accessToken);
          spotifyApi.setRefreshToken(req.session.spotifyTokens.refreshToken);
          
          const data = await spotifyApi.refreshAccessToken();
          const { access_token } = data.body;
          
          // Update session with new token
          req.session.spotifyTokens.accessToken = access_token;
          spotifyConnected = true;
          Logger.auth('Spotify', 'token refreshed', { sessionId: req.sessionID });
          
          // Force session save to ensure token persists
          await new Promise((resolve, reject) => {
            req.session.save((err) => {
              if (err) reject(err);
              else resolve(true);
            });
          });
        } catch (refreshError) {
          Logger.auth('Spotify', 'failed to refresh token', { sessionId: req.sessionID });
          // Clear invalid tokens
          delete req.session.spotifyTokens;
        }
      } else {
        // Clear invalid tokens
        delete req.session.spotifyTokens;
      }
    }
  }

  // Test YouTube connection
  if (req.session.youtubeTokens) {
    try {
      const { google } = require('googleapis');
      const oauth2Client = new google.auth.OAuth2(
        process.env.YOUTUBE_CLIENT_ID,
        process.env.YOUTUBE_CLIENT_SECRET,
        process.env.YOUTUBE_REDIRECT_URI
      );
      
      oauth2Client.setCredentials(req.session.youtubeTokens);
      const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
      
      // Test with a lightweight API call
      await youtube.channels.list({ part: ['id'], mine: true, maxResults: 1 });
      youtubeConnected = true;
      Logger.auth('YouTube', 'connection validated', { sessionId: req.sessionID });
    } catch (error: any) {
      Logger.auth('YouTube', 'connection invalid', { sessionId: req.sessionID, error: error.message });
      // Try to refresh the token
      if (error.code === 401 && req.session.youtubeTokens.refresh_token) {
        try {
          const { google } = require('googleapis');
          const oauth2Client = new google.auth.OAuth2(
            process.env.YOUTUBE_CLIENT_ID,
            process.env.YOUTUBE_CLIENT_SECRET,
            process.env.YOUTUBE_REDIRECT_URI
          );
          
          oauth2Client.setCredentials(req.session.youtubeTokens);
          const { credentials } = await oauth2Client.refreshAccessToken();
          
          // Update session with new tokens
          req.session.youtubeTokens = {
            ...req.session.youtubeTokens,
            ...credentials
          };
          youtubeConnected = true;
          Logger.auth('YouTube', 'token refreshed', { sessionId: req.sessionID });
          
          // Force session save to ensure token persists
          await new Promise((resolve, reject) => {
            req.session.save((err) => {
              if (err) reject(err);
              else resolve(true);
            });
          });
        } catch (refreshError) {
          Logger.auth('YouTube', 'failed to refresh token', { sessionId: req.sessionID });
          // Clear invalid tokens
          delete req.session.youtubeTokens;
        }
      } else {
        // Clear invalid tokens
        delete req.session.youtubeTokens;
      }
    }
  }

  res.json({
    spotify: spotifyConnected,
    youtube: youtubeConnected
  });
});

app.listen(PORT, () => {
  Logger.info('Server started', { port: PORT, url: `http://localhost:${PORT}` });
});
